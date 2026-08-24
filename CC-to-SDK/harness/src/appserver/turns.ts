// appserver/turns.ts — turn lifecycle (spec: Turn -> Item; item/started -> deltas -> item/completed).
// Split out of server.ts per the plan's "extract before letting a hot file sprawl" rule. `turn/interrupt`:
// SDK Query.interrupt() is zero-arg at 0.3.220 (Task 1 finding, verified twice against sdk.d.ts) — no
// public method carries cancel_queued, so the SDK's OWN input queue stays unreachable. What
// `cancelQueued` now flushes is this server's queue (M2b Wave 4, queue.ts): the receipt reports the
// server-side set (`cancelledQueued`), and `cancelled`/`still_queued` land if the SDK ever surfaces the
// option.
import { randomUUID } from "node:crypto";
import { ERR } from "./rpc.js";
import { TurnMapper, userItem } from "./items/mapper.js";
import type { ItemEvent, ItemDeltaChannel } from "./items/types.js";
import { fleetTurnId, mintTurnId, threadBusyReason, threadStatus, ORIGIN_REFUSAL_MESSAGE } from "./registry.js";
import type { ThreadRecord, BufferedItemEvent, PendingFleetStop, EngineSession } from "./registry.js";
import type { FleetEngineSession } from "./fleetEngine.js";
import { refuseFleetContent } from "./fleetEngine.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import type { RequestId } from "./rpc.js";
import { applyPlanUpgrade } from "./planUpgrade.js";
import { asQueuedInput, cancelQueued, enqueueTurn, flushQueue, isQueuedItems, queuedNotification, takeNext, MAX_QUEUED_BYTES, MAX_QUEUED_ENTRY_BYTES, MAX_QUEUED_TURNS, type QueuedInput, type QueuedTurn } from "./queue.js";
import { turnStartParams, turnInterruptParams, turnSteerParams, turnStartContentParams, turnSteerContentParams } from "./schema/turns.js";
import { resolveInputItems, type InputItem } from "./turnItems.js";
import { flattenForDisplay, normalizeValidatedBlocks, MAX_AGGREGATE_BYTES, type UserTurnInput, type UserContentBlock } from "../session/turnInput.js";

const BUFFER_CAP = 500; // Task 9 replays this bound — a bounded PER-TURN buffer (reset every turn/start), drop-oldest
const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors server.ts/settings.ts — registry.ts's `updatedAt` is unix seconds, not ms

/** The terminal status a turn reports when it never reached an engine at all. */
type TurnStopped = "cancelled" | "interrupted";
/** What a runner hands back to `beginTurn`: the engine's own outcome (Wave T t14's additive `error` tag
 *  rides on it), `stopped` when it refused to call the engine at all, or nothing (compact). */
type TurnOutcome = { error?: { message: string }; stopped?: TurnStopped } | void;

/** THE TWO LATCHES, spelled once and read at every point a turn is about to touch an engine. `closing`
 *  wins when both hold, matching threadBusyReason's precedence (registry.ts).
 *
 *  Read more than once per turn on purpose. `beginTurn`'s chain callback reads them after waiting on the
 *  chain; `submitRunner` and `fleetTurnStart` read them AGAIN on the far side of the item resolution
 *  (spec 2026-08-23, "Admission and the queue"; plan-review finding 2) — an await added between a check
 *  and the call it guards turns that check stale, which is the M6 lesson stated as code.
 *
 *  WHICH interrupt latch is read is the caller's to say, and only the interrupt half moves: `closing` is
 *  monotonic on the record, so nothing can clear it out from under a parked turn. A caller that hands in
 *  a `PendingFleetStop` reads THAT turn's own interrupt instead of the record-wide flag — the fleet arm's
 *  case, where a foreign turn's start clears the record-wide one (registry.ts's PendingFleetStop, and the
 *  clear itself at fleet.ts's turn-start). The precedence between the two latches stays spelled once. */
const stoppedBy = (record: ThreadRecord, pending?: PendingFleetStop): TurnStopped | undefined =>
  record.closing ? "cancelled" : (pending ? pending.interrupted : record.interruptRequested) ? "interrupted" : undefined;

/** The same two latches as WIRE MESSAGES, for the one origin that cannot broadcast a terminal at all: a
 *  fleet turn has no id until the host's seq arrives, so it answers -33001 with the reason named instead
 *  (fleetTurnStart's `refusal`). Keyed by `stoppedBy`'s OWN terminals rather than re-testing the record,
 *  so the precedence between the two latches is spelled exactly once — this map only translates the
 *  verdict it is handed (review minor M-1: the two spellings could otherwise drift). */
const STOPPED_REFUSAL: Record<TurnStopped, string> = {
  cancelled: "Thread is busy (closing)",
  interrupted: "Turn interrupted before it started",
};

/** TurnMapper mutates its Items IN PLACE (`item.text += delta`, a tool's status/result filled in when its
 *  tool_result lands, `aborted` stamped by finalize), so buffering the ItemEvent by reference means the
 *  buffer no longer holds what it held when the event was live. A client joining mid-turn then got
 *  item/started already carrying the full text — and the deltas after it, rendering "Hello worldHello
 *  world" — or a tool "started" already reading completed with its result.
 *  Cloned HERE, at buffer time, not at replay time: the mutation is continuous, so the only moment the
 *  snapshot is still correct is the moment the event is emitted. Deltas carry no Item and need no clone.
 *
 *  `contextUsage` (M5 Task 13) is CARRIED THROUGH, and that is load-bearing rather than tidy: this function
 *  rebuilds the event field by field, so anything it forgets is dropped. This function is on BOTH origins'
 *  paths — `pushBounded` below snapshots every event into the replay buffer regardless of origin — but the
 *  two origins lose different things when it forgets a field, which is why the carry-through is defended by
 *  three rows and not by one. In-process the live wire keeps the raw event, so only REPLAY to a mid-turn
 *  subscriber is starved; on the fleet path `fleet.ts` snapshots before calling `emitItems`, so the live
 *  wire is starved too and the field never reaches a fleet client at all. Not cloned: the twin is a
 *  per-frame value the mapper never mutates (unlike the Items above), and it is relayed verbatim. */
export function snapshot(ev: ItemEvent): ItemEvent {
  return ev.kind === "delta" ? ev : { kind: ev.kind, item: structuredClone(ev.item), ...(ev.contextUsage === undefined ? {} : { contextUsage: ev.contextUsage }) };
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
 *  paths can never drift on method names or param shape.
 *
 *  `contextUsage` (M5 Task 13, spec D-M5-22) is an OPTIONAL SIBLING of `item`, spread only when the frame
 *  carried one — a `/context` turn's assistant frame does, an ordinary one does not, and the KEY'S ABSENCE
 *  is how a client tells those apart. It rides the existing item notification rather than a new channel
 *  because it belongs to that frame's turn and to nothing after it: no new method, no new notification,
 *  and `thread/contextUsage/read` untouched (that route serves the richer, turn-free control response —
 *  router.ts's own note that context usage is not bolted onto a per-turn relay still stands). */
export function itemEventNotification(threadId: string, turnId: string, ev: ItemEvent): { method: string; params: Record<string, unknown> } {
  const twin = ev.kind === "delta" || ev.contextUsage === undefined ? {} : { contextUsage: ev.contextUsage };
  if (ev.kind === "started") return { method: "item/started", params: { threadId, turnId, item: ev.item, ...twin } };
  if (ev.kind === "completed") return { method: "item/completed", params: { threadId, turnId, item: ev.item, ...twin } };
  return { method: deltaMethod(ev.channel), params: { threadId, turnId, itemId: ev.itemId, delta: ev.delta } };
}

/** Exported for ONE caller (fleet.ts's event layer, M3 Task 7): a fleet turn's items are mapped outside
 *  this module — the host's frames are the only place an own turn and a FOREIGN turn meet — but the
 *  buffer discipline they land in (clone-at-emit, drop-oldest with the start-folding exception, the cap)
 *  is not something a second emitter may re-implement, or the two paths drift on what a replayable buffer
 *  is. Nothing else about turn ownership crosses that seam. */
export function emitItems(srv: AppServer, record: ThreadRecord, turnId: string, events: ItemEvent[]): void {
  for (const ev of events) {
    pushBounded(record.buffer, turnId, ev);
    const { method, params } = itemEventNotification(record.id, turnId, ev);
    srv.broadcast(record.id, method, params);
  }
}

function statusChanged(srv: AppServer, record: ThreadRecord): void {
  srv.broadcast(record.id, "thread/status/changed", { threadId: record.id, status: threadStatus(record, srv.threadWaiter(record.id)) });
}

/** THE PARK SIDE OF AN INTERRUPT (M7), and it is two steps in a fixed order at two call sites — the two
 *  interrupt callers that hold `srv`: `turn/interrupt` below and `decision/respond`'s `abortTurn` arm
 *  (server.ts). `requestInterrupt` itself keeps its record-only signature; fleet.ts's caller is the third
 *  and needs neither step, because a fleet thread's engine is the host's and can raise no local call.
 *
 *  BOTH STEPS, IN ONE SYNCHRONOUS BLOCK, and that is the load-bearing part rather than their order between
 *  themselves. Settling releases the engine, and a released engine promptly raises one more call — inside
 *  `interrupt()` itself, which is the shape this was written against: that late call must meet a barrier
 *  that is already down, or it parks into a registry the interrupt has just swept and `interrupt()` waits
 *  on it forever. Neither of the two ways `reset()` hands control back to foreign code can reach a
 *  `parkToolCall` ahead of the latch today: `live.resolve(result)` can only schedule a microtask, and the
 *  `settled` emit that follows it (dynamicCalls.ts) runs SYNCHRONOUSLY out through this server's broadcast
 *  into every subscriber's sink — the likelier vector of the two, and the one an in-process client could
 *  actually re-enter on, yet it still returns before the reset's own loop continues. Latch-first covers
 *  both, which is why it is written as the order that stays correct if either ever stops holding — not as
 *  a difference any test can currently observe.
 *  The barrier then holds past the NEXT turn's arrival and lifts only at its dispatch (`submitRunner`),
 *  which is what makes "the interrupted turn's work is behind the new submit" provable rather than likely.
 *
 *  BEFORE THE `await`, wherever this is called. `Session.interrupt()` reaches an engine whose read loop is
 *  blocked inside the tool handler on one of these very promises — awaiting the interrupt first is the C1
 *  circular wait, exactly as awaiting `dispose()` first is in `closeRecord`. */
export function interruptParkedCalls(srv: AppServer, record: ThreadRecord): void {
  // The barrier is INPROCESS-only: a fleet turn dispatches through `fleetTurnStart`, never `submitRunner`,
  // so on that origin nothing would ever clear it — a latch that lives until `closeRecord` sweeps it,
  // guarding parks the host's engine cannot raise here anyway. The reset stays origin-blind: it is already
  // a no-op on a registry that origin can never fill.
  if (record.origin !== "fleet") srv.latchParkBarrier(record.id);
  srv.threadDynamicCalls(record.id)?.reset("turn interrupted");
}

/** Turn-end belt for an approved plan_approve that settled but never saw the engine's own
 *  post-approval status frame (the turn ended first) — an approved upgrade must never stay unapplied.
 *  Fired on EVERY completion path below, a no-op unless one is armed (planUpgrade.ts).
 *
 *  Also the turn half of `updatedAt` (registry.ts: "bumped on every settings/turn mutation"). Before this,
 *  only the settings legs bumped it, so a thread that had done nothing but run turns kept the timestamp it
 *  was created with — a recency-sorted thread list put the busiest thread at the bottom. */
function settleTurn(srv: AppServer, record: ThreadRecord): void {
  record.busy = false;
  record.turnStartedBroadcast = false;
  record.updatedAt = nowSec();
  void applyPlanUpgrade(record);
  // The drain (M2b Wave 4): the thread just went idle, so the queue's head — if the closing latch is
  // down and there is one — becomes the next turn. Synchronous, in the same step busy cleared, so a
  // turn/start arriving in this tick still sees the thread claimed rather than jumping the queue.
  const next = takeNext(record);
  if (next) startQueuedTurn(srv, record, next);
}

/** Re-enters the same spine `turn/start` uses, with the id minted back at enqueue time and NO peer to
 *  reply to — the enqueue already answered its caller. Everything a client sees from here on is
 *  notifications (turn/started, items, turn/completed), which is exactly what a turn nobody is awaiting
 *  should produce.
 *
 *  `beginTurn`'s own busy gate cannot refuse on this path, which is why its `false` is not handled here:
 *  `busy` was cleared one statement earlier, `closing` was just checked by `takeNext`, and `swapping`
 *  requires an idle thread to begin with (rewind.ts gates on the same predicate), so no reason can be up.
 *  A silent refusal here would drop a turn a client was told was queued — the invariant `takeNext`'s latch
 *  check and the flush exist to protect. */
function startQueuedTurn(srv: AppServer, record: ThreadRecord, next: QueuedTurn): void {
  beginTurn(srv, undefined, undefined, record, submitRunner(srv, record, next.input), next.id);
}

/** The busy-gate + mint + chain-callback spine `turnStart` and compact (`lifecycle.ts`'s
 *  `thread/compact/start`) share (spec Wave 2: "compaction is a turn, not a side call"). `runner` is
 *  what actually drives the engine once the turn owns the thread: `turnStart` passes a wrapper around
 *  `session.submit`; compact passes `session.compact`. Returns false when the busy gate refused (the
 *  caller already got its -33001 reply) — verbatim-moved from `turnStart`, condition for condition. */
export function beginTurn(
  // ctx/id travel together and are BOTH absent for exactly one caller: the queue drain, whose turn was
  // already replied to at enqueue time (queue.ts). Every reply below is guarded on them rather than on a
  // stub peer, so a drained turn cannot accidentally answer someone else's request id.
  srv: AppServer, ctx: ConnCtx | undefined, id: RequestId | undefined, record: ThreadRecord,
  // The runner resolves with the engine's own outcome when it has one — turnStart returns submit()'s
  // resolve so onSuccess below can read Wave T t14's additive `error` tag. A runner with no outcome to
  // report (compact) resolves void; onSuccess treats that as a clean completion.
  // `stopped` is the runner's own way of saying it never called the engine (submitRunner's post-resolution
  // latch re-check) — onSuccess reports it verbatim rather than deriving a terminal it cannot know.
  //
  // `releaseSlot` is the runner's OTHER obligation, and the whole of what keeps this turn ordered against
  // the ops chained behind it (final review R2, round 2): the chain item below is held until the runner
  // calls it, so a runner with PREPARATION to do before the engine call (submitRunner's item resolution)
  // keeps the prompt ahead of the `thread/model/set` a client sent after it. Call it the instant the
  // engine call is DISPATCHED — never at completion, which would park every chained op for the length of
  // the turn. A runner that lets its own promise settle without calling it is released by that settlement
  // (the belt below), so forgetting costs ordering, never liveness.
  runner: (turnId: string, mapper: TurnMapper, releaseSlot: () => void) => Promise<TurnOutcome>,
  presetTurnId?: string, // M2b's queue drain passes the id minted at enqueue; otherwise mintTurnId()
): boolean {
  // Gate synchronously, at request-arrival time — NOT deferred inside the chain callback below. A
  // same-tick second turn/start (two requests dispatched before any microtask runs) must see this
  // thread already claimed even when `submit()` happens to settle within the same microtask batch
  // as the chain callback's return (its completion `.then` would otherwise clear `busy` before the
  // second request's chain-deferred check ever ran — proven by turns.test.ts's busy-gate case).
  // The reason is on the wire (same shape lifecycle.ts's reinitialize gate replies): "closing" and
  // "swapping" are not the same refusal as "a turn is running", and a client that cannot tell them apart
  // retries a thread that is going away.
  const busyReason = threadBusyReason(record);
  if (busyReason) { if (ctx && id !== undefined) ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return false; }
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
  // item (e.g. a queued thread/close finishing its dispose first) — and, since round 2 of the final
  // review, it is HELD until that submit is dispatched (the slot inside the callback), so an op chained
  // BEHIND the turn reaches the engine behind its prompt as well.
  record.chain = record.chain.then(() => {
    // RE-READ the record before running anything. Every check above ran at request-arrival time, but this
    // callback can sit behind a chain item awaiting real engine I/O (a settings setter, a compact), and the
    // world moves while it waits: `thread/close` latches `closing` + flushes SYNCHRONOUSLY, so a turn
    // claimed before that latch went up would otherwise submit to an engine the close is about to dispose —
    // and its terminal event would be broadcast after closeRecord dropped the record, i.e. never heard.
    // Same for a `turn/interrupt` that landed in the wait: starting engine work the client already stopped
    // is work nobody asked for. Both settle the turn TERMINALLY here instead of running the runner:
    //  - `closing` -> "cancelled", exactly what the close flush reports for the queued turns this one was
    //    drained ahead of (queue.ts) — a turn withdrawn by the SERVER reads the same either way.
    //  - `interruptRequested` -> "interrupted", the same status onSuccess/onFailure report for a turn the
    //    CLIENT aborted, so the flag means one thing on every path out of beginTurn.
    // `closing` wins when both hold, matching threadBusyReason's precedence (registry.ts).
    // The reply follows the ENQUEUE-path contract rather than erroring: a queued turn is replied
    // `{turn:{id,status:"queued"}}` and learns its terminal status by notification, so a still-waiting
    // turn/start (or compact) caller likewise gets `{turn:{id,status}}` — an error would leave it holding
    // no id to correlate the turn/completed below with, and a caller that DID get its id (the drain) is
    // already served by the broadcast alone.
    const stopped = stoppedBy(record);
    if (stopped) {
      const turn0 = { id: turnId, status: stopped };
      settleTurn(srv, record); // clears busy and drains the next queued turn (a no-op under the closing latch)
      if (ctx && id !== undefined) ctx.peer.reply(id, { turn: turn0 });
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: turn0 });
      statusChanged(srv, record);
      return;
    }
    const turn = { id: turnId, status: "inProgress" };
    record.updatedAt = nowSec(); // a turn STARTING is activity too — not only its completion (settleTurn)
    if (ctx && id !== undefined) ctx.peer.reply(id, { turn });
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
      settleTurn(srv, record);
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: turnId, status: "failed", error: String(err) } });
      statusChanged(srv, record);
    };
    // A RESOLVED submit is not the same thing as a succeeded turn. Two different resolves reach here
    // carrying a failure, and both must be told apart from a genuine completion:
    //  - interrupt: the real engine (src/session/session.ts submit()/readLoop) does NOT reject on
    //    interrupt — interrupting an in-flight turn makes submit() RESOLVE, with the SDK result's
    //    error_during_execution subtype discarded by readLoop before this callback ever sees it. So
    //    interruptRequested is consulted on this path, not only on the rejection path below.
    //  - Task 14's `error` tag: a turn that reached a terminal result frame and reported failure (probe
    //    96's dead connection: `subtype:"success"` with `is_error:true`) now resolves error-tagged rather
    //    than rejecting. That used to land on onFailure and broadcast {status:"failed", error}. This is a
    //    ONE-SHOT broadcast that nothing later overwrites, so dropping the tag here permanently tells every
    //    subscriber a dead API completed the turn — and finalizes its open tool items `completed` too.
    // Interrupt wins when both hold: the client's own abort is the more specific cause of the failure.
    //  - a STOPPED runner: it re-checked these same latches on the far side of an await of its own (the
    //    item resolution) and refused to call the engine. It names its own terminal because this callback
    //    cannot derive one — a `closing` stop reads "cancelled" here exactly as it does in the pre-runner
    //    guard above, and reporting "completed" for a turn that never ran is the one lie this spine
    //    cannot afford. It outranks the flag read below: `interruptRequested` is only ONE of the two
    //    latches, and a close that raced an interrupt must still read as the withdrawal it was.
    const onSuccess = (outcome: TurnOutcome) => {
      const stopped = outcome?.stopped;
      const interrupted = !stopped && record.interruptRequested;
      const failure = stopped || interrupted ? undefined : outcome?.error;
      emitItems(srv, record, turnId, mapper.finalize(stopped !== undefined || interrupted || failure !== undefined));
      settleTurn(srv, record);
      const turn2: Record<string, unknown> = { id: turnId, status: stopped ?? (interrupted ? "interrupted" : failure ? "failed" : "completed") };
      if (failure) turn2.error = failure.message;
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: turn2 });
      statusChanged(srv, record);
    };
    const onFailure = (err: unknown) => {
      // Snapshotted FIRST — before settleTurn, exactly as onSuccess does. settleTurn drains the queue
      // SYNCHRONOUSLY, and the drain re-enters beginTurn, which clears `interruptRequested` in its own
      // arrival-time section. Reading the flag afterwards therefore reads the NEXT turn's freshly-cleared
      // value, and an aborted turn that happened to have a successor queued behind it reported `failed`
      // with an error tag instead of `interrupted` (external review 2026-08-11).
      const interrupted = record.interruptRequested;
      emitItems(srv, record, turnId, mapper.finalize(true));
      settleTurn(srv, record);
      const status = interrupted ? "interrupted" : "failed";
      const turn2: Record<string, unknown> = { id: turnId, status };
      if (status === "failed") turn2.error = String(err);
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: turn2 });
      statusChanged(srv, record);
    };
    // THE CHAIN SLOT, held through the runner's PREPARATION AND DISPATCH and not one step further
    // (final review R2, round 2). Before this the callback returned as soon as the runner was INVOKED,
    // which is the same instant only for a runner that dispatches synchronously: an items turn resolves
    // its input first, and the chain released into that window, so a `thread/model/set` sent AFTER the
    // turn reached the engine BEFORE its prompt. The outcome promise stays detached below, so the slot
    // is never held for the turn's own duration — a setter mid-turn is a real feature (settings.ts).
    let releaseSlot!: () => void;
    const dispatched = new Promise<void>((r) => { releaseSlot = r; });
    try {
      // Guarded: the runner throwing SYNCHRONOUSLY (rather than returning a rejected promise) must
      // never leave record.chain rejected — an uncaught rejection here crashes the process AND wedges
      // the thread forever (busy stays true, and every later chain-scoped request for this thread —
      // e.g. thread/close — silently never replies because its .then() never runs on a rejected chain).
      // The try/catch below is belt-and-suspenders with the .catch(reportFailed): the try/catch covers
      // a throw before the runner ever returns a promise; the .catch covers onSuccess/onFailure
      // themselves throwing after the runner's promise settles.
      const outcome = runner(turnId, mapper, releaseSlot);
      // THE BELT ON THE SLOT: a path out of the runner that never dispatched and never released — an
      // item resolution that REJECTED, say — must not leave the chain held forever, which would wedge
      // this thread exactly as a rejected chain does. Resolving a promise twice is a no-op, so the
      // ordinary path still releases at dispatch and this only ever covers what dispatch missed.
      void outcome.then(releaseSlot, releaseSlot);
      outcome.then(onSuccess, onFailure).catch(reportFailed);
    } catch (err) {
      releaseSlot();   // a synchronous throw is a way out of the runner too, and the slot is owed a release on every one
      reportFailed(err);
    }
    return dispatched;
  });
  return true;
}

/** Thrown SYNCHRONOUSLY by `submitRunner` when a content-block turn reaches an engine that never
 *  declared `submitContent` (registry.ts's OPTIONAL capability) — the drain-time engine-swap window,
 *  where the capability was present at enqueue time and gone by the time this turn's slot came up.
 *  Never a silent downgrade: an engine that cannot carry the blocks says so, loudly, rather than running
 *  a truncated text-only prompt (the F9 failure mode this whole track exists to end). */
export class EngineCapabilityError extends Error {}

/** Resolves `submitContent`, or throws `EngineCapabilityError` naming the capability by name — the ONE
 *  place that check is spelled, so `submitRunner` below and any future caller (the queue drain reaches
 *  it through `submitRunner` already) report the identical refusal rather than each re-deriving "does
 *  this engine have submitContent" inline (F10 T-IMGREACH Task 9/I3c). */
export function requireSubmitContent(session: EngineSession): NonNullable<EngineSession["submitContent"]> {
  const fn = session.submitContent;
  if (!fn) throw new EngineCapabilityError("engine does not support content submission");
  return fn;
}

/** `steerContent`'s own gate (Task 9/I3c) — deliberately NOT a fallback onto `requireSubmitContent` or
 *  onto the string-only `steer` member: an engine can have either, both, or neither of the two content
 *  capabilities, and a mis-route through the wrong one would start a NEW turn (submitContent) or feed an
 *  array to a string-only embedder (steer) instead of honestly refusing. The future `turn/steerContent`
 *  handler (Task 11) calls this before touching anything else. */
export function requireSteerContent(session: EngineSession): NonNullable<EngineSession["steerContent"]> {
  const fn = session.steerContent;
  if (!fn) throw new EngineCapabilityError("engine does not support content steering");
  return fn;
}

/** The prompt-submitting runner, shared by `turn/start` and the queue drain (F10 T-IMGREACH Task 8/I3b
 *  widened it from a bare string to `UserTurnInput`): it ROUTES on the input's form — a string goes to
 *  `submit` (the unchanged, always-present embedder contract) and a content-block array goes to
 *  `submitContent` (the OPTIONAL capability). There is no flattening arm: an array reaching a
 *  string-only engine is a REFUSAL, not a downgrade. It also carries the live prompt echo
 *  (`flattenForDisplay`, session/turnInput.ts) so a drained image turn and a live one render identically.
 *  Factored out so a drained turn is byte-for-byte the same turn it would have been had the client sent
 *  it when the thread was idle.
 *
 *  The returned function is NOT `async`: a plain function so a synchronous throw — `record.session.submit`
 *  throwing, or the `submitContent` capability check failing — still propagates synchronously out of the
 *  runner call, exactly as it did in the pre-extraction code where submit() was called directly inside
 *  beginTurn's own try. Wrapping it in `async`/`await` would have the JS engine absorb that synchronous
 *  throw into a REJECTED promise instead, routing it through onFailure (which consults
 *  interruptRequested) rather than the try/catch's reportFailed (which always reports "failed") — a real
 *  divergence for a turn/interrupt landing the same tick as a synchronously-throwing submit(), and
 *  exactly the guarantee `EngineCapabilityError` above needs: it must reach `beginTurn`'s own try and be
 *  reported `failed` with its message, not silently swallowed into an interrupted-looking rejection.
 *  The submit/submitContent promise is returned AS-IS so beginTurn's onSuccess can read Wave T t14's
 *  additive `error` tag off the resolve.
 *
 *  THE TAGGED ITEMS ARM (queue.ts's `QueuedInput`) is the only one with an await in it: `turn/start`'s
 *  wire items are resolved HERE, in the turn's own slot, and the already-validated blocks of
 *  `turn/startContent` go straight through. Both end at the same `drive`, so an items turn and a staged
 *  turn reach the engine by the same route and under the same capability gate. */
export function submitRunner(srv: AppServer, record: ThreadRecord, input: QueuedInput) {
  return (turnId: string, mapper: TurnMapper, releaseSlot: () => void): Promise<TurnOutcome> => {
    const drive = (resolved: UserTurnInput): Promise<TurnOutcome> => {
      // gap 6, probe-70 ALIVE branch: the server mints the transcript uuid itself and reuses it as the
      // live userMessage item's id, so the id equals what the SDK will persist — the item can safely join
      // the replay buffer (emitItems below) under the normal id-dedup stitch instead of being live-only.
      // Stays inside the runner (not beginTurn): compact has no user prompt to echo.
      const userUuid = randomUUID();
      // ONE display string for both forms (`flattenForDisplay`), so a live user item and its replayed twin
      // are one function's output — and so an image reads as its `[Image #N]` placeholder rather than as
      // the base64 that carried it, describing what the model was actually handed, degrade notes and all.
      emitItems(srv, record, turnId, [{ kind: "completed", item: userItem(flattenForDisplay(resolved), userUuid) }]);
      // M7: THE PARK BARRIER LIFTS HERE and at no earlier moment. A prior `turn/interrupt` closed this
      // thread to new parks (`interruptParkedCalls`) precisely so a CallTool the interrupted turn had
      // already issued could not be rebound to its successor — and the successor's ARRIVAL is too early to
      // reopen: an items-form turn resolves its input first, so between arrival and this line the old
      // engine's straggler is still in flight with a fresh `activeTurnId` waiting to adopt it. Dispatch is
      // the first instant at which the new submit is provably ahead of that work. Inside `drive` rather
      // than beside either `releaseSlot`, so both input forms lift it once and the runner's `stopped`
      // early return — which releases the slot without ever reaching the engine — does not.
      srv.clearParkBarrier(record.id);
      const onMessage = (m: unknown) => emitItems(srv, record, turnId, mapper.ingest(m));
      // ROUTED ON THE RESOLVED FORM: a string goes to `submit` (the unchanged, always-present embedder
      // contract), a block array to `submitContent` (the OPTIONAL capability). There is no flattening arm —
      // an array reaching a string-only engine is a REFUSAL, not a downgrade.
      if (typeof resolved === "string") return record.session.submit(resolved, onMessage, { uuid: userUuid });
      return requireSubmitContent(record.session).call(record.session, resolved, onMessage, { uuid: userUuid });
    };
    // A STRING takes the exact path it always did, synchronously — see the header on why this function is
    // not `async`. So do already-validated blocks: only the items form has an await to put anything on the
    // far side of. The slot is released the moment `drive` has been called, which for these forms is before
    // the caller gets the promise back at all: the engine call was already reached inside it.
    if (!isQueuedItems(input)) { const submitted = drive(input); releaseSlot(); return submitted; }
    // The items form resolves HERE, in the turn's own ordered execution slot: a queued turn that drains
    // into this runner is byte-for-byte the turn a direct start would have produced. The chain slot is
    // held ACROSS that resolution — that is the whole point of it — and released on both of its ends.
    return resolveInputItems(input.items).then((resolved) => {
      // …and the latches are re-read before anything reaches the engine. Resolution opens files and can
      // take real time; a thread/close disposing this very engine, or a turn/interrupt, can land inside
      // it, and every check that admitted this turn ran before it.
      const stopped = stoppedBy(record);
      if (stopped) { releaseSlot(); return { stopped }; }
      const submitted = drive(resolved);
      releaseSlot();       // the prompt is on the engine's input queue — anything chained behind this turn may go
      return submitted;
    });
  };
}

/** The fleet arm of `turn/start` (M3 §1b): gate, submit, reply — and NOTHING else. No mint (the id is
 *  derived from the host's seq, registry.ts's `fleetTurnId`), no busy claim, no broadcast: the fleet event
 *  layer (fleet.ts) is the SOLE turn-lifecycle owner for this origin, because the host's `turn` events are
 *  the only channel on which this client's own turn and another client's look the same. Claiming any of it
 *  here would double every edge for own turns and leave foreign ones unclaimed.
 *
 *  The seq — hence the id this caller is owed — arrives on `onAccepted`, the engine's one race-free seq
 *  channel (fleetEngine.ts): deriving it from "the next turn-start we saw" is wrong on the refusal path,
 *  where a foreign turn's start can land between the op leaving and the busy reply coming back. The reply
 *  therefore goes out from that callback, and the `turn/started` this turn has ALREADY provoked (the host
 *  emits turn-start before the prompt reply) is legitimately ahead of it — the derived id is the same one
 *  either way, which is the whole point of deriving it.
 *
 *  `onMessage` is inert: those same frames reach fleet.ts's mapper through `onFrame`, and feeding both
 *  would itemize every own turn twice. The uuid is minted and stamped anyway (§1a-b): it is what keeps the
 *  live user item's id equal to the row the host will persist, so the two join under the normal id-dedup
 *  stitch instead of appearing twice in a client's transcript. */
function fleetTurnStart(srv: AppServer, ctx: ConnCtx, id: RequestId, record: ThreadRecord, input: string | InputItem[]): void {
  const userUuid = randomUUID();
  let replied = false;
  // SYNCHRONOUS ADMISSION RESERVATION (final review R3), set at request arrival BEFORE the chained submit
  // below. `threadBusyReason` now reads it as "turn", so a second turn/start dispatched in the same tick —
  // before the host has echoed this turn's start and set `record.busy` — is refused -33001 instead of
  // overwriting `fleetStartAck` and racing a second submit onto fleetEngine's one-submit guard (which
  // rejected "already in flight" and cleared the FIRST turn's ack, reintroducing the F2 completed-before-
  // reply bug under the race). Cleared on `onAccepted` (the host confirmed the turn; `record.busy`, set by
  // the event layer's turn-start ahead of the prompt reply, now owns busy) or when the submit fails before
  // it accepted a seq.
  record.fleetTurnPending = true;
  // Reset at arrival, exactly as beginTurn does (turns.ts:168) and for the same same-tick reason: a prior
  // interrupted turn leaves the record-wide latch standing (its onTurn 'end' does not clear it), and a
  // stale flag must not describe this fresh turn. Safe because turn/start only reaches here when the
  // thread is idle (the busy gate refuses -33001 before the origin branch), so no in-flight turn's latch
  // is clobbered.
  record.interruptRequested = false;
  // THIS TURN'S OWN STOP LATCH, and the only interrupt signal the guards below read (whole-branch review
  // P1). The record-wide flag above cannot carry a PENDING fleet turn's cancellation: `fleet.ts` clears it
  // on EVERY host turn-start, foreign ones included, so a stranger's turn starting and ending inside this
  // turn's resolution/staging window erased the interrupt and the prompt the client had already stopped
  // went out anyway. Installed at arrival so `turn/interrupt` can find it (requestInterrupt raises it),
  // and taken down only by this turn's own settlement — the guards keep reading the object itself, so an
  // uninstall can never blind a check that is still owed one.
  const pending: PendingFleetStop = { interrupted: false };
  record.fleetPendingStop = pending;
  // THE CHAIN SLOT (final review R2, round 2), the fleet analog of beginTurn's own. Held from the chain
  // callback below until this turn has either reached the host — `onAccepted`, the one race-free signal
  // that the prompt op is in the host's hands — or terminally failed to. Before this the callback returned
  // once dispatch STARTED, which for an items turn is a whole staging round trip before the prompt op
  // leaves, so a `thread/model/set` chained behind the turn overtook its prompt on the host wire.
  // No deadlock rides on it: `turn/interrupt` does not chain at all (it raises the latches directly), and
  // every path out of `dispatch` clears the reservation, including the socket-death rejection.
  let releaseSlot!: () => void;
  const dispatched = new Promise<void>((r) => { releaseSlot = r; });
  const clearReservation = (): void => {
    record.fleetTurnPending = false;
    if (record.fleetPendingStop === pending) record.fleetPendingStop = undefined;   // identity-guarded, like clearAck
    releaseSlot();   // one rule, one site: the reservation ending IS "the host has it, or never will"
  };
  // F2: the promise the event layer (fleet.ts) holds a trivially-fast turn's turn/completed edge (and, for
  // R4, this turn's own item emissions) behind until the inProgress reply is out. ARMED AT THE DISPATCH
  // EDGE — the engine's `onPromptDispatch`, one tick before the prompt op is written (final review round 4)
  // — and never earlier: every earlier moment defers a FOREIGN turn that ran in the gap, which is a
  // reordering of another client's turn behind ours. At arrival the gap is a slow prior chain item; at
  // submit-time (round 3's arming point) it is the whole staging sequence, one host round trip per image.
  // Nothing of OURS can arrive before that edge — the host has not been told about this prompt — so the
  // barrier protects nothing it gives up. Resolved the instant onAccepted publishes the reply, and on the
  // failure path so a deferred completed is never stranded.
  let releaseAck!: () => void;
  const ack = new Promise<void>((r) => { releaseAck = r; });
  // Identity-guarded, which is also what makes it a safe no-op on a turn that never reached the dispatch
  // edge (a latch caught inside staging, a staging failure): there is no ack on the record to take down,
  // and resolving `ack` releases a promise nobody is holding.
  const clearAck = (): void => { if (record.fleetStartAck === ack) record.fleetStartAck = undefined; releaseAck(); };
  // The ONE refusal both this turn's awaits answer with — the chain wait below, and the item resolution
  // after it. A fleet turn has no id until the host's seq arrives, so it cannot broadcast a synthesized
  // turn/completed the way beginTurn does; the honest terminal is the same -33001 the busy gate gives,
  // with the reason named. Handed to the ENGINE too (`opts.aborted`), which owns a third await of its
  // own — the staging round trip an image prompt opens with.
  // DERIVED from `stoppedBy`, never a second reading of the record: which latch wins when both hold is
  // that function's answer, and this arm only names it (see STOPPED_REFUSAL). The interrupt half is read
  // off `pending`, this turn's own latch, and never off the record-wide flag a foreign turn can clear.
  const refusal = (): string | undefined => { const stopped = stoppedBy(record, pending); return stopped && STOPPED_REFUSAL[stopped]; };
  const refuse = (message: string): void => { clearReservation(); ctx.peer.replyError(id, ERR.BUSY, message); };
  // Cast, not a widened `EngineSession`: `onAccepted` is a FLEET engine's member (fleetEngine.ts widens
  // submit for it), and declaring it on the shared interface would promise a callback the in-process
  // engine never fires. `record.origin === "fleet"` is the guarantee behind it — fleet.ts is the only
  // writer of that pair.
  const engine = record.session as unknown as FleetEngineSession;
  /** Everything from the submit to the host's reply, for whichever prompt this turn ended up with — the
   *  resolved blocks for an items turn, the string itself otherwise. `onAccepted` lives in here because
   *  the user item it echoes is the RESOLVED input's flat preview (an image reads as its `[Image #N]`
   *  placeholder), which does not exist until the prompt does. */
  const dispatch = (prompt: UserTurnInput): void => {
    const onAccepted = (seq: number): void => {
      const turnId = fleetTurnId(record, seq);
      replied = true;
      clearReservation();   // the host has the turn; `record.busy` (set by the event layer's turn-start) now owns busy
      ctx.peer.reply(id, { turn: { id: turnId, status: "inProgress" } });
      emitItems(srv, record, turnId, [{ kind: "completed", item: userItem(flattenForDisplay(prompt), userUuid) }]);
      clearAck();   // the reply is out — release any completed edge (and own-turn items, R4) the event layer deferred onto it
    };
    // ARMED BY THE ENGINE, at the tick it writes the prompt op (see the ack note above) — not here, where
    // an items turn's staging still stands between this call and the wire. A string prompt reaches that
    // edge inside this same tick, so its arming is where it always was.
    const onPromptDispatch = (): void => { record.fleetStartAck = ack; };
    engine.submit(prompt, () => {}, { uuid: userUuid, onAccepted, aborted: refusal, onPromptDispatch }).catch((e: unknown) => {
      clearReservation();
      clearAck();   // the reply will never come — don't strand a deferred turn/completed (F2)
      // Once the reply is out, this turn's outcome belongs to `turn/completed` off the host's own turn end
      // — a rejection here (the connection died mid-turn) is §1f's death sequence, not a second answer.
      if (replied) return;
      // The host's busy refusal, carrying the code the turns spine answers with (FleetBusyError). Read off
      // the value rather than by class, so any engine that refuses the same way answers the same way —
      // which is also how the engine's OWN `aborted` refusal (a latch that came up inside the staging
      // round trip) arrives here reading exactly like the pre-submit one.
      const code = (e as { code?: unknown } | null)?.code;
      if (code === ERR.BUSY) { ctx.peer.replyError(id, ERR.BUSY, e instanceof Error ? e.message : "Thread is busy (turn)"); return; }
      // F6: a socket death after dispatch but before the prompt ack rejects submit with the engine's
      // connection-closed error, which carries no `code`. `isEnded()` is the death latch dispatch's own
      // -33005 gate reads (fleetEngine.ts), so a rejection from a dead engine maps to ENGINE_GONE — the same
      // reconnectable-host-loss signal every other fleet op answers — while a genuine unexpected throw on a
      // LIVE engine stays INTERNAL, so a client can tell a server bug from a host it can recover by re-attach.
      if (engine.isEnded()) { ctx.peer.replyError(id, ERR.ENGINE_GONE, e instanceof Error ? e.message : String(e)); return; }
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    });
  };
  // THROUGH record.chain (final review R2): the prompt now orders BEHIND any prior chain mutation
  // (thread/model/set, thread/clear), so it reaches the host after the forwarded op instead of racing
  // ahead of it — the app server's own ordering, which the pre-fix immediate submit bypassed. The
  // reservation above was taken synchronously, so admission (busy) is still decided at arrival, not on
  // the chain.
  record.chain = record.chain.then(() => {
    // Re-read: a thread/close that latched `closing`, or a turn/interrupt that landed while this waited on
    // the chain (or in the very same tick), must not submit to an engine the client is done with. This
    // mirrors beginTurn's own re-read (turns.ts:197), which settles the turn TERMINALLY on either latch —
    // but the fleet turn has NO id until the host's seq arrives on onAccepted, so it cannot broadcast a
    // synthesized turn/completed the way beginTurn does; the honest answer is the same -33001 the busy gate
    // gives, exactly as the `closing` branch already documents. `fleetStartAck` is assigned AFTER this guard
    // (since round 4, later still — at the engine's dispatch edge), so no ack cleanup is owed on either path.
    // `dispatched` is returned on EVERY path out of this callback, and the refusal paths have already
    // resolved it through `refuse` -> `clearReservation`: the chain item ends exactly when this turn's
    // reservation does, which is one rule rather than a per-branch judgement.
    const stopped = refusal();
    if (stopped) { refuse(stopped); return dispatched; }
    if (typeof input === "string") { dispatch(input); return dispatched; }
    // The items form resolves in THIS turn's slot, and the chain holds until it finishes — so the prompt
    // still leaves for the host behind any prior chain mutation (R2) rather than out of a callback that
    // escaped the ordering. The RETURNED promise is what keeps that true. It holds past the resolution
    // too, through the staging round trip `dispatch` opens, until the host answers.
    return resolveInputItems(input).then((resolved) => {
      // RE-CHECKED, on the far side of the read: a thread/close (which is about to dispose this engine) or
      // a turn/interrupt can land inside a resolution that opened files, and every check that admitted
      // this turn ran before it.
      const late = refusal();
      if (late) { refuse(late); return dispatched; }
      dispatch(resolved);
      return dispatched;
    }, (e: unknown) => {
      // The resolver degrades rather than throwing, so reaching here is a bug or an out-of-memory — but an
      // unhandled rejection HERE would reject record.chain and wedge this thread forever (every later
      // chain-scoped request for it, thread/close included, silently never replies). So it is caught, the
      // reservation released, and the caller told.
      clearReservation();
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
      return dispatched;   // already resolved by the line above — the same one rule as every branch here
    });
  });
}

/** The three queue-full refusals, spelled off the caps themselves so the message can never drift from the
 *  number it quotes. Which cap was hit is the whole content of the message: the client's next move is the
 *  same either way (retry after the drain), but "too many turns", "this one entry is too big" and "the
 *  queue as a whole is too full" are different things to have done. */
const QUEUE_FULL: Record<"entries" | "entry" | "bytes", string> = {
  entries: `turn queue is full (max ${MAX_QUEUED_TURNS} queued turns)`,
  entry: `turn entry too large (max ${MAX_QUEUED_ENTRY_BYTES / 1024 / 1024} MiB per entry)`,
  bytes: `turn queue is full (max ${MAX_QUEUED_BYTES / 1024 / 1024} MiB queued input)`,
};

export const turnStart: Handler = (srv, ctx, id, params) => {
  const parsed = turnStartParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // The one origin refusal that does NOT live in the dispatch gate (M3 §1c), because it is scoped to a
  // FLAG rather than to the method: `turn/start` itself is fully supported for fleet threads, but the
  // server-side queue rides ownership of the engine chain, which a fleet thread's host never hands over —
  // draining an entry later would mean retrying over busy refusals, racing every other host client for a
  // turn slot. Checked BEFORE the busy branch, not inside it: the flag is unsupported for this origin
  // whatever the thread happens to be doing, and a client that only learned that on the one call that
  // happened to arrive mid-turn would have built its queueing UI on a capability it never had.
  if (record.origin === "fleet" && parsed.data.queue) { ctx.peer.replyError(id, ERR.UNSUPPORTED_FOR_ORIGIN, ORIGIN_REFUSAL_MESSAGE); return; }
  // The busy branch is resolved HERE rather than left to beginTurn's own gate, because `queue:true` turns
  // one of its outcomes into an acceptance. Gated on the ONE predicate (spec D-M2-8), never a re-assembled
  // condition — and the queue is offered for exactly one of its reasons:
  //  - "turn": a turn is running and WILL settle, and settleTurn is what drains the queue. Enqueue.
  //  - "closing": the queue was flushed at close and is never re-admitted (queue.ts) — an entry accepted
  //    now would sit forever, so this refuses exactly as the unflagged call does.
  //  - "swapping": an engine swap never runs settleTurn, so nothing would ever drain the entry either.
  // Both refusals keep the reason on the wire: a client that cannot tell "retry in a moment" from "this
  // thread is going away" retries the wrong one.
  const busyReason = threadBusyReason(record);
  if (busyReason) {
    if (parsed.data.queue && busyReason === "turn") {
      const q = enqueueTurn(record, asQueuedInput(parsed.data.input));
      // At capacity the thread is busy AND has nowhere to put this — same -33001 the unflagged call gets,
      // since the client's move is the same one (retry after the queue drains), with the cap it hit named.
      if (!q.ok) { ctx.peer.replyError(id, ERR.BUSY, QUEUE_FULL[q.reason]); return; }
      ctx.peer.reply(id, { queued: true, turn: { id: q.id, status: "queued" }, position: q.position });
      // Reply first, notify second — beginTurn's own turn/started ordering, for the same reason: the
      // caller's answer must not depend on the fan-out, and every OTHER subscriber needs the id before it
      // can be handed a turn/started or a turn/completed{cancelled} naming it (Task 4 review adjudication).
      // The enqueuer hears it too if it is subscribed, once, like every other thread-scoped notification —
      // deduped by Peer identity in `broadcast`, so a client can render the queue from one event stream
      // instead of merging its own replies into it.
      const queued = queuedNotification(record.id, q.id, q.position);
      srv.broadcast(record.id, queued.method, queued.params);
    } else {
      ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`);
    }
    return;
  }
  // The origin branch (M3 §1b) sits AFTER the gates and replaces only the spine: everything above — the
  // params, the thread lookup, the queue-flag refusal, the busy gate — is origin-blind on purpose, so a
  // fleet thread answers the same refusals in the same order as an inProcess one.
  if (record.origin === "fleet") { fleetTurnStart(srv, ctx, id, record, parsed.data.input); return; }
  beginTurn(srv, ctx, id, record, submitRunner(srv, record, asQueuedInput(parsed.data.input)));
};

/** The result of `prepareStagedContent`'s gates 1-8 (params validation stays with each caller, since the
 *  two methods' param shapes differ): the blocks are assembled and capped, the reservation is live, and
 *  `enqueueArmed` tells the caller which of its OWN step-9/10 arms to run. Returned only on a path that
 *  did NOT already reply — every refusal below replies for itself and returns `undefined` instead. */
interface PreparedContent { record: ThreadRecord; blocks: UserContentBlock[]; token: string; enqueueArmed: boolean }

/** Gates 2-8 of the staged-image content pipeline, shared byte-for-byte by `turn/startContent` (Task
 *  10/I3d) and `turn/steerContent` (Task 11/I3e) — the task brief's "one helper, not two copies of ten
 *  gates". THE GATE ORDER IS THE CORRECTNESS (both briefs): every refusal below runs BEFORE the
 *  reservation it would otherwise have to unwind, and every refusal that lands AFTER the reservation
 *  aborts it rather than leaking it:
 *    2. thread lookup     -> THREAD_NOT_FOUND
 *    3. fleet origin gate -> UNSUPPORTED_FOR_ORIGIN (F10 ships no fleet staging client — a fact about the
 *       ORIGIN, `refuseFleetContent`, fleetEngine.ts — never an absent-capability accident)
 *    4. THE ONE GATE THAT GENUINELY DIFFERS PER CALLER, injected as `busyGate`: `turn/startContent`
 *       enqueues on "busy WITH A TURN" when `queue:true`; `turn/steerContent` has no queue at all and
 *       instead REQUIRES a turn in flight ("no turn in flight" otherwise, mirroring `turnSteer`'s own
 *       gate). The callback replies its OWN refusal (the two wire errors are shaped differently) and
 *       returns `undefined` to signal "already answered"; `{enqueueArmed}` to proceed.
 *    5. THE OTHER GATE THAT DIFFERS, injected as `requireCapability`: `requireSubmitContent` for
 *       `turn/startContent`, `requireSteerContent` for `turn/steerContent` — Task 9's two capabilities,
 *       never routed through each other. Checked ONLY on the immediate (non-enqueued) path: an
 *       engine-swap window between enqueue and drain is the queue drain's own problem
 *       (`submitRunner`/`requireSubmitContent`, already proven by queue-content-drain.test.ts's I3b
 *       cell), not a reason to refuse the enqueue — and `turn/steerContent` never enqueues, so this
 *       check always runs on that path.
 *    6. reserve, ATOMIC — takes every staged id or none (imageStage.ts's `reserve`)
 *    7. assemble via `normalizeValidatedBlocks`, NEVER the full `normalizeTurnInput`: the staged blocks
 *       were already decoded once, at stage completion (the validate-once contract Task 7 exists to keep),
 *       and re-running the decode half of the normalizer would defeat the whole point of that cache
 *    8. per-turn aggregate, from the reservation's own cached PER-BLOCK bytes, summed ONLY over the
 *       images step 7 actually KEPT (F10 fix-wave round-2 review finding P2: `reservation.decodedBytes`
 *       sums every REQUESTED id, so a caller naming one stage more than `MAX_IMAGES_PER_PROMPT` times was
 *       refused on bytes belonging to images the truncated turn never sends — a 21-reference reservation
 *       whose 20 surviving images sit exactly at the aggregate cap was rejected on the 21st's bytes
 *       alone). No second decode either — `perBlockBytes` rides the same per-stage cache `decodedBytes` did.
 *  Gates 9 (queue admission/begin vs. push onto the live prompt stream) and 10 (commit) are NOT shared:
 *  they are the one place the two methods are not the same operation at all, so they stay in each
 *  handler below. */
function prepareStagedContent(
  srv: AppServer, ctx: ConnCtx, id: RequestId, threadId: string, text: string | undefined, stagedImageIds: string[],
  busyGate: (record: ThreadRecord) => { enqueueArmed: boolean } | undefined,
  requireCapability: (session: EngineSession) => unknown,
): PreparedContent | undefined {
  const record = srv.registry.get(threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return undefined; }
  const fleetRefusal = refuseFleetContent(record.origin);
  if (fleetRefusal) { ctx.peer.replyError(id, fleetRefusal.code, fleetRefusal.message); return undefined; }
  const gated = busyGate(record);
  if (!gated) return undefined; // busyGate already replied its own refusal
  if (!gated.enqueueArmed) {
    try { requireCapability(record.session); }
    catch (e) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, e instanceof Error ? e.message : String(e)); return undefined; }
  }
  const reserved = srv.imageStages.reserve(ctx.connId, stagedImageIds);
  if (!reserved.ok) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, reserved.message); return undefined; }
  const { reservation } = reserved;
  const textBlock: UserContentBlock[] = text === undefined ? [] : [{ type: "text", text }];
  const blocks = normalizeValidatedBlocks([...textBlock, ...reservation.blocks]);
  // Bytes for only the images `normalizeValidatedBlocks` actually KEPT (F10 fix-wave round-2 review
  // finding P2) — a plain reference-identity lookup, not `reservation.decodedBytes` (which sums every
  // REQUESTED id, including ones the image-count cap just degraded to a text block above).
  const bytesByBlock = new Map<UserContentBlock, number>();
  reservation.blocks.forEach((b, i) => bytesByBlock.set(b, reservation.perBlockBytes[i]!));
  const retainedBytes = blocks.reduce((n, b) => n + (bytesByBlock.get(b) ?? 0), 0);
  if (retainedBytes > MAX_AGGREGATE_BYTES) {
    srv.imageStages.abort(reservation.token);
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `turn's total image size exceeds the ${MAX_AGGREGATE_BYTES}-byte limit`);
    return undefined;
  }
  return { record, blocks, token: reservation.token, enqueueArmed: gated.enqueueArmed };
}

/** `turn/startContent` (F10 T-IMGREACH Task 10/I3d): the wire completion of a staged-image turn — the
 *  handler side of the `image/stage` + `turn/startContent` pair, both registered `experimental: true`
 *  (schema/index.ts) because an old server must answer METHOD_NOT_FOUND for either rather than silently
 *  accepting a widened `turn/start` and running a text-only turn with nobody told (the F9 failure this
 *  whole track exists to end). Gates 2-8 run inside `prepareStagedContent`; steps 9-10 (queue admission
 *  or begin, then commit) are this method's own, since a fresh turn is what makes it `turn/startContent`
 *  rather than `turn/steerContent`. */
export const turnStartContent: Handler = (srv, ctx, id, params) => {
  const parsed = turnStartContentParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const prepared = prepareStagedContent(
    srv, ctx, id, parsed.data.threadId, parsed.data.text, parsed.data.stagedImageIds,
    (record) => {
      // Gate 4 (`turn/start`'s own arm, verbatim): `queue:true` on a thread busy WITH A TURN enqueues
      // instead of refusing; every other busy reason refuses outright with the reason named.
      const busyReason = threadBusyReason(record);
      const enqueueArmed = busyReason === "turn" && parsed.data.queue === true;
      if (busyReason && !enqueueArmed) { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return undefined; }
      return { enqueueArmed };
    },
    requireSubmitContent,
  );
  if (!prepared) return;
  const { record, blocks, token, enqueueArmed } = prepared;
  // Step 9: queue admission (a refusal here happens before any turn id is minted, `enqueueTurn`'s own
  // invariant) or begin (`beginTurn`'s busy gate cannot fire here, since gate 4 already established the
  // thread is not busy on this path, but the abort-on-refusal is kept for defensive symmetry).
  if (enqueueArmed) {
    const q = enqueueTurn(record, blocks);
    if (!q.ok) { srv.imageStages.abort(token); ctx.peer.replyError(id, ERR.BUSY, QUEUE_FULL[q.reason]); return; }
    srv.imageStages.commit(token); // step 10 — only now are the staged entries actually deleted
    ctx.peer.reply(id, { queued: true, turn: { id: q.id, status: "queued" }, position: q.position });
    const queued = queuedNotification(record.id, q.id, q.position);
    srv.broadcast(record.id, queued.method, queued.params);
    return;
  }
  const started = beginTurn(srv, ctx, id, record, submitRunner(srv, record, blocks));
  if (!started) { srv.imageStages.abort(token); return; } // beginTurn already replied BUSY
  srv.imageStages.commit(token); // step 10
};

/** `turn/steerContent` (F10 T-IMGREACH Task 11/I3e): the mid-turn twin of `turn/startContent` — a
 *  content-carrying injection onto the RUNNING turn's own input stream, never a new turn. Gates 2-8 are
 *  `prepareStagedContent`'s (shared, byte-for-byte, with `turn/startContent` above); the two
 *  substitutions the task brief calls for are gate 4 and gate 5 below.
 *
 *  Gate 4 mirrors `turnSteer`'s own eligibility check exactly (see that handler's header for the full
 *  reasoning): eligibility is `record.busy && record.turnStartedBroadcast`, not `busy` alone — a
 *  same-tick `turn/start`+`turn/steerContent` pair, or any turn whose chain callback is parked behind
 *  earlier engine I/O, would otherwise let this jump ahead of the prompt it means to steer. "closing"/
 *  "swapping" answer the standard -33001 (there is no turn a steer could reach); idle answers -32602 "no
 *  turn in flight" — the busy convention's inverse, since nothing about the thread is unavailable, the
 *  request simply has no referent. There is no enqueue arm at all: `turnSteerContentParams` carries no
 *  `queue`, so `enqueueArmed` is always `false` here and gate 5 always runs.
 *
 *  Gate 5 is `requireSteerContent`, never `requireSubmitContent` — routing through the wrong capability
 *  would either start a brand-new turn (`submitContent`) or hand an array to a string-only `steer`
 *  member, both of which Task 9's two-capability split exists to prevent.
 *
 *  No queue admission, no `beginTurn`, no turn/started, no item broadcast — pushing onto the engine's
 *  own input queue is all a steer ever does (`turnSteer`'s own header: "a steer is not a turn edge"),
 *  so step 9 here is just the capability call, and step 10 is the same commit every content method
 *  ends on. */
export const turnSteerContent: Handler = (srv, ctx, id, params) => {
  const parsed = turnSteerContentParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const prepared = prepareStagedContent(
    srv, ctx, id, parsed.data.threadId, parsed.data.text, parsed.data.stagedImageIds,
    (record) => {
      const busyReason = threadBusyReason(record);
      if (busyReason && busyReason !== "turn") { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return undefined; }
      if (!(record.busy && record.turnStartedBroadcast)) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "no turn in flight"); return undefined; }
      return { enqueueArmed: false };
    },
    requireSteerContent,
  );
  if (!prepared) return;
  const { record, blocks, token } = prepared;
  // step 9 — `.call(record.session, ...)`, never a detached invocation (review finding): the real
  // in-process `Session.steerContent` reads `this.steer`, so calling the resolved function without its
  // receiver throws for that engine — and since neither commit nor abort ran after such a throw, the
  // stage reservation leaked (never swept, never reservable again). Mirrors `submitRunner`'s own
  // `requireSubmitContent(record.session).call(record.session, ...)` above. A throw here still propagates
  // synchronously (this function is not `async`), so the `catch` below reliably aborts before it escapes.
  try {
    requireSteerContent(record.session).call(record.session, blocks);
  } catch (e) {
    srv.imageStages.abort(token);
    throw e;
  }
  record.updatedAt = nowSec(); // the content half of `turnSteer`'s own bump
  srv.imageStages.commit(token); // step 10
  // {ok:true} means "the injection was pushed onto the live input stream", exactly `turnSteer`'s own
  // contract — whether it changed the turn's course is visible only in that turn's own output.
  ctx.peer.reply(id, { ok: true });
};

/** `turn/steer` (X) — M2b Task 5, promoted from probe 103b (ALIVE: a mid-turn injection makes the model
 *  abandon its remaining steps and follow the new instruction). The one method on this surface whose busy
 *  gate is INVERTED: it requires a turn in flight, and it requires that the reason the thread is busy IS a
 *  turn. Eligibility is computed off the same `threadBusyReason` split `turnStart`'s enqueue arm uses, for
 *  the same reason — the three outcomes are genuinely different answers:
 *   - "turn": the only steerable state. Steer it.
 *   - "closing"/"swapping": the standard -33001 refusal, reason named. There IS no turn the injection
 *     could reach (a swap has no engine yet, a close is disposing the one there was), and a client that
 *     cannot tell this from "retry in a moment" retries a thread that is going away.
 *   - idle: -32602 "no turn in flight" — the busy convention's inverse. Not -33001: nothing about the
 *     thread is unavailable, the request simply has no referent.
 *  The gate is checked BEFORE the engine method is resolved: eligibility is a property of the thread, not
 *  of the engine build, so an idle thread answers the same way whichever engine is behind it.
 *
 *  `busy` ALONE IS NOT ENOUGH, and the extra term is the whole correctness of this method (review
 *  finding). `beginTurn` latches `busy` synchronously at request arrival but issues `submit()` later,
 *  from its chain callback — so there is a real window in which the thread reads busy-with-a-turn while
 *  the prompt has not been pushed onto the engine's input queue yet. It is not theoretical: a same-chunk
 *  `turn/start`+`turn/steer` pair (Peer.feed handles multi-frame chunks) sits in it, and so does any
 *  turn whose chain callback is parked behind an earlier op awaiting engine I/O — `plugin/reload` on
 *  this very surface will do it. An un-chained steer admitted there pushes AHEAD of the prompt: the
 *  engine reads the steer first and the turn is steered before it exists. So the gate is
 *  `record.busy && record.turnStartedBroadcast` — the same arrival-vs-chain latch subscribe.ts's replay
 *  uses. That flag is raised inside the chain callback, in the SAME synchronous step that then calls the
 *  runner, so nothing can be dispatched between the two: true means the prompt is on the engine's queue.
 *  An early steer is refused "no turn in flight", which is the honest answer — at that instant there is
 *  not one yet.
 *
 *  UN-CHAINED, deliberately diverging from the mutation convention (settings.ts/mcp.ts/tasks.ts all
 *  chain): a steer must reach a turn that is running RIGHT NOW, and a chain item parked on engine I/O
 *  would hold it until after the turn it was aimed at is over — delivering the injection into the NEXT
 *  turn, or into none. Nothing is lost by not chaining: the chain exists to serialize ops that mutate
 *  thread state against each other, and this one mutates none — it pushes onto the engine's own input
 *  queue, which is ordered by the engine. The rewind swap it might otherwise race is `swapping`, which
 *  the gate above already refuses.
 *
 *  No notification: a steer is not a turn edge. The steered turn keeps running and reports itself through
 *  the machinery already in flight — items, then one `turn/completed`. */
export const turnSteer: Handler = (srv, ctx, id, params) => {
  const parsed = turnSteerParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const busyReason = threadBusyReason(record);
  if (busyReason && busyReason !== "turn") { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return; }
  // `turnStartedBroadcast`, not `busy` alone — see the header: busy latches at arrival, the prompt is
  // pushed later from the chain, and a steer admitted in that window overtakes it.
  if (!(record.busy && record.turnStartedBroadcast)) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "no turn in flight"); return; }
  // Resolved, never optional-called: `?.()` would reply {ok:true} for an injection no engine ever read
  // (introspect.ts:36's convention, and mcp.ts/tasks.ts's).
  const steer = record.session.steer?.bind(record.session);
  if (!steer) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, "unsupported by this engine"); return; }
  steer(parsed.data.input);
  record.updatedAt = nowSec();
  // {ok:true} means "the injection was pushed onto the live input stream", not "the model obeyed it" —
  // whether it changed the turn's course is visible only in that turn's own output.
  ctx.peer.reply(id, { ok: true });
};

/** The ONE interrupt path — turn/interrupt and decision/respond's abortTurn both go through it. Setting
 *  interruptRequested is not optional bookkeeping: onSuccess above reads it to tell a turn the client
 *  aborted from a turn that genuinely finished, so an interrupt that skips the flag reports the aborted
 *  turn as "completed" and finalizes its open items as completed rather than failed. */
export async function requestInterrupt(record: ThreadRecord): Promise<void> {
  record.interruptRequested = true;
  // …and the PENDING fleet turn's own latch, if one is installed (registry.ts's PendingFleetStop). The
  // flag above is cleared by every host turn-start, a FOREIGN client's included, so it alone cannot carry
  // a stop for a turn that has not reached the host yet. Raised here rather than in `turnInterrupt` so
  // `decision/respond`'s abortTurn — the other caller of this one interrupt path — stops such a turn too.
  if (record.fleetPendingStop) record.fleetPendingStop.interrupted = true;
  await record.session.interrupt(); // zero-arg (see file header) — turn/interrupt's cancelQueued accepted, unused
}

export const turnInterrupt: Handler = async (srv, ctx, id, params) => {
  const parsed = turnInterruptParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // Stop-means-stop-everything: the flush runs BEFORE the interrupt, because interrupting first makes the
  // in-flight turn settle — and settleTurn drains the very queue this request is trying to empty. It also
  // runs before the by-id arm below: with BOTH flags set, `cancelQueued` is honoured FIRST and `turnId` is
  // then resolved AGAINST ITS RESULT. (The by-id arm used to return early and silently skip a flush the
  // client had explicitly asked for — every other queued turn survived a "stop everything".)
  const cancelledQueued = parsed.data.cancelQueued ? flushQueue(srv, record) : undefined;
  // Aimed at a QUEUED turn (spec D-M2-10): answered before the engine is touched at all — that turn has no
  // engine work to stop, and interrupting the RUNNING turn because a client cancelled a pending one would
  // destroy work nobody asked to lose. The named id counts as cancelled whether THIS call's flush took it
  // or the by-id removal did, so the receipt reads the same for `{turnId}` and `{turnId, cancelQueued}` —
  // the flush's ids just ride along in `cancelledQueued`. An id that is in neither falls through unchanged
  // (it names the running turn, or nothing), carrying the flush's ids into that receipt instead.
  const named = parsed.data.turnId;
  if (named && (cancelledQueued?.includes(named) || cancelQueued(srv, record, named))) {
    ctx.peer.reply(id, { interrupted: false, cancelled: [named], ...(cancelledQueued ? { cancelledQueued } : {}) });
    return;
  }
  interruptParkedCalls(srv, record);   // …and only then the engine: awaiting it first is the C1 circular wait
  await requestInterrupt(record);
  ctx.peer.reply(id, cancelledQueued ? { interrupted: true, cancelledQueued } : { interrupted: true });
};
