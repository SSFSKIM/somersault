// appserver/peerAdoption.ts — the adopted turn: its bracket, its binding, and its drain.
//
// ADOPTION GOES THROUGH `beginTurn`, NOT AROUND IT. An adopted turn owes its subscribers everything an
// ordinary one does — `turn/started`, the model's items, a `turn/completed` whose status tells completed
// from failed from interrupted from cancelled — and `beginTurn` already produces all of it, including the
// close/interrupt re-check on the far side of the chain and the `turnFailureOf`-shaped failure tag. So
// adoption supplies a runner and inherits the rest; `turn/interrupt` reaches an adopted turn for free,
// because it raises the same `record.interruptRequested` latch `beginTurn`'s own success path reads.
import { TurnMapper, arrivalItem } from "./items/mapper.js";
import { turnFailureOf } from "../session/turnResult.js";
import { beginTurn, emitItems, type TurnOutcome, type TurnStopped } from "./turns.js";
import { activeTurnId, type ThreadRecord } from "./registry.js";
import type { AppServer } from "./server.js";
import type { PeerInboundState } from "./peerInbound.js";
import type { Arrival } from "./peerArrivalPath.js";

/** How many frames one adopted turn captures while its runner is still behind the chain. Bounded for the
 *  same reason; a turn that overruns it loses the earliest frames rather than the process. */
export const MAX_CAPTURED = 512;
/** A ceiling on the uuid set below. Every entry is normally deleted by its own turn's terminal lifecycle
 *  frame, so this only ever catches an engine that stops bracketing — and evicting is safe: a forgotten
 *  own turn is at worst briefly CONSIDERED for adoption, which `beginTurn`'s busy gate then declines. */
const MAX_OWN_UUIDS = 64;

/** WHERE ONE ARRIVAL IS ALLOWED TO APPEAR, decided by bracket evidence at the moment its FRAME arrived
 *  (BL7 Stream 2, #64): the turn bracket open at that instant, else `next` — the next bracket to open on
 *  this thread, which is where the engine's own undelivered-message queue drains (LEG 5 measured exactly
 *  that attribution for a batch). It is never re-attributed past its own bracket; a bracket that dies takes
 *  its arrivals with it. The alternative this replaces was queue POSITION — "whatever adoption is current
 *  when a drain happens" — which is how an arrival became a user item of a turn it did not cause. */
export type ArrivalBinding =
  | { kind: "adopted"; commandUuid: string; epoch: number }
  | { kind: "own"; turnId: string }
  | { kind: "next" };

export interface AdoptedTurn {
  commandUuid: string;
  /** The `record.epoch` adoption started under. A frame that arrives after a swap belongs to a
   *  conversation that no longer exists, and acting on it would move a turn that is not this one. */
  epoch: number;
  captured: unknown[];
  mapper?: TurnMapper;
  turnId?: string;
  /** `beginTurn`'s OWN outcome type, imported rather than restated: the status words an adopted turn can
   *  report are the same ones every other turn reports, and a local widening to `string` would let this
   *  file invent a terminal `onSuccess` has no branch for. */
  resolve?: (o: TurnOutcome) => void;
  /** Set when the terminal arrives. If the runner has not installed yet, this is what it resolves with
   *  the moment it does — the difference between a settled turn and a thread busy forever. */
  outcome?: TurnOutcome;
  terminated: boolean;
}

/** The bracket evidence AT THIS INSTANT, which is the only moment an arrival's binding is ever taken.
 *  An adoption that has terminated is not a bracket an arrival can join; an own turn counts only while it
 *  is genuinely the running one (see `PeerInboundState.ownTurn` on why the id is compared rather than
 *  trusted) — everything else is `next`, and `next` is claimed when a bracket actually opens. */
export const bindingNow = (record: ThreadRecord, state: PeerInboundState): ArrivalBinding => {
  const a = state.adopted;
  if (a && !a.terminated) return { kind: "adopted", commandUuid: a.commandUuid, epoch: a.epoch };
  if (state.ownTurn && activeTurnId(record) === state.ownTurn.turnId) return { kind: "own", turnId: state.ownTurn.turnId };
  return { kind: "next" };
};

/** THE CLAIM, and it happens at BRACKET OPEN — never at a drain. A drain-time claim leaves a window in
 *  which a bracket opens and dies between two drains and its arrival skips to a later, unrelated one: the
 *  defect again, one window smaller. Both queues are walked, because an arrival held by an in-flight seed
 *  is as bound as one already drainable — it simply has not been persisted yet. */
const claimNext = (state: PeerInboundState, bind: ArrivalBinding): void => {
  for (const a of state.arrivals) if (a.bind.kind === "next") a.bind = bind;
  for (const p of state.seeding?.arrivals ?? []) if (p.bind.kind === "next") p.bind = bind;
};

/** Is this binding's bracket gone? A `next` binding never is — it names no bracket yet, and the one place
 *  an unclaimed arrival is discarded is `uninstallPeerInbound`, where the whole conversation goes. */
const bindIsDead = (record: ThreadRecord, state: PeerInboundState, bind: ArrivalBinding): boolean => {
  if (bind.kind === "next") return false;
  if (bind.kind === "own") return activeTurnId(record) !== bind.turnId;
  const a = state.adopted;
  return !a || a.terminated || a.commandUuid !== bind.commandUuid || a.epoch !== bind.epoch;
};

const sameBinding = (a: ArrivalBinding, b: ArrivalBinding): boolean => {
  if (a.kind === "adopted" && b.kind === "adopted") return a.commandUuid === b.commandUuid && a.epoch === b.epoch;
  if (a.kind === "own" && b.kind === "own") return a.turnId === b.turnId;
  return false;   // `next` matches no OPEN bracket: an open bracket has already claimed what belongs to it
};

/** Record a uuid this server is about to submit under, so its own lifecycle bracket is recognised.
 *  Called from turns.ts's `submitRunner` beside the `randomUUID()` that mints it.
 *
 *  It is ALSO where this thread's own turn bracket opens, and that is not an extra responsibility so much
 *  as the same fact read twice: the call site is inside the runner, past `beginTurn`'s `turn/started`
 *  broadcast, with `record.currentTurnId` already stamped — the exact instant at which "our turn is
 *  running, and its subscribers know it" becomes true. Any arrival still waiting for a bracket is claimed
 *  by it here, because the engine hands a queued message to the turn it starts. */
export function notePeerTurnUuid(record: ThreadRecord, uuid: string): void {
  const state = record.peerInbound;
  if (!state) return;
  state.ourUuids.add(uuid);
  // Insertion-ordered, so the first key IS the oldest — see MAX_OWN_UUIDS on why eviction is harmless.
  while (state.ourUuids.size > MAX_OWN_UUIDS) state.ourUuids.delete(state.ourUuids.values().next().value as string);
  const turnId = record.currentTurnId;
  if (!turnId) return;   // unreachable from beginTurn's runner, which mints it before the chain callback
  state.ownTurn = { turnId };
  claimNext(state, { kind: "own", turnId });
}

const isOurs = (state: PeerInboundState, frame: any): boolean =>
  // BOTH fields, because which one carries the submit uuid is not yet measured (Task 13's keyed half).
  // Under the wrong guess this over-adopts, and beginTurn's busy gate makes that a no-op — an own turn
  // holds `busy` for its whole length, so the attempt is declined rather than becoming a second turn.
  // Under the right one it never adopts an own turn at all.
  state.ourUuids.has(String(frame.command_uuid)) || state.ourUuids.has(String(frame.uuid));

const forget = (state: PeerInboundState, frame: any): void => {
  state.ourUuids.delete(String(frame.command_uuid));
  state.ourUuids.delete(String(frame.uuid));
};

/** `queued` and `started` are the two non-terminal states probe 119b observed; anything else ends the
 *  bracket. Written as "not one of these" rather than as a list of terminals because the healthy
 *  terminal's NAME is a delegated unknown — only the failure path's `cancelled` has been seen — and a
 *  closed list would silently fail to settle a turn whose terminal is spelled something else. */
const isTerminalState = (s: unknown): boolean => s !== "queued" && s !== "started";

/** An adoption whose `beginTurn` settled WITHOUT ever reaching the runner — the chain callback's own
 *  closing/interrupt guard takes that path — leaves no resolver behind and no turn running. The object
 *  would then block every later adoption on this thread forever, so it is dropped the moment the thread
 *  is provably not running it: no resolver installed, and not busy. */
const isDeadAdoption = (record: ThreadRecord, a: AdoptedTurn): boolean => !a.resolve && !record.busy;

/** One `command_lifecycle` frame: it closes the adopted bracket, is recognised as our own, or opens a new
 *  adoption. Every path here ends the observer's handling of the frame. */
export function routeLifecycle(srv: AppServer, record: ThreadRecord, state: PeerInboundState, frame: any): void {
  let adopted = state.adopted;
  if (adopted && String(frame.command_uuid) === adopted.commandUuid) {
    if (!isTerminalState(frame.state)) return;
    adopted.terminated = true;
    // A frame from a conversation that has been swapped out settles the turn as CANCELLED and clears
    // everything — a branch that cleared only the uuid would leave `busy` true forever.
    if (record.epoch !== adopted.epoch) { settleAdopted(srv, record, "cancelled"); return; }
    const resolve = adopted.resolve;
    state.adopted = undefined;
    if (resolve) resolve(adopted.outcome);
    // else: the runner has not installed. It reads `outcome` off the object it still holds.
    return;
  }
  if (isOurs(state, frame)) { if (isTerminalState(frame.state)) forget(state, frame); return; }
  if (adopted && isDeadAdoption(record, adopted)) { state.adopted = undefined; adopted = undefined; }
  if (adopted) return;                               // one adopted turn at a time
  if (isTerminalState(frame.state)) return;          // a terminal for a bracket we never saw open
  adopt(srv, record, state, String(frame.command_uuid));
}

/** Everything the engine says while an adopted turn is live: emitted through the turn's mapper once the
 *  runner has installed one, and captured until then. */
export function captureFrame(srv: AppServer, record: ThreadRecord, state: PeerInboundState, frame: any): void {
  const adopted = state.adopted;
  if (adopted && !adopted.terminated) {
    if (adopted.mapper && adopted.turnId) {
      emitItems(srv, record, adopted.turnId, adopted.mapper.ingest(frame));
    } else if (adopted.captured.length < MAX_CAPTURED) {
      adopted.captured.push(frame);
    }
  }
}

/** A result the ordinary turn machinery did not claim: it belongs to the adopted turn, and returning true
 *  is what keeps it off the unmatched counter. */
export function claimResult(srv: AppServer, record: ThreadRecord, state: PeerInboundState, result: unknown): boolean {
  const adopted = state.adopted;
  if (!adopted || adopted.terminated) return false;
  // Normalized through the SAME reader ordinary turns use. A raw result stored and reported as "some
  // result arrived" makes `is_error` and an API error read as a clean completion.
  const failure = turnFailureOf(result);
  adopted.outcome = failure ? { error: failure } : undefined;
  if (adopted.mapper && adopted.turnId) emitItems(srv, record, adopted.turnId, adopted.mapper.ingest(result));
  else if (adopted.captured.length < MAX_CAPTURED) adopted.captured.push(result);
  return true;                                          // CLAIMED — this is what keeps it off the unmatched counter
}

/** THE DRAIN, and what it may do is deliberately narrow: EMIT the arrivals bound to the bracket that is
 *  open right now, DROP the ones whose bracket is gone, and KEEP everything else. It never claims — a
 *  `next` arrival is claimed where a bracket OPENS (`adopt`, `notePeerTurnUuid`) — and it never re-homes:
 *  emptying the queue into whatever turn was current is the defect (#64) this replaces.
 *
 *  Emission still never precedes the turn edge that owns it. The adopted arm runs only once the runner has
 *  installed a mapper, which `beginTurn` invokes after broadcasting `turn/started`; the own arm is gated on
 *  the bracket `notePeerTurnUuid` opens at that same point in the same order.
 *
 *  A DROP IS SAID OUT LOUD, once per drain with its count. Nothing leaves history by it: the arrival was
 *  announced when it landed and logged by M9 — what is lost is the live item, for a turn that has ended. */
export function drainArrivals(srv: AppServer, record: ThreadRecord, state: PeerInboundState): void {
  // The own bracket is closed the moment the thread is running something else (or nothing). Cleared here
  // rather than at any turn-end seam, because this file observes the engine and does not own turn teardown.
  if (state.ownTurn && activeTurnId(record) !== state.ownTurn.turnId) state.ownTurn = undefined;

  const adopted = state.adopted;
  const open: { bind: ArrivalBinding; turnId: string } | undefined =
    adopted?.mapper && adopted.turnId && !adopted.terminated
      ? { bind: { kind: "adopted", commandUuid: adopted.commandUuid, epoch: adopted.epoch }, turnId: adopted.turnId }
      : state.ownTurn
        ? { bind: { kind: "own", turnId: state.ownTurn.turnId }, turnId: state.ownTurn.turnId }
        : undefined;

  const queued = state.arrivals.splice(0, state.arrivals.length);
  const kept: Arrival[] = [];
  let dropped = 0;
  for (const a of queued) {
    if (open && sameBinding(a.bind, open.bind)) {
      emitItems(srv, record, open.turnId, [{ kind: "completed", item: arrivalItem(a.text, a.msgId, a.origin) }]);
    } else if (bindIsDead(record, state, a.bind)) {
      dropped++;
    } else {
      kept.push(a);   // `next`, or a bracket that is open but not yet drainable (no mapper installed)
    }
  }
  // Restored at the FRONT: anything an emission re-entered this file with belongs after what was already
  // waiting, and the queue's order is the observation order every consumer of it assumes.
  if (kept.length) state.arrivals.unshift(...kept);
  if (dropped) {
    console.warn(`[peer] dropped ${dropped} arrival(s) on thread ${record.id} whose turn ended before they could be shown; they were announced and logged, so only the live item is lost`);
  }
}

function adopt(srv: AppServer, record: ThreadRecord, state: PeerInboundState, commandUuid: string): void {
  const adopted: AdoptedTurn = { commandUuid, epoch: record.epoch, captured: [], terminated: false };
  state.adopted = adopted;
  const started = beginTurn(srv, undefined, undefined, record, (turnId, mapper, releaseSlot): Promise<TurnOutcome> => {
    // Released IMMEDIATELY: the slot's contract is to release the instant the engine call is dispatched,
    // and for an adopted turn there is no engine call of ours to dispatch. Holding it would park every
    // op chained behind this thread — `thread/close` included — for the length of somebody ELSE's turn.
    releaseSlot();
    if (record.epoch !== adopted.epoch) {
      if (state.adopted === adopted) state.adopted = undefined;
      return Promise.resolve({ stopped: "cancelled" });
    }
    adopted.mapper = mapper;
    adopted.turnId = turnId;
    // Everything the engine said while we were behind the chain, in order, through the same mapper an
    // ordinary turn uses. This runs INSIDE the runner, which beginTurn invokes after it has broadcast
    // turn/started — so no item can precede the turn edge that owns it.
    const captured = adopted.captured;
    adopted.captured = [];
    for (const f of captured) emitItems(srv, record, turnId, mapper.ingest(f));
    drainArrivals(srv, record, state);
    if (adopted.terminated) { if (state.adopted === adopted) state.adopted = undefined; return Promise.resolve(adopted.outcome); }
    return new Promise((resolve) => { adopted.resolve = resolve; });
  });
  // beginTurn refuses a busy thread (and a closing or swapping one). That is the safety net under the
  // unmeasured uuid correlation: an own turn mistaken for a foreign one is declined here rather than
  // becoming a second turn.
  if (!started) { state.adopted = undefined; return; }
  // THE BRACKET IS OPEN — so every arrival still waiting for one is now this turn's, stamped here and not
  // at the drain the runner will perform. Between this line and that drain the bracket can already die
  // (its terminal is a frame away), and an arrival claimed by a dead bracket is DROPPED; one left `next`
  // would have skipped to the turn after, which is the misplacement the binding exists to forbid.
  claimNext(state, { kind: "adopted", commandUuid, epoch: adopted.epoch });
}

/** Settle an adopted turn from OUTSIDE the frame stream — a close, a shutdown, a stale epoch. Idempotent:
 *  a turn already settled has no resolver left to call. */
export function settleAdopted(srv: AppServer, record: ThreadRecord, reason: TurnStopped): void {
  void srv;   // symmetry with the rest of this surface: every teardown seam takes the server it acts on
  const adopted = record.peerInbound?.adopted;
  if (!adopted) return;
  record.peerInbound!.adopted = undefined;
  adopted.terminated = true;
  adopted.resolve?.({ stopped: reason });
}
