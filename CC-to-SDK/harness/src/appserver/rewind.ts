// appserver/rewind.ts — M2b Wave 3: the rewind trio (`thread/rewind/anchors`, `thread/rewind/dryRun`,
// `thread/rewind`). Time travel has two halves that fail in different ways: the working tree is restored
// by an engine call on the LIVE session (it needs the open transport — probe 68d), while the conversation
// is restored by REPLACING the engine with one resumed at the anchor. This file drives them in the ONE
// order `src/host/host.ts`'s shipped `rewind()` proves: every refusal is decided BEFORE either side effect,
// then the file restore, then the engine swap.
//
// Why that order is load-bearing (and not just tidy): a rejection that arrives after the working tree was
// already reverted tells the caller "nothing happened" while the files on disk say otherwise, with no
// matching conversation swap to explain them. `rewindParams`'s own validation and the busy/park gates are
// therefore all resolved synchronously, at request-arrival time, before `record.chain` is even touched.
//
// The swap itself (`swapEngine` below) is deliberately factored away from rewind's own validation: M2b's
// `thread/clear` performs the SAME swap against a different replacement engine (a fresh conversation
// instead of one resumed at an anchor), and the one thing neither may re-derive is the ORDER — bump the
// epoch, drop the router, dispose, install the replacement.
import { ERR } from "./rpc.js";
import { installRouter } from "./router.js";
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import { threadBusyReason, type EngineSession, type ThreadRecord } from "./registry.js";
import { getSessionMessages as sdkGetSessionMessages } from "../sessions/index.js";
import { rewindAnchorsFrom } from "../sessions/rows.js";
import { openSession, type OpenSessionConfig } from "../session/index.js";
import type { AppServer, Handler } from "./server.js";
import { rewindAnchorsParams, rewindDryRunParams, rewindParams } from "./schema/rewind.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors server.ts/turns.ts — registry.ts's `updatedAt` is unix seconds, not ms

const defaultGetSessionMessages = (sessionId: string): Promise<unknown[]> => sdkGetSessionMessages(sessionId);

/** The default replacement-engine factory: the SAME primitive `src/session/index.ts`'s `rewindSession`
 *  uses (`openSession({...config, resume, resumeAt})`), rather than calling `rewindSession` itself, so a
 *  DI'd factory in a test observes `resume`/`resumeAt` on an ordinary config object exactly as the real
 *  one does — the reasoning server.ts's `startThread` records for folding `resume` into the config. */
const defaultResumeAtFactory = (sessionId: string, resumeAt: string, config: Record<string, unknown>): EngineSession =>
  openSession({ ...(config as OpenSessionConfig), resume: sessionId, resumeAt } as OpenSessionConfig);

interface DryRunResult { canRewind: boolean; error?: string }

/** Normalizes the throw-vs-return split (probe 68d, mirrored from `host.rewindDryRun`): with file
 *  checkpointing off the engine RETURNS `{canRewind:false}`, but other failures — and any engine build
 *  without `rewindFiles` at all — THROW. One shape reaches the wire either way, because a client deciding
 *  whether to offer the rewind cannot be asked to tell those apart. */
async function dryRunRewind(session: EngineSession, uuid: string): Promise<DryRunResult> {
  const fn = session.rewind?.bind(session);
  if (!fn) return { canRewind: false, error: "rewind unsupported by this engine" };
  try { return (await fn(uuid, { dryRun: true })) as DryRunResult; }
  catch (e) { return { canRewind: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Replace a thread's engine, in the ONE order spec D-M2-8 fixes. Callers own the validation; this owns
 *  the sequence, and Task 3b's `thread/clear` reuses it with its own `makeReplacement`.
 *
 *  `record.epoch += 1` goes FIRST, before anything is torn down. The bump is what makes the outgoing
 *  engine's late frames inert (router.ts's installed router compares the epoch it captured against the
 *  record's on every frame) and what invalidates every outstanding `thread/read` cursor (subscribe.ts:
 *  cursors are `"<epoch>:<row>"`, and a rewind truncates rows, so a bare offset would silently address
 *  different content). Bumping before the dispose means a frame the outgoing engine emits WHILE it winds
 *  down is already stale by the time it is dispatched — `routerOff()` alone cannot promise that, because
 *  the read loop dispatches each frame over a snapshot of its callback set (src/session/session.ts).
 *
 *  A FAILING dispose does not abort the swap (host.ts's `swapEngine` swallows it the same way): the
 *  outgoing engine is being discarded either way, and letting its failure propagate here would leave the
 *  record holding a dead engine with no router at all — strictly worse than completing the replacement.
 *
 *  `nextSessionId` is the store id the record carries afterwards, and it is the CALLER's to decide: a
 *  destructive rewind resumes the same conversation id, so it stays stamped (the router's init latch then
 *  no-ops, exactly as on the `thread/resume` admission path). A swap that mints a NEW conversation passes
 *  `undefined` and lets the latch learn it off the first init frame.
 *
 *  NOT restored here, and not this function's to restore: whatever the thread ACCUMULATED on the outgoing
 *  engine after it was opened — flag settings pushed via `applyFlagSettings` (directories, rules, output
 *  style, effort), and a `model`/`permissionMode` a client moved at runtime. A replacement engine is a
 *  fresh CLI process with an empty flag layer, so all of it silently reverts to whatever `record.config`
 *  carried; host.ts solves this with a per-host accumulator it replays into every swap
 *  (`replayFlagState`), and the appserver's equivalent belongs with the task that builds that accumulator
 *  (M2b's settings-ops wave), not with a two-knob patch here that would look complete and not be. */
export async function swapEngine(
  srv: AppServer, record: ThreadRecord, makeReplacement: () => EngineSession, nextSessionId: string | undefined,
): Promise<void> {
  record.epoch += 1;
  record.routerOff?.();
  try { await record.session.dispose(); } catch { /* see above — the replacement is what matters */ }
  record.session = makeReplacement();
  record.sessionId = nextSessionId;
  // The per-turn replay window belongs to the conversation that was just discarded (host.ts's swapEngine
  // resets its own turn buffer for the same reason): subscribe.ts replays `record.buffer` to every newly
  // attached client, so leaving it would hand the next client item events from a turn that no longer
  // exists in the transcript it is about to read.
  record.buffer = [];
  installRouter(srv, record);
}

export const rewindAnchors: Handler = async (srv, ctx, id, params) => {
  const parsed = rewindAnchorsParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // Nothing is persisted until the first turn's init frame latches an id, so "no anchors yet" is the
  // honest answer, not an error — same call the picker makes on a freshly started thread.
  if (!record.sessionId) { ctx.peer.reply(id, { data: [], nextCursor: null }); return; }
  // Always re-read, never cached (probe 68 Q4: post-rewind row counts defy local arithmetic — the
  // transcript is the truth). Unpaged: `nextCursor` rides along only so every list method's envelope
  // matches (the same reasoning decision/list records).
  const getMessages = srv.deps.getSessionMessages ?? defaultGetSessionMessages;
  const rows = await getMessages(record.sessionId);
  ctx.peer.reply(id, { data: rewindAnchorsFrom(rows as unknown[]), nextCursor: null });
};

/** Read-only, and deliberately NOT chain-scoped: it mutates nothing, and a client polling "can I still
 *  rewind to this?" must not queue behind whatever else the thread has in flight. */
export const rewindDryRun: Handler = async (srv, ctx, id, params) => {
  const parsed = rewindDryRunParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  ctx.peer.reply(id, await dryRunRewind(record.session, parsed.data.uuid));
};

export const threadRewind: Handler = (srv, ctx, id, params) => {
  const parsed = rewindParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { threadId, uuid, prevUuid, scope } = parsed.data;
  const record = srv.registry.get(threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // ── Every refusal, resolved here: synchronously, at request-arrival time, before a single side effect.
  // The busy reason is on the wire (the shape beginTurn and reinitialize already reply): "closing" and
  // "swapping" are not the same refusal as "a turn is running".
  const busyReason = threadBusyReason(record);
  if (busyReason) { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return; }
  // A parked decision blocks the rewind for a concrete reason, not out of caution: the swap awaits the
  // outgoing engine's dispose(), and dispose awaits its read loop, which cannot end while a turn sits
  // inside canUseTool holding one of our parked promises (the C1 circular wait, closeRecord's header).
  if (srv.pendingDecisions(threadId).length) { ctx.peer.replyError(id, ERR.BUSY, "a decision is pending — answer it first"); return; }
  const sessionId = record.sessionId;
  if (!sessionId) { ctx.peer.replyError(id, ERR.ENGINE_GONE, "no session to rewind"); return; }
  // `resumeAt` takes a message uuid and has no value meaning "before the first message" (the fork
  // primitive genuinely cannot express an empty conversation), so a conversation-scoped rewind to the
  // very first prompt is refused rather than approximated — the code-only rewind is what remains, and
  // the message says so. M2b's `thread/clear` is the method that DOES express it.
  if (scope !== "code" && !prevUuid) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, "no conversation anchor before the first prompt — code-only rewind is available");
    return;
  }
  // Latched SYNCHRONOUSLY, for the same reason thread/close latches `closing` at request arrival: the work
  // below sits behind record.chain, so a same-tick turn/start (two requests dispatched before any
  // microtask runs) would otherwise pass its own busy gate and drive an engine call against a thread that
  // is being swapped out from under it. Every gate reads it through threadBusyReason -> "swapping".
  record.swapInFlight = true;
  record.chain = record.chain.then(async () => {
    try {
      // FILE RESTORE, on the live engine, first (probe 68d: rewindFiles needs the open transport). The dry
      // run is not a courtesy check — with checkpointing off the real call THROWS where the dry run merely
      // reports, so this is what keeps the throwing call away from a known-bad state.
      if (scope !== "conversation") {
        const dry = await dryRunRewind(record.session, uuid);
        if (!dry.canRewind) throw new Error(dry.error ?? "file rewind unavailable");
        await record.session.rewind!(uuid); // reachable only when the dry run answered — a missing rewind refuses above
      }
      // CONVERSATION RESTORE second: the swap is what replaces the engine, and it must not run before the
      // file restore has had the live transport it needs.
      if (scope !== "code") {
        const factory = srv.deps.resumeAtFactory ?? defaultResumeAtFactory;
        // The id stays stamped: a destructive `resumeAt` keeps the SAME session id (src/session/index.ts's
        // rewindSession), and clearing it would blind every reader that keys on it — thread/read and
        // thread/rewind/anchors would answer empty until the next turn, and sessionLib.ts's live-guard
        // would stop finding this thread, letting a concurrent thread/delete erase the history out from
        // under a live engine.
        await swapEngine(srv, record, () => factory(sessionId, prevUuid!, record.config ?? {}), sessionId);
      }
      record.updatedAt = nowSec(); // a rewind is a mutation like any other (registry.ts's updatedAt contract)
      // Both scopes at once: the thread's own subscribers, and every server-scoped watcher — a rewind
      // changes what this thread IS, which is the class of event watchers opted into (fanout.ts). Fired
      // for a code-only rewind too: the working tree moved under every attached client, which is news
      // whether or not the conversation moved with it.
      broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "thread/rewound", { threadId, sessionId });
      ctx.peer.reply(id, { ok: true, sessionId });
    } catch (e) {
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    } finally {
      // Guaranteed: a throw from the dry run, the real restore or the swap itself must not leave the
      // thread wedged reading "swapping" forever.
      record.swapInFlight = false;
    }
  });
};
