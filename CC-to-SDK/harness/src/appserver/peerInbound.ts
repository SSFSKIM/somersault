// appserver/peerInbound.ts — an inbound peer message becomes a REAL turn.
//
// The engine does not wait for this server's chain. Every hard case here is the same shape: a frame
// arrives before the machinery that was going to handle it exists. The answer is always to record what
// happened synchronously and let the machinery drain it when it installs — never to assume ordering the
// read loop does not promise.
//
// ADOPTION GOES THROUGH `beginTurn`, NOT AROUND IT. An adopted turn owes its subscribers everything an
// ordinary one does — `turn/started`, the model's items, a `turn/completed` whose status tells completed
// from failed from interrupted from cancelled — and `beginTurn` already produces all of it, including the
// close/interrupt re-check on the far side of the chain and the `turnFailureOf`-shaped failure tag. So
// adoption supplies a runner and inherits the rest; `turn/interrupt` reaches an adopted turn for free,
// because it raises the same `record.interruptRequested` latch `beginTurn`'s own success path reads.
import { randomUUID } from "node:crypto";
import { peerArrival } from "../peer/address.js";
import { TurnMapper, userItem } from "./items/mapper.js";
import { turnFailureOf } from "../session/turnResult.js";
import { beginTurn, emitItems, type TurnOutcome, type TurnStopped } from "./turns.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer } from "./server.js";

/** How many un-adopted arrivals one thread holds. Attacker-influenced — any local process that can write
 *  this session's socket can produce them — so it is capped and oldest-first evicted, never grown. */
const MAX_ARRIVALS = 32;
/** How many frames one adopted turn captures while its runner is still behind the chain. Bounded for the
 *  same reason; a turn that overruns it loses the earliest frames rather than the process. */
const MAX_CAPTURED = 512;
/** A ceiling on the uuid set below. Every entry is normally deleted by its own turn's terminal lifecycle
 *  frame, so this only ever catches an engine that stops bracketing — and evicting is safe: a forgotten
 *  own turn is at worst briefly CONSIDERED for adoption, which `beginTurn`'s busy gate then declines. */
const MAX_OWN_UUIDS = 64;

interface Arrival { msgId: string; text: string; at: number }

interface AdoptedTurn {
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

export interface PeerInboundState {
  off?: () => void;
  offResult?: () => void;
  arrivals: Arrival[];
  /** The command uuids of turns THIS server submitted, so their lifecycle brackets are not adopted.
   *  Per-record (it dies with the thread) and deleted at each terminal (it does not grow with turns). */
  ourUuids: Set<string>;
  adopted?: AdoptedTurn;
}

/** Record a uuid this server is about to submit under, so its own lifecycle bracket is recognised.
 *  Called from turns.ts's `submitRunner` beside the `randomUUID()` that mints it. */
export function notePeerTurnUuid(record: ThreadRecord, uuid: string): void {
  const state = record.peerInbound;
  if (!state) return;
  state.ourUuids.add(uuid);
  // Insertion-ordered, so the first key IS the oldest — see MAX_OWN_UUIDS on why eviction is harmless.
  while (state.ourUuids.size > MAX_OWN_UUIDS) state.ourUuids.delete(state.ourUuids.values().next().value as string);
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

export function installPeerInbound(srv: AppServer, record: ThreadRecord): void {
  if (record.crossSessionInbound === "refuse") return;   // nothing is coming; observe nothing
  const state: PeerInboundState = record.peerInbound ?? { arrivals: [], ourUuids: new Set() };
  record.peerInbound = state;

  const onFrame = (frame: any): void => {
    if (!frame || typeof frame !== "object") return;

    if (frame.type === "command_lifecycle") {
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
      return;
    }

    const adopted = state.adopted;
    if (adopted && !adopted.terminated) {
      if (adopted.mapper && adopted.turnId) {
        emitItems(srv, record, adopted.turnId, adopted.mapper.ingest(frame));
      } else if (adopted.captured.length < MAX_CAPTURED) {
        adopted.captured.push(frame);
      }
    }

    // …and the arrival itself, which is a fact about this THREAD rather than about any one turn: it is
    // held unassigned until lifecycle evidence gives it a turn to belong to. Nothing here branches on
    // `record.busy` — the spec's own measurement is that a message delivered during a busy turn has three
    // possible fates and no way to predict which.
    // No `frame.type === "user"` pre-check: `peerArrival` already owns that, and a second copy of any part
    // of the recognition rule here is the exact drift this task removed.
    if (noteArrival(srv, record, state, frame)) drainArrivals(srv, record, state);
  };

  state.off = record.session.onFrame(onFrame);
  state.offResult = record.session.onUnclaimedResult?.((result: unknown) => {
    const adopted = state.adopted;
    if (!adopted || adopted.terminated) return false;
    // Normalized through the SAME reader ordinary turns use. A raw result stored and reported as "some
    // result arrived" makes `is_error` and an API error read as a clean completion.
    const failure = turnFailureOf(result);
    adopted.outcome = failure ? { error: failure } : undefined;
    if (adopted.mapper && adopted.turnId) emitItems(srv, record, adopted.turnId, adopted.mapper.ingest(result));
    else if (adopted.captured.length < MAX_CAPTURED) adopted.captured.push(result);
    return true;                                          // CLAIMED — this is what keeps it off the unmatched counter
  });
}

/** Note one arrival, and ANNOUNCE it; returns whether the frame was a cross-session message at all.
 *
 *  What an arrival IS, and what it reads as, is `peerArrival`'s (peer/address.ts) — the SAME function
 *  `items/replay.ts` asks for the cold twin of this item. This file deliberately holds no copy of that
 *  rule: two files agreeing by construction is not the same as one rule, and every place the two copies
 *  drifted produced two different texts under ONE id. What stays here is what is genuinely live-only:
 *  queueing, eviction, the minted-uuid fallback, and the broadcast. */
function noteArrival(srv: AppServer, record: ThreadRecord, state: PeerInboundState, frame: any): boolean {
  const arrival = peerArrival(frame);
  if (!arrival) return false;
  const origin = arrival.origin;

  // The FRAME's own uuid, never a minted one when it has one. This id is what the transcript persists, and
  // `items/replay.ts` gives a replayed user row exactly this id — which is the whole mechanism by which a
  // client deduplicates the live item against the one `thread/read` returns. A fresh uuid would make every
  // arrival appear twice to any client that reads its own history; it is the last resort, not the rule.
  const arrivalUuid = arrival.uuid ?? randomUUID();

  state.arrivals.push({ msgId: arrivalUuid, text: arrival.text, at: Date.now() });
  // Oldest-first, and the drop is announced: a silently truncated queue reads to an operator exactly like
  // a queue nothing was ever written to.
  while (state.arrivals.length > MAX_ARRIVALS) {
    state.arrivals.shift();
    console.warn(`[peer] arrival queue full on thread ${record.id} (cap ${MAX_ARRIVALS}); dropped the oldest`);
  }

  // ANNOUNCED HERE, at arrival, and with NO turnId — at this moment the message's fate is genuinely
  // undecided (it may fold into a running turn, batch with others, or cause a turn whose id does not exist
  // yet), so the field could only be fabricated, delayed, or null. A client correlates through
  // `arrivalUuid`, which is also the id of the item this arrival eventually produces.
  //
  // `origin` travels VERBATIM, and is always present now that it is what MAKES this an arrival.
  // `verifiedPeerPid` is the only field in this exchange the kernel vouches for — `from` is sender-authored
  // and forgeable by any same-user process — so re-deriving the object would replace a verified fact with
  // this server's opinion of it.
  //
  // `srv.broadcast` and not `broadcastServer`: this is the thread's SUBSCRIBERS, an audience distinct from
  // the server-scoped watchers, because an arrival is CONTENT and `watchThreads` is existence fan-out
  // (fanout.ts). It is the same call `emitItems` makes for the item this arrival becomes.
  srv.broadcast(record.id, "thread/peerMessage", { threadId: record.id, arrivalUuid, origin });
  return true;
}

/** The arrivals this thread is carrying become user items of whichever turn is actually running them —
 *  never before that turn's own `turn/started` has gone out, which is why the only two callers are the
 *  runner (which `beginTurn` invokes after the broadcast) and a frame that landed while one is live. */
function drainArrivals(srv: AppServer, record: ThreadRecord, state: PeerInboundState): void {
  const adopted = state.adopted;
  if (!adopted?.mapper || !adopted.turnId || adopted.terminated) return;
  const turnId = adopted.turnId;
  for (const a of state.arrivals.splice(0, state.arrivals.length)) {
    emitItems(srv, record, turnId, [{ kind: "completed", item: userItem(a.text, a.msgId) }]);
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
  if (!started) state.adopted = undefined;
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

export function uninstallPeerInbound(record: ThreadRecord): void {
  const state = record.peerInbound;
  if (!state) return;
  state.off?.(); state.off = undefined;
  state.offResult?.(); state.offResult = undefined;
  // The arrivals belonged to the conversation that is being discarded; carrying them into a replacement
  // engine would emit them as items of a turn in a transcript they were never part of.
  state.arrivals.length = 0;
}
