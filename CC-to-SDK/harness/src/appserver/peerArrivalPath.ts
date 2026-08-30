// appserver/peerArrivalPath.ts — what happens to ONE arrival, from the frame that carries it to the queue
// a turn drains it from.
//
// The order is the invariant: persisted, THEN announced, THEN drainable. Killing the process at any point
// leaves a prefix of it — an entry with no notification, never the reverse, and never a live item for a
// message history does not have.
import { randomUUID } from "node:crypto";
import { peerArrival } from "../peer/address.js";
import type { ArrivalEntry, ArrivalStore } from "../peer/arrivalLog.js";
import { bindingNow, type ArrivalBinding } from "./peerAdoption.js";
import type { PendingArrival } from "./peerSeed.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer } from "./server.js";
import type { PeerInboundState } from "./peerInbound.js";

/** How many un-adopted arrivals one thread holds. Attacker-influenced — any local process that can write
 *  this session's socket can produce them — so it is capped and oldest-first evicted, never grown. */
const MAX_ARRIVALS = 32;

/** One arrival waiting for a turn to carry it. `origin` rides along because the ITEM carries it (M9,
 *  items/types.ts): the live drain builds the same `arrivalItem` the cold and projected paths build, and a
 *  queue that kept only the text would leave the live path as the one that could not. */
export interface Arrival { msgId: string; text: string; origin: Record<string, unknown>; at: number; bind: ArrivalBinding }

/** Note one arrival, and ANNOUNCE it; returns whether the frame was a cross-session message at all.
 *
 *  What an arrival IS, and what it reads as, is `peerArrival`'s (peer/address.ts) — the SAME function
 *  `items/replay.ts` asks for the cold twin of this item. This file deliberately holds no copy of that
 *  rule: two files agreeing by construction is not the same as one rule, and every place the two copies
 *  drifted produced two different texts under ONE id. What stays here is what is genuinely live-only:
 *  queueing, eviction, the minted-uuid fallback, and the broadcast. */
export function noteArrival(srv: AppServer, record: ThreadRecord, state: PeerInboundState, store: ArrivalStore | undefined, frame: any): boolean {
  const arrival = peerArrival(frame);
  if (!arrival) return false;
  // THE ONE CASE THE READER CANNOT SEE, recorded here because THIS is where it would be visible. When
  // several peer messages batch into one turn, every frame of the batch can repeat the CAUSING message's
  // `origin.msg_id` and `origin.body` (probe 121, CLI 2.1.250). A repeated `msg_id` ACROSS arrivals is the
  // only evidence of a batch, and it lives in this queue rather than in any one frame, so the reader is
  // structurally unable to see it — and still does not need to. `peerArrival` renders what each frame
  // ITSELF carries (its envelopes, else its own text), and consults that repeated body only for a frame
  // carrying no text at all, so the batch never decides what a message says. What a batch still decides is
  // `origin`, which is forwarded verbatim: in a batch it names the causing message, and no arrival uuid can
  // be said to name any particular message (M9 spec, verdict C).

  // The FRAME's own uuid, never a minted one when it has one. This id is what the transcript persists, and
  // `items/replay.ts` gives a replayed user row exactly this id — which is the whole mechanism by which a
  // client deduplicates the live item against the one `thread/read` returns. A fresh uuid would make every
  // arrival appear twice to any client that reads its own history; it is the last resort, not the rule.
  const arrivalUuid = arrival.uuid ?? randomUUID();

  const pending: PendingArrival = {
    arrivalUuid, text: arrival.text, origin: arrival.origin,
    observedAt: new Date().toISOString(),
    afterFrames: state.seeding?.frames.length ?? 0,
    // WHERE IT WILL BE ALLOWED TO APPEAR, decided now rather than at emission: this is the only moment the
    // brackets open when this frame arrived are still knowable. Everything downstream carries it verbatim.
    bind: bindingNow(record, state),
  };

  // THE LIVE QUEUE IS NOT WRITTEN TO HERE, and that is the whole of round 2's finding 3. An arrival becomes
  // DRAINABLE — eligible to be emitted as an item of whatever turn is running — only once the path below
  // has settled what it is: persisted and announced, or announced-only because there is no scope to persist
  // into. Queued on sight instead, a message held by an unresolved seed was drained the same tick by an
  // adopted turn that had already installed its mapper, so `item/completed` went out for an arrival whose
  // entry the seed had not written yet — persist-before-broadcast, held everywhere else in this file,
  // broken in the one window where the entry is deliberately deferred. See `enqueueLive`.
  //
  // INSIDE THE SEED WINDOW an arrival is HELD — neither persisted nor announced. Persisting it would mean
  // inventing an anchor the seed has not grounded yet (and `null`, the only anchor available before then,
  // means confirmed-empty: the top of history); announcing it would put a message on the wire that history
  // is about to be unable to place. The window is one read long, so the hold is milliseconds.
  //
  // HELD IS NOT LOST, though, and the two places this window can end WITHOUT grounding are the eviction
  // below and `uninstallPeerInbound`. Both write the arrival out as `ambiguous` — a real message, counted,
  // with no position to claim — rather than letting it fall between the announcement channel and history.
  if (state.seeding) {
    const seeding = state.seeding;
    const buffer = seeding.arrivals;
    buffer.push(pending);
    // Bounded for the same reason the live queue above is — and an evicted one is still ANNOUNCED, because
    // M8's guarantee is that no message the engine delivered goes unmentioned. What it is NOT is unlogged:
    // announcing without recording makes `logged` smaller than the notification count, and a count short of
    // the announcements is a history certifying itself complete while it is missing a message. So the
    // eviction takes the ordinary path — persisted, then announced — as AMBIGUOUS: the window has not
    // grounded, so this arrival has no position to claim, and counted-but-unplaced is exactly the answer
    // the spec designates for a position that cannot be known.
    while (buffer.length > MAX_ARRIVALS) {
      const evicted = buffer.shift()!;
      console.warn(`[peer] seed buffer full on thread ${record.id} (cap ${MAX_ARRIVALS}); logging the oldest ambiguous`);
      logArrival(srv, record, state, seeding.store, seeding.sessionId, evicted, seeding.store.nextSeq(seeding.sessionId), true);
    }
    return true;
  }

  // `state.seeded` is "the seed has grounded", and `record.sessionId` is the scope it grounded against —
  // the two are one condition, because every write of `record.sessionId` is either
  // guarded by "it is currently unset" (router.ts's init latch) or bracketed by an uninstall/install pair
  // (rewind's swap, thread/clear's fresh engine), so a grounded anchor and the id it was grounded against
  // cannot come apart under a live observer.
  //   BEFORE the seed opens there is no scope to write into, and the arrival takes M8's path unchanged:
  // announced, not logged. That is the pre-init window the spec already bounds by the length of engine
  // startup and already declares lossy ("a crash in that window loses it"); this widens the loss from a
  // crash to every time, and buys the guarantee that an unseeded thread behaves exactly as it did before
  // this milestone. The window holds no arrival in practice: an arrival IS an engine frame, and the engine
  // emits system/init — which is where the id is latched — before any user frame of the turn it starts.
  if (store && record.sessionId && state.seeded) {
    logArrival(srv, record, state, store, record.sessionId, pending, store.nextSeq(record.sessionId), false);
  } else {
    announceArrival(srv, record, pending);
    enqueueLive(record, state, pending);
  }
  return true;
}

/** An arrival joins the DRAINABLE queue — the one `drainArrivals` empties into a running turn. Called only
 *  after the arrival's durable fate is settled, so nothing this queue emits can precede its own entry.
 *
 *  Oldest-first eviction, and the drop is said out loud: a silently truncated queue reads to an operator
 *  exactly like a queue nothing was ever written to. This cap bounds the LIVE items only — the entry is
 *  already on disk and `logged` already counts it, so an eviction here costs a live item and never a
 *  history. */
function enqueueLive(record: ThreadRecord, state: PeerInboundState, pending: PendingArrival): void {
  // `bind` travels from the PendingArrival rather than being re-taken here: a seed-held arrival reaches
  // this line long after its frame did, and re-stamping is exactly the re-attribution the binding forbids.
  state.arrivals.push({ msgId: pending.arrivalUuid, text: pending.text, origin: pending.origin, at: Date.now(), bind: pending.bind });
  while (state.arrivals.length > MAX_ARRIVALS) {
    state.arrivals.shift();
    console.warn(`[peer] arrival queue full on thread ${record.id} (cap ${MAX_ARRIVALS}); dropped the oldest`);
  }
}

/** Write the entry, THEN announce it, THEN make it drainable. Killing the process at any point leaves a
 *  prefix of that order — an entry with no notification, never the reverse, and never an item for a message
 *  history does not have. The one exception is here, in the catch: a write that throws is caught (an
 *  escaped exception would hit `readLoop`'s discard and vanish), the session latches degraded so every
 *  later `thread/read` reports `arrivals: null` rather than a count that might be short, and the
 *  notification still goes out — the live channel reports what the ENGINE did, and the engine delivered the
 *  message whether or not our sidecar could record it. The queue step is the same trade: the gap is
 *  disclosed by the latch, so the live item is not also withheld. */
export function logArrival(
  srv: AppServer, record: ThreadRecord, state: PeerInboundState, store: ArrivalStore,
  sessionId: string, pending: PendingArrival, seq: number, ambiguous: boolean,
): void {
  writeEntry(state, store, sessionId, pending, seq, ambiguous);
  announceArrival(srv, record, pending);
  enqueueLive(record, state, pending);
}

/** The durable half on its own, because one caller has no notification to make: `uninstallPeerInbound`
 *  persists what a torn-down seed window was still holding, and the live channel it would have announced on
 *  belongs to the conversation being discarded. */
export function writeEntry(
  state: PeerInboundState, store: ArrivalStore,
  sessionId: string, pending: PendingArrival, seq: number, ambiguous: boolean,
): void {
  const entry: ArrivalEntry = {
    v: 1, id: pending.arrivalUuid, sessionId,
    anchor: state.anchor ?? null,
    ...(ambiguous ? { ambiguous: true as const } : {}),
    seq, observedAt: pending.observedAt, origin: pending.origin, text: pending.text,
  };
  try {
    store.append(entry);
  } catch (err) {
    // Said out loud, once per failure: the durable signal is the marker `markDegraded` writes, but an
    // operator reading logs is the one who can act on WHY (ENOSPC, EACCES, a home directory that went
    // away), and the error object is the only place that reason exists.
    console.warn(`[peer] arrival log write failed on session ${sessionId}; the session is now degraded —`, err);
    store.markDegraded(sessionId);
    state.degraded = true;
  }
}

/** The announcement, and still the only thing this file says on the wire about an arrival. Its own
 *  function because TWO paths reach it — an ordinary arrival and a held one flushed after the seed — and a
 *  second copy of this payload is a second answer to what a client receives.
 *
 *  ANNOUNCED at arrival, and with NO turnId — at this moment the message's fate is genuinely undecided (it
 *  may fold into a running turn, batch with others, or cause a turn whose id does not exist yet), so the
 *  field could only be fabricated, delayed, or null. A client correlates through `arrivalUuid`, which is
 *  also the id of the item this arrival eventually produces.
 *
 *  `origin` travels VERBATIM, and is always present now that it is what MAKES this an arrival.
 *  `verifiedPeerPid` is the only field in this exchange the kernel vouches for — `from` is sender-authored
 *  and forgeable by any same-user process — so re-deriving the object would replace a verified fact with
 *  this server's opinion of it.
 *
 *  WHICH IS WHY `text` TRAVELS BESIDE IT, and what each of the two means is decided here once, for every
 *  channel an arrival reaches a client on. `origin` is the ENGINE'S VERBATIM DELIVERY PROVENANCE: in a
 *  collapsed batch its `body` and `msg_id` name the CAUSING message rather than this arrival. `text` is
 *  WHAT THIS ARRIVAL SAYS — the frame's own resolved text as `peerArrival` read it, identical under the
 *  same `arrivalUuid` on the announcement, the live item, the projected row and the replayed row. The two
 *  are deliberately NOT reconciled: reconciling would invent an attribution the data does not contain
 *  (probe 121, verdict C — per-message identity inside a batch is non-bijective, and text coverage is the
 *  claim). So a client renders `text` and attributes by `origin`, and neither field has to stand in for
 *  the other.
 *
 *  `srv.broadcast` and not `broadcastServer`: this is the thread's SUBSCRIBERS, an audience distinct from
 *  the server-scoped watchers, because an arrival is CONTENT and `watchThreads` is existence fan-out
 *  (fanout.ts). It is the same call `emitItems` makes for the item this arrival becomes. */
function announceArrival(srv: AppServer, record: ThreadRecord, pending: PendingArrival): void {
  srv.broadcast(record.id, "thread/peerMessage", { threadId: record.id, arrivalUuid: pending.arrivalUuid, origin: pending.origin, text: pending.text });
}
