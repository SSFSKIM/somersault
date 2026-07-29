// appserver/turns.ts — turn lifecycle (spec: Turn -> Item; item/started -> deltas -> item/completed).
// Split out of server.ts per the plan's "extract before letting a hot file sprawl" rule. `turn/interrupt`:
// SDK Query.interrupt() is zero-arg at 0.3.220 (Task 1 finding, verified twice against sdk.d.ts) — no
// public method carries cancel_queued, and M1 has no server-side turn/queue (later milestone) to flush
// anyway. `cancelQueued` is accepted on the wire and silently unused; Task 12 records the scorecard gap.
import { randomUUID } from "node:crypto";
import { ERR } from "./rpc.js";
import { TurnMapper, userItem } from "./items/mapper.js";
import type { ItemEvent, ItemDeltaChannel } from "./items/types.js";
import { threadBusyReason, threadStatus } from "./registry.js";
import type { ThreadRecord, BufferedItemEvent } from "./registry.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import type { RequestId } from "./rpc.js";
import { applyPlanUpgrade } from "./planUpgrade.js";
import { turnStartParams, turnInterruptParams } from "./schema/turns.js";

const BUFFER_CAP = 500; // Task 9 replays this bound — a bounded PER-TURN buffer (reset every turn/start), drop-oldest

/** TurnMapper mutates its Items IN PLACE (`item.text += delta`, a tool's status/result filled in when its
 *  tool_result lands, `aborted` stamped by finalize), so buffering the ItemEvent by reference means the
 *  buffer no longer holds what it held when the event was live. A client joining mid-turn then got
 *  item/started already carrying the full text — and the deltas after it, rendering "Hello worldHello
 *  world" — or a tool "started" already reading completed with its result.
 *  Cloned HERE, at buffer time, not at replay time: the mutation is continuous, so the only moment the
 *  snapshot is still correct is the moment the event is emitted. Deltas carry no Item and need no clone. */
function snapshot(ev: ItemEvent): ItemEvent {
  return ev.kind === "delta" ? ev : { kind: ev.kind, item: structuredClone(ev.item) };
}

/** Drop-oldest, with ONE item-aware exception. A plain shift() can evict an in-flight item's `item/started`
 *  while its later deltas survive, and a reconnecting subscriber then gets deltas for an itemId it has
 *  never seen — it cannot reconstruct the output at all. (An `item/completed` needs no start: it carries
 *  the whole item, so only DELTAS hold a start back.)
 *
 *  So a still-deltaed start is FOLDED FORWARD rather than dropped: its retained text/thinking deltas are
 *  collapsed into the start snapshot's own text and removed from the buffer, and the start is re-seated at
 *  the head. Replay stays exactly reconstructable — the client sees a start already carrying the
 *  folded-in prefix, then the deltas that came after. Argument deltas are dropped without folding (they
 *  are raw partial JSON with nowhere to fold into; item/completed carries the parsed `arguments`).
 *  Folding always removes at least one entry, so the caller's loop always makes progress. */
function evictOldest(buf: BufferedItemEvent[]): void {
  const dropped = buf.shift();
  if (!dropped || dropped.event.kind !== "started") return;
  const id = dropped.event.item.id;
  const item = dropped.event.item as { text?: string };
  let folded = 0;
  for (let i = 0; i < buf.length; ) {
    const e = buf[i].event;
    if (e.kind === "delta" && e.itemId === id) {
      if (e.channel !== "arguments" && typeof item.text === "string") item.text += e.delta;
      buf.splice(i, 1); folded++; continue;
    }
    i++;
  }
  if (folded) buf.unshift(dropped);
}

function pushBounded(buf: BufferedItemEvent[], turnId: string, ev: ItemEvent): void {
  buf.push({ turnId, event: snapshot(ev) });
  while (buf.length > BUFFER_CAP) evictOldest(buf);
}

function deltaMethod(channel: ItemDeltaChannel): string {
  if (channel === "text") return "item/agentMessage/delta";
  if (channel === "thinking") return "item/reasoning/delta";
  return "item/toolCall/argumentsDelta";
}

/** The live broadcast path (emitItems, below) and Task 9's subscribe-time replay (subscribe.ts) both
 *  need the SAME ItemEvent -> (method, params) mapping, so it lives in exactly one place — the two
 *  paths can never drift on method names or param shape. */
export function itemEventNotification(threadId: string, turnId: string, ev: ItemEvent): { method: string; params: Record<string, unknown> } {
  if (ev.kind === "started") return { method: "item/started", params: { threadId, turnId, item: ev.item } };
  if (ev.kind === "completed") return { method: "item/completed", params: { threadId, turnId, item: ev.item } };
  return { method: deltaMethod(ev.channel), params: { threadId, turnId, itemId: ev.itemId, delta: ev.delta } };
}

function emitItems(srv: AppServer, record: ThreadRecord, turnId: string, events: ItemEvent[]): void {
  for (const ev of events) {
    pushBounded(record.buffer, turnId, ev);
    const { method, params } = itemEventNotification(record.id, turnId, ev);
    srv.broadcast(record.id, method, params);
  }
}

function statusChanged(srv: AppServer, record: ThreadRecord): void {
  const waitingOn = srv.pendingDecisions(record.id).length > 0;
  srv.broadcast(record.id, "thread/status/changed", { threadId: record.id, status: threadStatus(record, waitingOn) });
}

/** Turn-end belt for a plan_approve(acceptEdits:true) that settled but never saw the engine's own
 *  post-approval status frame (the turn ended first) — an approved upgrade must never stay unapplied.
 *  Fired on EVERY completion path below, a no-op unless one is armed (planUpgrade.ts). */
function settleTurn(record: ThreadRecord): void {
  record.busy = false;
  record.turnStartedBroadcast = false;
  void applyPlanUpgrade(record);
}

/** The ONE place a turn id is minted (spec Wave 4, external review): `beginTurn` below is its only
 *  caller, so `turn/start`, compact, and M2b's queue drain all produce identical id formats — format
 *  drift between them surfaces far downstream in replay and the D10 stitch. */
export function mintTurnId(record: ThreadRecord): string {
  return `turn_${record.id}_${++record.turnSeq}`;
}

/** The busy-gate + mint + chain-callback spine `turnStart` and compact (`lifecycle.ts`'s
 *  `thread/compact/start`) share (spec Wave 2: "compaction is a turn, not a side call"). `runner` is
 *  what actually drives the engine once the turn owns the thread: `turnStart` passes a wrapper around
 *  `session.submit`; compact passes `session.compact`. Returns false when the busy gate refused (the
 *  caller already got its -33001 reply) — verbatim-moved from `turnStart`, condition for condition. */
export function beginTurn(
  srv: AppServer, ctx: ConnCtx, id: RequestId, record: ThreadRecord,
  runner: (turnId: string, mapper: TurnMapper) => Promise<void>,
  presetTurnId?: string, // M2b's queue drain passes the id minted at enqueue; otherwise mintTurnId()
): boolean {
  // Gate synchronously, at request-arrival time — NOT deferred inside the chain callback below. A
  // same-tick second turn/start (two requests dispatched before any microtask runs) must see this
  // thread already claimed even when `submit()` happens to settle within the same microtask batch
  // as the chain callback's return (its completion `.then` would otherwise clear `busy` before the
  // second request's chain-deferred check ever ran — proven by turns.test.ts's busy-gate case).
  if (threadBusyReason(record)) { ctx.peer.replyError(id, ERR.BUSY, "Thread is busy"); return false; }
  record.busy = true;
  // Both reset synchronously HERE — at request-arrival time, not deferred inside the chain callback
  // below — for the same same-tick reason as the busy gate above:
  //  - buffer: a bounded PER-TURN window (spec §5), never a rolling lifetime window across turns.
  //  - interruptRequested: a turn/interrupt landing in this same tick (before the chain callback ever
  //    runs — two requests dispatched before any microtask flushes) must not have its flag wiped by
  //    this turn's own setup once that setup finally executes; proven by turns.test.ts's same-tick case.
  record.buffer = [];
  record.interruptRequested = false;
  // The turn id is minted HERE too — synchronously, in the same step as busy/buffer above — not inside
  // the deferred chain callback below. subscribe.ts's replay reads record.currentTurnId for a busy
  // thread whose buffer is still empty; if minting were deferred, a subscribe (or even a second frame in
  // the same transport chunk — Peer.feed() explicitly supports multi-frame chunks) landing before the
  // chain callback's microtask runs would see a STALE turnSeq and emit a bogus turn/started that never
  // gets a matching turn/completed (Task 9 finding 1).
  const turnId = presetTurnId ?? mintTurnId(record);
  record.currentTurnId = turnId;
  // The chain still gates the submit work below so it stays ordered after any prior thread-scoped chain
  // item (e.g. a queued thread/close finishing its dispose first).
  record.chain = record.chain.then(() => {
    const turn = { id: turnId, status: "inProgress" };
    ctx.peer.reply(id, { turn });
    statusChanged(srv, record);
    srv.broadcast(record.id, "turn/started", { threadId: record.id, turn });
    // Recorded AFTER the broadcast actually goes out, so a subscribe landing between turn/start's
    // synchronous gate (above, in turnStart) and this point still sees turnStartedBroadcast unset and
    // correctly skips its own turn/started replay — the live broadcast just above/about to fire is the
    // only delivery that peer needs (Task 9 finding 2).
    record.turnStartedBroadcast = true;

    const mapper = new TurnMapper(); // one instance per turn — dropped at completion, never reused
    const reportFailed = (err: unknown) => {
      emitItems(srv, record, turnId, mapper.finalize(true));
      settleTurn(record);
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: turnId, status: "failed", error: String(err) } });
      statusChanged(srv, record);
    };
    const onSuccess = () => {
      // The real engine (src/session/session.ts submit()/readLoop) does NOT reject on interrupt:
      // interrupting an in-flight turn makes submit() RESOLVE, with the SDK result's
      // error_during_execution subtype discarded by readLoop before this callback ever sees it. So the
      // success path — not just the rejection path below — must consult interruptRequested to tell a
      // genuine interrupt from a genuine completion.
      const interrupted = record.interruptRequested;
      emitItems(srv, record, turnId, mapper.finalize(interrupted));
      settleTurn(record);
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: turnId, status: interrupted ? "interrupted" : "completed" } });
      statusChanged(srv, record);
    };
    const onFailure = (err: unknown) => {
      emitItems(srv, record, turnId, mapper.finalize(true));
      settleTurn(record);
      const status = record.interruptRequested ? "interrupted" : "failed";
      const turn2: Record<string, unknown> = { id: turnId, status };
      if (status === "failed") turn2.error = String(err);
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: turn2 });
      statusChanged(srv, record);
    };
    try {
      // Guarded: the runner throwing SYNCHRONOUSLY (rather than returning a rejected promise) must
      // never leave record.chain rejected — an uncaught rejection here crashes the process AND wedges
      // the thread forever (busy stays true, and every later chain-scoped request for this thread —
      // e.g. thread/close — silently never replies because its .then() never runs on a rejected chain).
      // The try/catch below is belt-and-suspenders with the .catch(reportFailed): the try/catch covers
      // a throw before the runner ever returns a promise; the .catch covers onSuccess/onFailure
      // themselves throwing after the runner's promise settles.
      runner(turnId, mapper).then(onSuccess, onFailure).catch(reportFailed);
    } catch (err) {
      reportFailed(err);
    }
  });
  return true;
}

export const turnStart: Handler = (srv, ctx, id, params) => {
  const parsed = turnStartParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // NOT `async`: a plain function so `record.session.submit(...)` throwing SYNCHRONOUSLY still propagates
  // synchronously out of this runner call — exactly as it did in the pre-extraction code, where submit()
  // was called directly inside beginTurn's (then turnStart's) own try. Wrapping this in `async`/`await`
  // would have the JS engine itself absorb that synchronous throw into a REJECTED promise instead, routing
  // it through onFailure (which consults interruptRequested) rather than the try/catch's reportFailed
  // (which always reports "failed") — a real divergence for a turn/interrupt landing the same tick as a
  // synchronously-throwing submit(). `.then(() => {})` only adapts submit()'s `Promise<{result}>` down to
  // the runner's `Promise<void>` contract; it never intercepts a synchronous throw.
  beginTurn(srv, ctx, id, record, (turnId, mapper) => {
    // gap 6, probe-70 ALIVE branch: the server mints the transcript uuid itself and reuses it as the
    // live userMessage item's id, so the id equals what the SDK will persist — the item can safely join
    // the replay buffer (emitItems below) under the normal id-dedup stitch instead of being live-only.
    // Stays inside the runner (not beginTurn): compact has no user prompt to echo.
    const userUuid = randomUUID();
    emitItems(srv, record, turnId, [{ kind: "completed", item: userItem(parsed.data.input, userUuid) }]);
    return record.session.submit(parsed.data.input, (m) => emitItems(srv, record, turnId, mapper.ingest(m)), { uuid: userUuid }).then(() => {});
  });
};

/** The ONE interrupt path — turn/interrupt and decision/respond's abortTurn both go through it. Setting
 *  interruptRequested is not optional bookkeeping: onSuccess above reads it to tell a turn the client
 *  aborted from a turn that genuinely finished, so an interrupt that skips the flag reports the aborted
 *  turn as "completed" and finalizes its open items as completed rather than failed. */
export async function requestInterrupt(record: ThreadRecord): Promise<void> {
  record.interruptRequested = true;
  await record.session.interrupt(); // zero-arg (see file header) — turn/interrupt's cancelQueued accepted, unused
}

export const turnInterrupt: Handler = async (srv, ctx, id, params) => {
  const parsed = turnInterruptParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  await requestInterrupt(record);
  ctx.peer.reply(id, { interrupted: true });
};
