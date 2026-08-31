// appserver/peerSeed.ts — the seed window: where an arrival's POSITION in the transcript comes from.
//
// A thread cannot say where an arrival belongs until it has read the transcript it belongs to, and that
// read is asynchronous while the frames are not. So the window is an explicit state rather than an ordering
// hope: it opens synchronously, holds every frame and arrival that lands inside it, and replays them in
// observation order once the read grounds the chain.
import { rawTextOf } from "../peer/address.js";
import { contentHash16, type ArrivalFingerprint, type ArrivalStore } from "../peer/arrivalLog.js";
import { getSessionMessages as defaultGetSessionMessages } from "../sessions/index.js";
import { MAX_CAPTURED, drainArrivals, type ArrivalBinding } from "./peerAdoption.js";
import { logArrival } from "./peerArrivalPath.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer } from "./server.js";
import type { PeerInboundState } from "./peerInbound.js";

/** What one buffered arrival needs to become an entry once the seed grounds the chain. `afterFrames` — how
 *  many buffered frames had been observed when it landed — is the only thing that keeps OBSERVATION ORDER
 *  across the two arrays, and it is what lets the replay interleave them again. Frames and arrivals are
 *  held apart rather than in one event list because the overlap search only ever reads the frames. */
export interface PendingArrival {
  arrivalUuid: string; text: string; origin: Record<string, unknown>; observedAt: string; afterFrames: number;
  /** Stamped HERE — synchronously at frame arrival — and carried through the flush unchanged. The seed
   *  read can stall across a bracket transition, so a binding taken when the buffer flushes would attribute
   *  an arrival observed under T1 to whichever turn happened to be running when the read came back. */
  bind: ArrivalBinding;
  /** Set the moment this arrival's position stops being knowable — the buffered frame it was ordered
   *  against was shed by the cap. It travels to the ENTRY's own `ambiguous`: counted, never placed. */
  ambiguous?: true;
}
/** A buffered frame, digested to exactly what an anchor needs. Holding the raw frame would keep whole
 *  message bodies alive for the length of a read that may be stalling on a network filesystem. */
export interface SeedFrame { uuid: string; fp: ArrivalFingerprint }
/** The window carries the SCOPE it opened against, rather than re-reading `record.sessionId` at each use:
 *  a window can outlive the record's id (a clear mints a new one, a teardown drops it), and every entry it
 *  still owes belongs to the transcript the arrival actually landed in — which is D2's rule, not a
 *  convenience. It carries the store for the same reason: whether this thread logs at all was decided once,
 *  at install. */
export interface Seeding { sessionId: string; store: ArrivalStore; frames: SeedFrame[]; arrivals: PendingArrival[] }

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

/** One observed filter-surviving frame: it advances the anchor, or — inside the seed window — waits in the
 *  buffer to advance it once the chain is grounded.
 *
 *  BEFORE THE WINDOW HAS EVER OPENED it does neither, and that is the point: with no seed there is no
 *  chain to advance, so advancing anyway would mint an anchor whose `prevUuid: null` claims to be the top
 *  of a transcript nothing has read. The frame is not lost — the seed read that runs when the id arrives
 *  returns it, since the engine persists what it emits. */
export function observeVisible(state: PeerInboundState, frame: any): void {
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
export function beginSeeding(srv: AppServer, record: ThreadRecord, state: PeerInboundState, store: ArrivalStore, sessionId: string): void {
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
  // AND ONLY NOW are they drainable. Each `logArrival` above queued its arrival after writing it, in the
  // replay's own interleaved order; this is the drain that carries them into a turn adopted while the seed
  // was still in flight. Without it a held arrival would wait for the next frame to trigger a drain — and
  // with it any earlier, the item would have gone out ahead of the entry (round 2, finding 3). A thread
  // with no adopted turn drains nothing here and keeps them queued for the turn that comes.
  drainArrivals(srv, record, state);
}
