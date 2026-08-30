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
import { peerArrival, rawTextOf } from "../peer/address.js";
import { contentHash16, fsArrivalStore, type ArrivalAnchor, type ArrivalEntry, type ArrivalFingerprint, type ArrivalStore } from "../peer/arrivalLog.js";
import { getSessionMessages as defaultGetSessionMessages } from "../sessions/index.js";
import { TurnMapper, arrivalItem } from "./items/mapper.js";
import { turnFailureOf } from "../session/turnResult.js";
import { beginTurn, emitItems, type TurnOutcome, type TurnStopped } from "./turns.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer, AppServerDeps } from "./server.js";

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

/** One arrival waiting for a turn to carry it. `origin` rides along because the ITEM carries it (M9,
 *  items/types.ts): the live drain builds the same `arrivalItem` the cold and projected paths build, and a
 *  queue that kept only the text would leave the live path as the one that could not. */
interface Arrival { msgId: string; text: string; origin: Record<string, unknown>; at: number }

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

/** What one buffered arrival needs to become an entry once the seed grounds the chain. `afterFrames` — how
 *  many buffered frames had been observed when it landed — is the only thing that keeps OBSERVATION ORDER
 *  across the two arrays, and it is what lets the replay interleave them again. Frames and arrivals are
 *  held apart rather than in one event list because the overlap search only ever reads the frames. */
interface PendingArrival {
  arrivalUuid: string; text: string; origin: Record<string, unknown>; observedAt: string; afterFrames: number;
  /** Set the moment this arrival's position stops being knowable — the buffered frame it was ordered
   *  against was shed by the cap. It travels to the ENTRY's own `ambiguous`: counted, never placed. */
  ambiguous?: true;
}
/** A buffered frame, digested to exactly what an anchor needs. Holding the raw frame would keep whole
 *  message bodies alive for the length of a read that may be stalling on a network filesystem. */
interface SeedFrame { uuid: string; fp: ArrivalFingerprint }
/** The window carries the SCOPE it opened against, rather than re-reading `record.sessionId` at each use:
 *  a window can outlive the record's id (a clear mints a new one, a teardown drops it), and every entry it
 *  still owes belongs to the transcript the arrival actually landed in — which is D2's rule, not a
 *  convenience. It carries the store for the same reason: whether this thread logs at all was decided once,
 *  at install. */
interface Seeding { sessionId: string; store: ArrivalStore; frames: SeedFrame[]; arrivals: PendingArrival[] }

export interface PeerInboundState {
  off?: () => void;
  offResult?: () => void;
  arrivals: Arrival[];
  /** The command uuids of turns THIS server submitted, so their lifecycle brackets are not adopted.
   *  Per-record (it dies with the thread) and deleted at each terminal (it does not grow with turns). */
  ourUuids: Set<string>;
  adopted?: AdoptedTurn;
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

/** Whether a frame would survive the transcript reader's own filter, and therefore whether it can be named
 *  by an anchor at all. It MIRRORS the reader (`isMeta`, `isSidechain`, `teamName` are dropped; M1 measured
 *  the `isMeta` drop as unconditional with no SDK option reaching it), and that coupling is dangerous in
 *  both directions — dropping a frame the reader keeps leaves an anchor stale but resolvable, which is a
 *  MISPLACEMENT rather than a withholding. So it is one exported predicate with a contract test over a
 *  corpus of real frame shapes behind it, and the SDK bump that introduces drift reddens that test rather
 *  than silently moving arrivals.
 *
 *  IT MIRRORS THE READER AS CALLED, not the reader in principle, which is why `system` is NOT here.
 *  `getSessionMessages` gates `type: "system"` behind `includeSystemMessages`, which defaults false — and
 *  neither caller that matters passes it: this file's own seed read, and `thread/read`'s pager
 *  (subscribe.ts). A system frame admitted as an anchor would therefore name a row the reader never
 *  returns, and every arrival behind it would be withheld forever; `system/init` — which arrives on every
 *  turn — would have been the most common anchor of all. */
export function readerVisible(frame: any): boolean {
  const type = frame?.type;
  if (type !== "user" && type !== "assistant") return false;
  if (typeof frame.uuid !== "string" || !frame.uuid) return false;   // a row with no uuid is not addressable
  return !frame.isMeta && !frame.isSidechain && !frame.teamName;
}

/** The anchor's content identity. A uuid alone is not a row identity (M5: 1,562 duplicate uuid occurrences,
 *  31 disagreeing on their parent), so the fingerprint travels beside it — and `timestamp` is recorded only
 *  when the frame carried one, because live `timestamp` is declared optional and a field absent at
 *  observation must constrain nothing at resolution. */
const fingerprintOf = (row: any): ArrivalFingerprint => ({
  type: String(row.type),
  hash: contentHash16(rawTextOf(row.message?.content)),
  ...(typeof row.timestamp === "string" ? { timestamp: row.timestamp } : {}),
});
const uuidOf = (row: any): string | null => (typeof row?.uuid === "string" && row.uuid ? row.uuid : null);
/** Does a row still look like the frame a fingerprint was taken from? Only the RECORDED fields are
 *  compared — a `timestamp` the live frame omitted constrains nothing, which is the same rule Task 4's
 *  `anchorMatchesRow` applies at resolution; this is that rule's fingerprint half, used here to confirm a
 *  seed occurrence before it is allowed to ground the chain. */
const fpMatchesRow = (fp: ArrivalFingerprint, row: any): boolean => {
  const row_fp = fingerprintOf(row);
  return row_fp.type === fp.type && row_fp.hash === fp.hash
    && (fp.timestamp === undefined || row_fp.timestamp === fp.timestamp);
};
/** `prevUuid` is what pins POSITION: a duplicate uuid rebound by the reader's last-wins keying sits after a
 *  different predecessor, and that is the disagreement the read side withholds on. */
const advanceAnchor = (state: PeerInboundState, f: SeedFrame): void => {
  state.anchor = { afterUuid: f.uuid, prevUuid: state.anchor?.afterUuid ?? null, fp: f.fp };
};

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
    const arrived = noteArrival(srv, record, state, store, frame);
    if (arrived) drainArrivals(srv, record, state);

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
    else if (store && readerVisible(frame)) observeVisible(state, frame);
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
function noteArrival(srv: AppServer, record: ThreadRecord, state: PeerInboundState, store: ArrivalStore | undefined, frame: any): boolean {
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

  state.arrivals.push({ msgId: arrivalUuid, text: arrival.text, origin: arrival.origin, at: Date.now() });
  // Oldest-first, and the drop is announced: a silently truncated queue reads to an operator exactly like
  // a queue nothing was ever written to.
  while (state.arrivals.length > MAX_ARRIVALS) {
    state.arrivals.shift();
    console.warn(`[peer] arrival queue full on thread ${record.id} (cap ${MAX_ARRIVALS}); dropped the oldest`);
  }

  const pending: PendingArrival = {
    arrivalUuid, text: arrival.text, origin: arrival.origin,
    observedAt: new Date().toISOString(),
    afterFrames: state.seeding?.frames.length ?? 0,
  };

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
  }
  return true;
}

/** Write the entry, THEN announce it. Killing the process between the two leaves an entry with no
 *  notification, never the reverse — and the one exception is here, in the catch: a write that throws is
 *  caught (an escaped exception would hit `readLoop`'s discard and vanish), the session latches degraded so
 *  every later `thread/read` reports `arrivals: null` rather than a count that might be short, and the
 *  notification still goes out — the live channel reports what the ENGINE did, and the engine delivered the
 *  message whether or not our sidecar could record it. */
function logArrival(
  srv: AppServer, record: ThreadRecord, state: PeerInboundState, store: ArrivalStore,
  sessionId: string, pending: PendingArrival, seq: number, ambiguous: boolean,
): void {
  writeEntry(state, store, sessionId, pending, seq, ambiguous);
  announceArrival(srv, record, pending);
}

/** The durable half on its own, because one caller has no notification to make: `uninstallPeerInbound`
 *  persists what a torn-down seed window was still holding, and the live channel it would have announced on
 *  belongs to the conversation being discarded. */
function writeEntry(
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

/** The announcement, unchanged since M8 and still the only thing this file says on the wire about an
 *  arrival. Its own function now because TWO paths reach it — an ordinary arrival and a held one flushed
 *  after the seed — and a second copy of this payload is a second answer to what a client receives.
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
 *  WHICH MEANS THIS NOTIFICATION IS NOT A SECOND COPY OF THE ITEM'S TEXT, and in a batch it disagrees with
 *  it: every member of a batch carries the CAUSING message's `origin.body` and `msg_id` beside its OWN
 *  distinct `arrivalUuid`, so a client that renders `origin.body` from here shows one message N times no
 *  matter what `peerArrival` resolved for the item. That is a defect in what this channel offers a client
 *  rather than in the reader, it is not addressed here, and closing it means deciding what `origin` means
 *  when the engine has collapsed several messages into one frame — not quietly editing a verbatim field.
 *
 *  `srv.broadcast` and not `broadcastServer`: this is the thread's SUBSCRIBERS, an audience distinct from
 *  the server-scoped watchers, because an arrival is CONTENT and `watchThreads` is existence fan-out
 *  (fanout.ts). It is the same call `emitItems` makes for the item this arrival becomes. */
function announceArrival(srv: AppServer, record: ThreadRecord, pending: PendingArrival): void {
  srv.broadcast(record.id, "thread/peerMessage", { threadId: record.id, arrivalUuid: pending.arrivalUuid, origin: pending.origin });
}

/** One observed filter-surviving frame: it advances the anchor, or — inside the seed window — waits in the
 *  buffer to advance it once the chain is grounded.
 *
 *  BEFORE THE WINDOW HAS EVER OPENED it does neither, and that is the point: with no seed there is no
 *  chain to advance, so advancing anyway would mint an anchor whose `prevUuid: null` claims to be the top
 *  of a transcript nothing has read. The frame is not lost — the seed read that runs when the id arrives
 *  returns it, since the engine persists what it emits. */
function observeVisible(state: PeerInboundState, frame: any): void {
  const seeding = state.seeding;
  if (!seeding && !state.seeded) return;
  const f: SeedFrame = { uuid: String(frame.uuid), fp: fingerprintOf(frame) };
  if (!seeding) { advanceAnchor(state, f); return; }
  seeding.frames.push(f);
  if (seeding.frames.length <= MAX_CAPTURED) return;
  // The same posture MAX_CAPTURED already takes: a window that overruns loses its earliest frames rather
  // than the process. An arrival that followed a RETAINED frame keeps its exact anchor — the shift moves
  // its index and the frame it names by one, together.
  //
  // AN ARRIVAL POSITIONED BY THE FRAME BEING SHED DOES NOT. Its index would clamp to the window's new
  // start, which is not where it was observed: `groundSeed` recomputes the ground from the frames that
  // REMAIN, so the arrival would anchor before the retained head's occurrence in the seed — potentially
  // hundreds of rows after the frame it actually preceded, and unflagged. That is the misplacement class
  // this milestone forbids, so the position is surrendered instead: ambiguous, counted, never placed.
  seeding.frames.shift();
  for (const a of seeding.arrivals) {
    if (a.afterFrames <= 1) a.ambiguous = true;
    if (a.afterFrames > 0) a.afterFrames -= 1;
  }
}

/** Open the seed window and fire the read that closes it. SYNCHRONOUS up to the read itself, because the
 *  window has to be open before any frame can land in it — install the observer first and seed later and an
 *  immediate arrival is persisted with a `null` anchor (confirmed-empty: the top of history); seed first and
 *  every frame landing during the read is missed. Seeding is therefore an explicit state rather than an
 *  ordering hope. */
function beginSeeding(srv: AppServer, record: ThreadRecord, state: PeerInboundState, store: ArrivalStore, sessionId: string): void {
  const seeding: Seeding = { sessionId, store, frames: [], arrivals: [] };
  state.seeding = seeding;
  // Both halves of "not yet grounded", reset together: `anchor` is WHERE the chain is and `seeded` is
  // WHETHER it is grounded, and a re-seed that cleared only the first would leave a thread claiming a
  // grounded chain it no longer has an anchor for.
  state.anchor = undefined;
  state.seeded = false;
  const epoch = record.epoch;
  const read = srv.deps.getSessionMessages ?? ((id: string) => defaultGetSessionMessages(id) as Promise<unknown[]>);
  const ground = (rows: unknown[]): void => groundSeed(srv, record, state, store, { seeding, sessionId, epoch }, rows as any[]);
  let pending: Promise<unknown[]>;
  // A read FAILURE reads as `[]`: that is what the production reader does (sessions/reader.ts), and the
  // spec records the resulting inability to tell an unreadable transcript from an empty one as a limit of
  // the injected reader's contract rather than something to be distinguished here.
  try { pending = Promise.resolve(read(sessionId)); } catch { pending = Promise.resolve([]); }
  void pending
    .then((rows) => ground(Array.isArray(rows) ? rows : []), () => ground([]))
    .catch(() => { /* backstop: this resolve runs detached from the read loop, which discards rejections */ });
}

/** The seed resolved: ground the chain, then replay the window in observation order — each buffered frame
 *  advancing the anchor, each buffered arrival persisted and announced at the anchor it actually had. */
function groundSeed(
  srv: AppServer, record: ThreadRecord, state: PeerInboundState, store: ArrivalStore,
  ctx: { seeding: Seeding; sessionId: string; epoch: number }, rows: any[],
): void {
  const { seeding, sessionId, epoch } = ctx;
  // The window belonged to a conversation that may since have been swapped or torn down; its buffer went
  // with it (`uninstallPeerInbound`), and flushing into the replacement would key entries to a session this
  // thread no longer has and anchor them to a chain the new engine never had.
  if (state.seeding !== seeding || record.epoch !== epoch) return;
  state.seeding = null;
  state.seeded = true;

  // THE OVERLAP RULE. The seed is NOT a snapshot — the engine persists as it emits — so a frame observed
  // live inside the window can also appear in the read's result, and grounding on the seed's tail would
  // then anchor a buffered arrival AFTER a row that arrived after it. Instead: the earliest buffered frame
  // that occurs anywhere in the seed grounds the chain on the row BEFORE that occurrence, and the buffer
  // replays from its start — so every frame is counted exactly once.
  //
  // AN OCCURRENCE IS CONFIRMED, NEVER ASSUMED. A uuid is not a row identity (M5: 1,562 duplicate uuid
  // occurrences), so the first buffered frame whose uuid appears in the seed decides the grounding — and
  // then has to earn it: exactly one occurrence of that uuid, and that occurrence's fingerprint equal to
  // what was recorded live. Two occurrences, or one that disagrees, is the spec's duplicate-uuid overlap:
  // the frame relates the buffer to the seed at inconsistent positions, so it relates them not at all.
  // That case falls through to the tail with `unrelatable` set, which sends the leading arrivals to
  // ambiguous — persisted, counted, never placed. Taking the first occurrence instead is how a buffered
  // frame matching row 0 of `[X, r-2, X]` grounded on `rows[-1]`, i.e. `null`, i.e. confirmed-empty over a
  // seed that plainly held rows: an unflagged placement at the top of a history it did not precede.
  let at = rows.length;                  // no overlap at all: ground on the seed's tail
  let unrelatable = rows.length > 0;     // …and on rows never seen live, which is what an arrival cannot be ordered against
  for (const f of seeding.frames) {
    const occurrences: number[] = [];
    for (let i = 0; i < rows.length; i++) if (uuidOf(rows[i]) === f.uuid) occurrences.push(i);
    if (occurrences.length === 0) continue;                 // this frame simply is not in the seed yet
    if (occurrences.length === 1 && fpMatchesRow(f.fp, rows[occurrences[0]])) {
      at = occurrences[0];
      unrelatable = false;
    }
    break;                                                  // decided either way — by the EARLIEST such frame
  }
  // A row the reader returned WITHOUT a uuid cannot be named by an anchor — `String(row.uuid)` would mint
  // the literal `"undefined"` and every resolution against it would fail silently. Walk back to the nearest
  // nameable row instead, and say so: skipping one means the ground is no longer the exact position, which
  // is `unrelatable`'s meaning. Unreachable against the production reader (its projection always carries a
  // uuid), and cheap insurance against an embedder's that does not.
  let g = at - 1;
  while (g >= 0 && !uuidOf(rows[g])) g--;
  if (g !== at - 1) unrelatable = true;
  const groundUuid = g >= 0 ? uuidOf(rows[g]) : null;
  state.anchor = groundUuid ? { afterUuid: groundUuid, prevUuid: uuidOf(rows[g - 1]), fp: fingerprintOf(rows[g]) } : null;

  // Re-read rather than carried from install: another process on this session may have appended in the
  // meantime, and a stale base is how two entries come to share a seq.
  let seq = store.nextSeq(sessionId);
  const { arrivals, frames } = seeding;
  let next = 0;
  for (let i = 0; i <= frames.length; i++) {
    while (next < arrivals.length && arrivals[next].afterFrames <= i) {
      const pending = arrivals[next++];
      // AMBIGUOUS, and only here: an arrival with no buffered frame before it, grounded on a seed holding
      // rows this process never saw. The reader drops arrivals, so such a buffer establishes no overlap at
      // all and nothing observed relates the two — the order is genuinely unknowable. Persisted and counted
      // (it is a real message), never placed; grounding it on the seed tail instead would render the
      // question after its own answer, which is this milestone's original defect reproduced at resume.
      logArrival(srv, record, state, store, sessionId, pending, seq++, pending.ambiguous === true || (unrelatable && pending.afterFrames === 0));
    }
    if (i < frames.length) advanceAnchor(state, frames[i]);
  }
  arrivals.length = 0;
}

/** The arrivals this thread is carrying become user items of whichever turn is actually running them —
 *  never before that turn's own `turn/started` has gone out, which is why the only two callers are the
 *  runner (which `beginTurn` invokes after the broadcast) and a frame that landed while one is live. */
function drainArrivals(srv: AppServer, record: ThreadRecord, state: PeerInboundState): void {
  const adopted = state.adopted;
  if (!adopted?.mapper || !adopted.turnId || adopted.terminated) return;
  const turnId = adopted.turnId;
  for (const a of state.arrivals.splice(0, state.arrivals.length)) {
    emitItems(srv, record, turnId, [{ kind: "completed", item: arrivalItem(a.text, a.msgId, a.origin) }]);
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
