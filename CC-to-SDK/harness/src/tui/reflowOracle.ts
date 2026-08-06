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

/** The adapter between the provider's ONE raw-string sink and `probeReflow`'s subscribe/unsubscribe seam.
 *  Both halves are closures, so `deliver` and `onReply` can be passed as bare function references. */
export function createCursorReports(): CursorReports {
  const subs = new Set<(row: number, col: number) => void>();
  return {
    deliver: (raw) => { const at = parseCursorReport(raw); if (at) for (const cb of [...subs]) cb(at.row, at.col); },
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
  // A cursor that was ALREADY within the new width tells us nothing: it reports `colBefore` on a reflowing
  // terminal (the arithmetic is the identity there) and sits untouched at `colBefore` on a truncating one. Both
  // answer the same, and the verdict rule would read that as "reflow" — the false positive that over-erases
  // live transcript rows. SP-R0's own probe parked the cursor at column 121 of an 80-column screen for exactly
  // this reason. Refuse the round-trip instead of taking an answer we cannot read; "unknown" (not "truncate")
  // because it is a fact about THIS probe, not about the terminal, and the caller may re-probe.
  if (!(colBefore > newWidth)) return Promise.resolve("unknown");
  return new Promise((resolve) => {
    let off: (() => void) | undefined;
    let done = false;
    const settle = (verdict: ReflowVerdict) => {
      if (done) return;                                    // a report racing the timeout, or a second report
      done = true;
      clearTimeout(timer);                                 // …so a pending probe cannot hold the process open
      off?.();
      resolve(verdict);
    };
    const timer = setTimeout(() => settle("unknown"), timeoutMs);
    // Subscribe BEFORE the query goes out: a terminal that answers immediately must not answer into nothing.
    // The reported ROW is deliberately unread (see the header — tmux pins it).
    off = onReply((_row, col) => { settle(newWidth < oldWidth && col === wrappedColumn(colBefore, newWidth) ? "reflow" : "truncate"); });
    write(DSR_CURSOR_QUERY);
  });
}
