// tui/reflowOracle.ts — ask the terminal what it did to the painted frame when the window narrowed, so the
// resize correction (Wave R task 4) fires only where it is actually correct.
//
// WHY A GATE AT ALL (W-R6, and the errors are asymmetric). Ink erases the previous frame's LOGICAL line count,
// but an emulator that RE-WRAPS already-painted text turns that frame into more PHYSICAL rows than it erases,
// and the remainder is the stale residue the wave exists to remove. On an emulator that TRUNCATES instead there
// is no residue at all — and the very same erase then walks up into live transcript rows and destroys them
// (SP-R0's own test lost six). Under-erasing is today's cosmetic defect; over-erasing loses the user's session.
// So: never correct optimistically. Correct only on a measured "reflow".
//
// WHY THE COLUMN, NEVER THE ROW. SP-R0 first tried the cursor's ROW across a resize and the probe was refuted:
// under tmux the row was 3 both before and after a 120→80 narrowing, because tmux pins the cursor's screen row
// and scrolls the excess off the top — re-wrapping and scrolling cancel out exactly. The COLUMN is not pinned.
// A cursor parked at column 121 of a 120-column screen reports column 41 after the narrowing — precisely
// `((121 − 1) mod 80) + 1`, the cell that character now lives in — whereas a truncating emulator destroyed that
// cell and answers something else. One DSR round-trip, and it distinguishes the two worlds.
//
// THE ANSWERABLE DOMAIN, IN ONE PLACE (three rounds of review have narrowed it; do not reconstruct it from the
// arithmetic). `probeReflow` takes the round-trip ONLY when ALL of these hold, and answers "unknown" otherwise —
// never "truncate", because a refusal is a fact about THIS probe, not about the terminal, and Task 4 caches
// verdicts. With `wrapped = ((colBefore − 1) mod newWidth) + 1`:
//   1. no probe has ever timed out in this process — one silent terminal ends probing for good (see the latch);
//   2. `newWidth >= 2` and `colBefore` finite — `process.stdout.columns` is 0 off a tty and `x % 0` is NaN, which
//      compares false against everything and would have answered a CACHEABLE "truncate" on a bogus width;
//   3. `newWidth < oldWidth` — a widening or a height-only drag is not evidence about anything;
//   4. `colBefore > newWidth` — from inside the new width a truncator and a reflower both report `colBefore`;
//   5. `1 < wrapped < newWidth − 1` — the margins are where a truncator's OTHER plausible behaviours land
//      (clamp to `newWidth`, clamp to `newWidth − 1`, home/wrap to 1), and each of those reads as "reflow".
// What is left is an interior column past the new right edge: e.g. the 120→80 drag with the cursor parked at
// `oldWidth − 1 = 119` re-wraps to 39. Roughly three re-wrap values per screen width are refused, plus the
// one-column narrowing — the cost of never guessing on a terminal nobody has measured.
//
// WHY NO STDIN READER LIVES HERE. `keys/KeymapProvider` owns the single raw-stdin reader for the whole tree; a
// second consumer would race it and produce intermittent, unreproducible key loss. The reply reaches us the
// long way round instead: parse.ts already consumes `\x1b[…R` as `ignored("unknown-sequence")` (`CSI_LETTER`
// has no `R`), and the provider forwards those raw bytes through `KeymapDeps.onUnknownSequence`.

/** What the emulator does to already-painted text when the window narrows. `"unknown"` is the answer for a
 *  terminal that never replied — and it must be treated exactly like `"truncate"`: emit no correction. */
export type ReflowVerdict = "reflow" | "truncate" | "unknown";

/** DSR — Device Status Report, "where is the cursor?". The answer is `\x1b[<row>;<col>R`. */
export const DSR_CURSOR_QUERY = "\x1b[6n";

const DSR_REPLY = /^\x1b\[(\d+);(\d+)R$/;

/** Decode one raw sequence as a cursor report, or `null` if it is some other terminal reply (a DA answer, a
 *  mode report, a paste marker). Strict by design: the only query we send is the plain `\x1b[6n`. */
export function parseCursorReport(raw: string): { row: number; col: number } | null {
  const m = DSR_REPLY.exec(raw);
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}

/** Where column `col` ends up after the screen is re-wrapped to `width` columns. NaN for a nonsensical width,
 *  which simply never equals a reported column — the verdict falls to `"truncate"` and nothing is corrected. */
const wrappedColumn = (col: number, width: number): number => ((col - 1) % width) + 1;

export interface CursorReports {
  /** Feed one raw `ignored("unknown-sequence")` payload in; non-reports are dropped. */
  deliver: (raw: string) => void;
  /** The seam `probeReflow` takes. Returns its own unsubscribe. */
  onReply: (cb: (row: number, col: number) => void) => () => void;
}

/** ONE TIMEOUT ENDS PROBING FOR THE PROCESS. A DSR reply carries no correlation token, so the only defence against
 *  a late answer being read as a later probe's own is ordering — and ordering cannot survive a straggler that
 *  outlives the probe it belongs to (a reply later than `2 × timeoutMs` slips past the swallower below and lands on
 *  the next probe; measured, on the same slow link the timeout exists for). Alternating DSR forms as a token would
 *  close it, but `\x1b[?6n` is DECXCPR and is not universally answered — a rare wrong answer traded for a common
 *  missing one. So: latch instead. A terminal that failed to answer once is a terminal we cannot measure; a single
 *  success caches the verdict for the session, so almost nothing is lost; and the hole closes completely rather
 *  than narrowing. Conservative, which is this module's whole rule. */
let probingGaveUp = false;

/** The latch is process-wide, so a test that lets a probe time out would poison every test after it. Reset it. */
export function resetReflowProbingForTest(): void { probingGaveUp = false; }

/** The adapter between the provider's ONE raw-string sink and `probeReflow`'s subscribe/unsubscribe seam.
 *  Both halves are closures, so `deliver` and `onReply` can be passed as bare function references.
 *
 *  ONE REPLY, ONE CONSUMER, OLDEST FIRST — this is a request/response protocol, not an event bus. A DSR reply
 *  carries no correlation token, so the only thing that can match answers to queries is their order: the Nth
 *  reply answers the Nth outstanding query. Broadcasting instead would let one reply resolve every listening
 *  probe (and, with a probe that timed out but is still owed an answer, resolve the WRONG one). `Set` iterates
 *  in insertion order, which is exactly the queue we want. */
export function createCursorReports(): CursorReports {
  const subs = new Set<(row: number, col: number) => void>();
  return {
    deliver: (raw) => { const at = parseCursorReport(raw); if (at) for (const cb of subs) { cb(at.row, at.col); break; } },
    onReply: (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}

/** One DSR round-trip, taken AFTER the resize with the column the cursor held BEFORE it.
 *
 *  The timeout is not a formality: plenty of terminals never answer a cursor query, and this promise is awaited
 *  on the resize path — a hang here would freeze the UI. It resolves `"unknown"`, which is the verdict that
 *  keeps the correction off a terminal we could not measure. */
export function probeReflow(deps: {
  write: (s: string) => void;
  onReply: (cb: (row: number, col: number) => void) => () => void;
  colBefore: number; oldWidth: number; newWidth: number;
  timeoutMs?: number;
}): Promise<ReflowVerdict> {
  const { write, onReply, colBefore, oldWidth, newWidth, timeoutMs = 150 } = deps;
  // WHICH PROBES CAN ANSWER AT ALL — the domain enumerated in the header, in guard order. Every clause refuses a
  // case that would otherwise read as "reflow" and over-erase live transcript rows (the one failure this oracle
  // exists to prevent), or would cache a verdict off a measurement that never happened. A truncating emulator was
  // once modelled as answering only `colBefore` or `newWidth`; that model is UNPROBED, and its two plausible extra
  // behaviours (home/wrap to 1, clamp a cell short of the margin) both sit at a margin — hence clause 5, which
  // also subsumes the old `colBefore % newWidth === 0` clause, since that is exactly `wrapped === newWidth`.
  // "unknown" (never "truncate") throughout: these are facts about THIS probe, not about the terminal.
  const wrapped = wrappedColumn(colBefore, newWidth);
  if (probingGaveUp || !(newWidth >= 2) || !Number.isFinite(colBefore) || !(newWidth < oldWidth)
      || !(colBefore > newWidth) || wrapped <= 1 || wrapped >= newWidth - 1) return Promise.resolve("unknown");
  return new Promise((resolve) => {
    let off: (() => void) | undefined;
    let done = false, swallowing = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const release = () => { clearTimeout(grace); off?.(); off = undefined; };   // idempotent: never double-unsubscribe
    const settle = (verdict: ReflowVerdict) => {
      if (done) return;                                    // a report racing the timeout, or a second report
      done = true;
      clearTimeout(timer);                                 // …so a pending probe cannot hold the process open
      release();
      resolve(verdict);
    };
    // GIVING UP IS NOT THE SAME AS LETTING GO — and here it also ends probing for good (`probingGaveUp`, above).
    // The latch is what actually protects the next probe from our straggler; the swallower below is the second
    // line, covering the window before the latch matters and any future consumer of the same bus. The answer to
    // THIS query may still be in flight (a slow link is the realistic case, not a silent terminal) and it carries
    // nothing that identifies it, so resolve on time, then stay at the head of the queue for one more window and
    // eat exactly that straggler. Bounded either way: whichever comes first.
    const timer = setTimeout(() => {
      if (done) return;
      done = true; swallowing = true; probingGaveUp = true;
      grace = setTimeout(release, timeoutMs);
      resolve("unknown");
    }, timeoutMs);
    // Subscribe BEFORE the query goes out: a terminal that answers immediately must not answer into nothing.
    // The reported ROW is deliberately unread (see the header — tmux pins it).
    off = onReply((_row, col) => {
      if (swallowing) { release(); return; }               // our own straggler: eat it, then get out of the way
      settle(col === wrapped ? "reflow" : "truncate");
    });
    // A synchronous throw here (write after end, EPIPE while the terminal tears down) would REJECT a promise whose
    // contract is "resolves `unknown` rather than hanging", and would leave a dead probe at the head of the bus
    // eating a live one's reply. Settle it instead — this is not a timeout, so it does not latch the give-up.
    try { write(DSR_CURSOR_QUERY); } catch { settle("unknown"); }
  });
}
