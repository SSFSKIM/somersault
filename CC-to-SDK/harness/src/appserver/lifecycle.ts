// appserver/lifecycle.ts — Task 11: compaction as a real turn, plus thread reinitialization (spec Wave
// 2). `thread/compact/start` claims the FULL turn machinery via turns.ts's extracted `beginTurn` spine —
// the session's compact() enqueues a genuine engine turn, and if the server drove it outside the turn
// machinery the thread would read idle while the engine is in fact turning: a concurrent turn/start would
// be admitted and silently queue inside the engine, and a later milestone's queue drain would start turns
// against a secretly busy engine. So compact busy-gates, mints a turn id, and broadcasts turn-started/
// turn-completed exactly like `turn/start`.
//
// `thread/compacted` is emitted HERE, off compact()'s own resolve, and no longer by the frame router: the
// router only ever saw the raw `system/compact_boundary` FRAME, which is not the outcome — it carries no
// verdict, so a compaction that FAILED (the engine's compact_error status) produced either a
// success-shaped notification or, when no boundary frame was emitted at all, none whatsoever. `compact()`
// (src/session/session.ts) resolves the PARSED CompactOutcome for both verdicts — only a transport error
// rejects — so broadcasting on its settle is what makes the notification fire exactly once per compaction,
// carrying `{ok:false}` when that is the truth.
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
import type { RequestId } from "./rpc.js";
import { beginTurn } from "./turns.js";
import { replyEngineThrow } from "./engineThrow.js";
import { threadBusyReason, type ThreadRecord } from "./registry.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import { threadCompactStartParams, threadReinitializeParams } from "./schema/threads.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors settings.ts/mcp.ts — registry.ts's `updatedAt` is unix seconds

/** `thread/compact/start` on a FLEET thread — spec §1d's RECORDED DEVIATION, and the one place this
 *  bridge is deliberately not transparent.
 *
 *  Everything the inProcess arm below does with the turn machinery is wrong for this origin. The host's
 *  `compact` op runs no turn: it emits no `turn` events and, crucially, leaves the host PROMPTABLE while
 *  the summarization runs — any client of that host can start a real turn mid-compact. Claiming a turn
 *  here would therefore (a) fabricate busy state no other client of that session observes, (b) mint a
 *  local `turn_<thread>_<n>` id onto a thread whose turn ids are DERIVED from the host seq
 *  (`fleetTurnId`), and (c) put a second lifecycle owner beside the fleet event layer, which §1b makes
 *  the sole one — two owners racing `record.busy` for one thread. So: no busy gate, no claim, no
 *  `turn/started`/`turn/completed`. The reply is the host's own receipt.
 *
 *  UN-CHAINED, unlike this file's `thread/reinitialize`: a compaction is routinely 30-120 s
 *  (fleetEngine.ts's own deadline is 300 s), and parking `record.chain` behind it would stall every
 *  chain-scoped op on the thread — a mid-compact `thread/model/set` would hang for minutes for no reason,
 *  since nothing here mutates local state the chain protects.
 *
 *  `thread/compacted` still goes out, off the op's own OUTCOME. Spec §1d expected the frame router to
 *  carry it (from the `system/compact_boundary` frame), but M2b retired that route for the reason
 *  router.ts records — a boundary marker is not a verdict — so the notification would otherwise never
 *  fire for this origin. It carries no `turnId`: there is no turn to name, which is the deviation stated
 *  in the payload rather than only in prose. */
function fleetCompact(srv: AppServer, ctx: ConnCtx, id: RequestId, record: ThreadRecord): void {
  record.session.compact!().then((outcome) => {
    record.updatedAt = nowSec();
    ctx.peer.reply(id, { ok: true, outcome });
    srv.broadcast(record.id, "thread/compacted", { threadId: record.id, outcome });
  }, (e: unknown) => {
    replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
  });
}

export const threadCompactStart: Handler = (srv: AppServer, ctx, id, params) => {
  const parsed = threadCompactStartParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  if (record.origin === "fleet") { fleetCompact(srv, ctx, id, record); return; }
  // NOT `async` — same reasoning as turns.ts's turnStart runner: a plain function lets compact()
  // throwing SYNCHRONOUSLY propagate synchronously into beginTurn's try/catch (reportFailed), rather than
  // being absorbed into a rejected promise that would route through onFailure instead.
  beginTurn(srv, ctx, id, record, (turnId) => record.session.compact!().then((outcome) => {
    srv.broadcast(record.id, "thread/compacted", { threadId: record.id, turnId, outcome });
  }));
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
