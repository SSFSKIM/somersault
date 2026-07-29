// appserver/lifecycle.ts — Task 11: compaction as a real turn, plus thread reinitialization (spec Wave
// 2). `thread/compact/start` claims the FULL turn machinery via turns.ts's extracted `beginTurn` spine —
// the session's compact() enqueues a genuine engine turn, and if the server drove it outside the turn
// machinery the thread would read idle while the engine is in fact turning: a concurrent turn/start would
// be admitted and silently queue inside the engine, and a later milestone's queue drain would start turns
// against a secretly busy engine. So compact busy-gates, mints a turn id, and broadcasts turn-started/
// turn-completed exactly like `turn/start` — it does not itself emit `thread/compacted`; the per-thread
// frame router's compact_boundary route (router.ts, Task 8b) already reports that boundary off the same
// `record.currentTurnId` this spine sets.
//
// compact()'s waiter consumes the engine's own frames internally (unlike submit(), it takes no onMessage
// callback) — any item events during compaction reach clients through the router's existing frame stream,
// not through this handler's runner. The runner therefore ignores the `mapper` argument beginTurn hands
// it; `mapper.finalize()` still runs (it is part of the shared spine), which is a no-op on a mapper that
// never ingested anything.
//
// `thread/reinitialize` is NOT a turn (no turn/started/turn/completed pair) — but unlike settings.ts's
// setters it DOES busy-gate synchronously, the same way `beginTurn` gates a turn: reinitializing a
// session is far heavier than a settings setter and is not safe to run concurrently with a live turn's
// engine call. (settings.ts's setters deliberately do NOT busy-gate — a live model/permissionMode switch
// mid-turn is intentional and useful.)
//
// The busy-gate here is load-bearing, not redundant with `record.chain`: `record.chain` only serializes
// handler BODIES against each other (this op against settings.ts's setters, thread/close, etc) — it does
// NOT, by itself, wait for an in-flight turn's engine call, because `beginTurn` (turns.ts) deliberately
// does not return the runner's promise into `record.chain` (a turn completes via `settleTurn`, not via
// the chain resolving). Without an explicit `threadBusyReason` check here, a `turn/start` immediately
// followed by `thread/reinitialize` would call `reinitialize()` on the same engine session while
// `submit()` was still in flight (a real bug an external review caught in an earlier draft of this file,
// whose header used to claim record.chain alone provided this guarantee — it does not).
//
// Its fresh init payload also refreshes the capabilities mirror, so the handler pings
// `thread/capabilities/changed` after replying — the same ping router.ts's routeCapabilities sends for an
// engine-pushed commands list (spec: "fresh init payload -> also refreshes the capabilities mirror").
import { ERR } from "./rpc.js";
import { beginTurn } from "./turns.js";
import { threadBusyReason } from "./registry.js";
import type { AppServer, Handler } from "./server.js";
import { threadCompactStartParams, threadReinitializeParams } from "./schema/threads.js";

export const threadCompactStart: Handler = (srv: AppServer, ctx, id, params) => {
  const parsed = threadCompactStartParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // NOT `async` — same reasoning as turns.ts's turnStart runner: a plain function lets compact()
  // throwing SYNCHRONOUSLY propagate synchronously into beginTurn's try/catch (reportFailed), rather than
  // being absorbed into a rejected promise that would route through onFailure instead.
  beginTurn(srv, ctx, id, record, () => record.session.compact!().then(() => {}));
};

export const threadReinitialize: Handler = (srv: AppServer, ctx, id, params) => {
  const parsed = threadReinitializeParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // Synchronous, at request-arrival time — same reasoning as beginTurn's own gate (turns.ts): a same-tick
  // turn/start followed by thread/reinitialize must see the thread already claimed, and record.chain
  // alone does not provide that (see the module header).
  const busyReason = threadBusyReason(record);
  if (busyReason) { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return; }
  record.chain = record.chain.then(async () => {
    try {
      const init = await record.session.reinitialize!();
      ctx.peer.reply(id, { init });
      srv.broadcast(record.id, "thread/capabilities/changed", { threadId: record.id });
    } catch (e) {
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    }
  });
};
