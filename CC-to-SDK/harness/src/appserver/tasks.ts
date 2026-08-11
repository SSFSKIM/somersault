// appserver/tasks.ts — M2b Wave 3: background tasks (`task/list`, `task/stop`, `turn/background`).
//
// THIS FILE EMITS NO NOTIFICATIONS, deliberately. The lifecycle half of this cluster already shipped with
// M2a's per-thread frame router (router.ts): the CLI answers a stop with its own
// `task_notification{stopped}` and a `system/background_tasks_changed` frame, which the router relays as
// `task/event` and `task/changed` — the same two notifications a task that starts, progresses or finishes
// on its own produces. A handler that additionally announced "I stopped a task" would be a second, racing
// source of truth for state the engine already reports, and it would report it for the request rather than
// for the engine's actual outcome. Same for `turn/background`: backgrounding a foreground tool call adds a
// live background task, so the engine's own changed-frame is what tells subscribers, not this file.
//
// `task/list` is a READ — un-chained, mirroring introspect.ts's convention: a poll of the live task set
// must not queue behind whatever else the thread has in flight (and polling it mid-turn is exactly when a
// client wants it). It is also the one method here that never reaches the engine's transport: the real
// Session answers from `_bgTasks`, the level signal it replaces wholesale on each changed-frame
// (src/session/session.ts's readLoop), so it stays honest even while a turn is blocked.
//
// `task/stop` and `turn/background` are MUTATIONS — chain-scoped, mirroring settings.ts/mcp.ts, so they
// serialize against each other and against every other chain-scoped op on the same thread. Chaining does
// NOT delay them for the duration of a running turn: `beginTurn` (turns.ts) does not return its submit
// promise into `record.chain`, so the chain is free again as soon as the turn has started — which is what
// makes a Ctrl+B-shaped `turn/background` reach the engine mid-turn, as it must. This does leave
// `turn/background` asymmetric with the un-chained `turn/interrupt`: a chain item wedged ahead of it parks
// the backgrounding, where an interrupt would still land. Accepted — chain scope is what keeps it from
// racing rewind's engine swap, and the op it competes with there is the swap itself.
//
// Every handler resolves its engine method FIRST and answers -32601 when it is absent, the same convention
// introspect.ts:36 and mcp.ts use: `EngineSession` declares these optional because a future non-inProcess
// engine will not have them, and an optional-call (`?.()`) that silently succeeds would reply `{ok:true}`
// for work no engine ever did (and, for the two value-returning methods, a bare `undefined` — a
// result-less frame this codebase's own `classify()` scores `invalid`, so the caller never settles).
import { ERR } from "./rpc.js";
import { replyEngineThrow } from "./engineThrow.js";
import type { Handler } from "./server.js";
import { taskListParams, taskStopParams, turnBackgroundParams } from "./schema/tasks.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors mcp.ts/settings.ts — registry.ts's `updatedAt` is unix seconds, not ms

const UNSUPPORTED = "unsupported by this engine"; // introspect.ts:36's exact wording — one string, three call sites

// The two mutations share engineThrow.ts's re-check (see its header). -32603 is the right ALIVE mapping
// here: the engine's own failures are untyped strings ("Session is not running", `callQ`'s "unsupported:
// stopTask"), and message-matching to re-class them is the thing spec Wave 0 forbids outright.

export const taskList: Handler = async (srv, ctx, id, params) => {
  const parsed = taskListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const fn = record.session.listBackgroundTasks?.bind(record.session);
  if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
  // Unpaged: the live task set is small and the engine hands it over whole. `nextCursor` rides along only
  // so every list method's envelope matches — the same reasoning decision/list and rewind/anchors record.
  ctx.peer.reply(id, { data: await fn(), nextCursor: null });
};

export const taskStop: Handler = (srv, ctx, id, params) => {
  const parsed = taskStopParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    // Resolved INSIDE the chain, not at arrival: M2b's rewind swaps `record.session` for a rebuilt engine,
    // so the engine that will actually serve this op is the one live when the chain reaches it.
    const fn = record.session.stopTask?.bind(record.session);
    if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
    try {
      await fn(parsed.data.taskId);
      record.updatedAt = nowSec();
      // `{ok:true}` means "the engine accepted the stop", not "the task has ended" — the task's own
      // `task_notification{stopped}` and the changed-frame are what report that, via the router.
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
    }
  });
};

export const turnBackground: Handler = (srv, ctx, id, params) => {
  const parsed = turnBackgroundParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    const fn = record.session.backgroundAll?.bind(record.session);
    if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
    try {
      // NOT busy-gated: backgrounding an in-flight foreground tool call is precisely a mid-turn act
      // (Ctrl+B — the blocked call returns "backgrounded" and the turn continues, probe 39 Q3).
      const backgrounded = await fn(parsed.data.toolUseId);
      record.updatedAt = nowSec();
      // The engine's boolean RECEIPT, relayed as-is: `false` ("nothing was backgroundable") is an answer,
      // not a failure, and coercing it into an error or an `{ok:true}` would lose the only signal a client
      // has for "your Ctrl+B did nothing".
      ctx.peer.reply(id, { backgrounded });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
    }
  });
};
