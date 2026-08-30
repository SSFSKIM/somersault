// appserver/peerInbound.ts — an inbound peer message becomes a REAL turn.
//
// The engine does not wait for this server's chain. Every hard case here is the same shape: a frame
// arrives before the machinery that was going to handle it exists. The answer is always to record what
// happened synchronously and let the machinery drain it when it installs — never to assume ordering the
// read loop does not promise.
//
// THIS FILE IS THE FACADE: the thread's peer-inbound STATE, the observer that installs and tears down, and
// the frame skeleton that routes each frame to one of three responsibilities — `peerAdoption.ts` (the
// adopted turn's bracket, its binding and its drain), `peerSeed.ts` (the window that decides WHERE an
// arrival sits in the transcript), `peerArrivalPath.ts` (what happens to one arrival: persist, announce,
// enqueue). Every export the rest of the server imports is re-exported from here, so the seams are
// responsibility boundaries and not a new set of import paths.
import { fsArrivalStore, type ArrivalAnchor, type ArrivalStore } from "../peer/arrivalLog.js";
import { captureFrame, claimResult, drainArrivals, routeLifecycle, type AdoptedTurn } from "./peerAdoption.js";
import { beginSeeding, observeVisible, readerVisible, type Seeding } from "./peerSeed.js";
import { noteArrival, writeEntry, type Arrival } from "./peerArrivalPath.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer, AppServerDeps } from "./server.js";

export { notePeerTurnUuid, settleAdopted } from "./peerAdoption.js";
export { readerVisible } from "./peerSeed.js";

export interface PeerInboundState {
  off?: () => void;
  offResult?: () => void;
  arrivals: Arrival[];
  /** The command uuids of turns THIS server submitted, so their lifecycle brackets are not adopted.
   *  Per-record (it dies with the thread) and deleted at each terminal (it does not grow with turns). */
  ourUuids: Set<string>;
  adopted?: AdoptedTurn;
  /** THE OWN TURN'S BRACKET, tracked explicitly rather than inferred. `notePeerTurnUuid` records it from
   *  inside the runner — which `beginTurn` invokes after it has broadcast `turn/started` — so an arrival
   *  emitted into this bracket can never precede the turn edge that owns it. It is NOT `busy` and NOT
   *  `currentTurnId`: both race the bracket's real edges in opposite directions (`busy` flips true before
   *  the broadcast, and it is still true after an adopted terminal has cleared `state.adopted`), and an
   *  arrival attributed on either would be attributed to a turn that never opened or to one already over.
   *  Open exactly while `activeTurnId(record) === ownTurn.turnId`; cleared by the first drain that sees
   *  otherwise. */
  ownTurn?: { turnId: string };
  /** The last filter-surviving frame this thread observed, as an entry records it. `null` says the arrival
   *  PRECEDES EVERY ROW THE SEED RETURNED — which subsumes, but is not limited to, a seed that saw zero
   *  rows: grounding on row 0 of a transcript full of rows produces it too. `undefined` is the different
   *  thing: "no frame has advanced it yet".
   *  It is NOT the record of whether this thread has been seeded: `seeded` is, and conflating the two let
   *  a single frame observed before the id was known both disable the seed forever and ground the chain at
   *  the top of a transcript it had never read. */
  anchor: ArrivalAnchor | null | undefined;
  /** Whether the seed read has completed and grounded the chain. No entry is ever written while it is
   *  false, which is what keeps an `anchor: null` on disk a STATEMENT — the arrival precedes every row the
   *  seed returned — rather than the absence of one, i.e. a chain nothing had read yet. */
  seeded: boolean;
  /** Non-null exactly while a seed read is in flight: frames and arrivals landing inside that window are
   *  held here rather than acted on. */
  seeding: Seeding | null;
  /** This thread's mirror of the store's own latch — a write failed, so the counts are not to be trusted. */
  degraded: boolean;
}

/** The one shared filesystem store, built on first use. One process, one store: the degraded latch and the
 *  seq counter are per-session state that would be split by a per-thread instance. */
let sharedFsStore: ArrivalStore | undefined;

/** THE STRUCTURAL RULE (spec: Store injection), and the one place it is decided — Stage C's reader and
 *  Stage D's search resolve their store through this same function, so the write side and the read side
 *  cannot come to different answers about whether merging is on. The filesystem store is the default only
 *  when the transcript reader is also the default: an embedder that overrode the reader has a transcript
 *  this machine does not own, and merging this machine's arrivals into it would be worse than not merging.
 *  Supplying a store explicitly is the way to say "merge anyway", and it is what every test does. */
export function effectiveArrivalStore(deps: AppServerDeps): ArrivalStore | undefined {
  return deps.arrivalStore ?? (deps.getSessionMessages ? undefined : (sharedFsStore ??= fsArrivalStore()));
}

export function installPeerInbound(srv: AppServer, record: ThreadRecord): void {
  if (record.crossSessionInbound === "refuse") return;   // nothing is coming; observe nothing
  const state: PeerInboundState = record.peerInbound ?? { arrivals: [], ourUuids: new Set(), anchor: undefined, seeded: false, seeding: null, degraded: false };
  record.peerInbound = state;
  // Resolved ONCE, here: whether this thread logs at all is a property of the server's deps rather than of
  // any frame, and re-deciding it per frame is how a write side and a read side come to disagree.
  const store = effectiveArrivalStore(srv.deps);
  // A record admitted WITH a session id (attach, resume) seeds AT INSTALL — the read is fired here and
  // resolves later, so the admission contract stays same-tick and no frame can land before the window is
  // open. A record without one seeds at the frame that reveals the id (below), which covers the FORK shape
  // as much as the fresh one: fork admission deliberately leaves `record.sessionId` undefined over copied
  // history, and grounding confirmed-empty "because there is no id yet" would render a fork's first arrival
  // at the top of a history it did not precede.
  if (store && record.sessionId) beginSeeding(srv, record, state, store, record.sessionId);

  const onFrame = (frame: any): void => {
    if (!frame || typeof frame !== "object") return;
    // Seeding runs at whichever moment the session id is actually known (spec rev 8.1). `routeInit`
    // latches it from the init frame and its subscription was installed first (server.ts's admission
    // spines, rewind's swap), so by the time this observer sees that frame the id is already on the record.
    // `seeded`, never `anchor === undefined`: an anchor that has moved is not evidence that a seed ever
    // ran, and reading it as such let one frame observed before the id was known cancel the seed for the
    // life of the thread — after which every arrival was logged against a chain grounded on `prevUuid:
    // null`, which is the top of a transcript this observer had never read.
    if (store && !state.seeding && !state.seeded && record.sessionId) {
      beginSeeding(srv, record, state, store, record.sessionId);
    }

    if (frame.type === "command_lifecycle") { routeLifecycle(srv, record, state, frame); return; }

    captureFrame(srv, record, state, frame);

    // …and the arrival itself, which is a fact about this THREAD rather than about any one turn: it is
    // held unassigned until lifecycle evidence gives it a turn to belong to. Nothing here branches on
    // `record.busy` — the spec's own measurement is that a message delivered during a busy turn has three
    // possible fates and no way to predict which.
    // No `frame.type === "user"` pre-check: `peerArrival` already owns that, and a second copy of any part
    // of the recognition rule here is the exact drift this task removed.
    const arrived = noteArrival(srv, record, state, store, frame);

    // AN ARRIVAL'S OWN FRAME IS NEVER AN ANCHOR — not for itself, and not for the arrival behind it.
    //
    // This used to run `readerVisible` on every frame, on the reasoning that a peer row is `isMeta` and so
    // fails that predicate anyway. That is true of the row the CLI PERSISTS and was assumed of the frame it
    // STREAMS; the live frame need not carry the flag, and when it does not, an arrival advanced the anchor
    // onto itself. The next arrival of a batch was then anchored to a peer row — which the reader drops
    // unconditionally and will never return — so its anchor could not resolve in any window and criterion
    // 24 withheld it from history forever. Measured twice on LEG 10 of the live suite (three arrivals
    // announced, exactly one in history) and reproduced offline in peer-inbound-log.test.ts (9b).
    //
    // The rule is structural rather than a flag check, which is why it is stated on the ARRIVAL and not on
    // `readerVisible`: whatever a live frame's flags say, an arrival persists as a row the reader does not
    // return, so an anchor naming one is unresolvable by construction. `readerVisible` stays a faithful
    // mirror of the reader over ROWS (its contract test says so); it is simply not asked about a frame this
    // file has already recognised as something the reader will drop.
    if (!arrived && store && readerVisible(frame)) observeVisible(state, frame);

    // AND EVERY FRAME DRAINS, not only an arrival's own. A drain is now what DETECTS a dead bracket as
    // well as what empties a live one, and the frames that mark a bracket ending — an own turn's last
    // assistant frame, a result, a straggler after the terminal — are exactly the ones that used to pass
    // through here without ever asking. Cheap: the queue is empty on the overwhelming majority of frames.
    if (state.arrivals.length) drainArrivals(srv, record, state);
  };

  state.off = record.session.onFrame(onFrame);
  state.offResult = record.session.onUnclaimedResult?.((result: unknown) => claimResult(srv, record, state, result));
}

export function uninstallPeerInbound(record: ThreadRecord): void {
  const state = record.peerInbound;
  if (!state) return;
  state.off?.(); state.off = undefined;
  state.offResult?.(); state.offResult = undefined;
  // The arrivals belonged to the conversation that is being discarded; carrying them into a replacement
  // engine would emit them as items of a turn in a transcript they were never part of. The own bracket
  // goes with them: a turn of the engine being torn down is not a bracket the replacement can reopen.
  state.arrivals.length = 0;
  state.ownTurn = undefined;
  // The seed window belonged to it too — but what it was HOLDING does not go with it. An arrival buffered
  // inside the window has been neither persisted nor announced, so discarding the buffer loses an
  // engine-delivered message from the live channel and from the old session's count at once. It is
  // therefore persisted here, into the session the window opened against (D2: arrivals stay with the
  // transcript they landed in), and AMBIGUOUS: the seed never resolved, so nothing relates this arrival to
  // any row, and counted-but-unplaced is the designed answer for a position that cannot be known.
  //   Not announced: the notification is thread-scoped and this conversation is being discarded — a client
  // told about a peer message on a thread whose history no longer contains it is worse than a count that
  // exceeds the announcements by what the teardown saved, which is the safe direction (over-report reveals
  // a gap that isn't there; the reverse falsely certifies completeness).
  //   A thread torn down BEFORE its window ever opened has nothing here, which is the pre-init limit the
  // spec already states rather than a case this misses: with no session id there is no scope to write into,
  // and such an arrival took M8's announce-only path when it landed.
  const seeding = state.seeding;
  if (seeding && seeding.arrivals.length > 0) {
    let seq = seeding.store.nextSeq(seeding.sessionId);
    for (const pending of seeding.arrivals) writeEntry(state, seeding.store, seeding.sessionId, pending, seq++, true);
    seeding.arrivals.length = 0;
  }
  // The in-flight read's own resolve is declined by `groundSeed`'s identity check.
  // The anchor returns to NOT YET KNOWN, so the next install seeds again against whatever id the record now
  // carries — which is exactly what `thread/clear` needs (a new conversation, a new id at its init frame,
  // an arrival scope that starts empty) and what a rewind swap needs (the retained id, re-read).
  state.seeding = null;
  state.seeded = false;
  state.anchor = undefined;
}
