// tui/resizeRepaint.ts — Wave R task 4, the CORRECTION. Ink erases the previous frame's LOGICAL line count
// (`log-update.js`: `previousLineCount = output.split("\n").length`), but an emulator that RE-WRAPS already
// painted text turns that frame into more PHYSICAL rows than Ink erases. The remainder is the stale residue the
// wave exists to remove — a duplicate composer block and full-width rules left over at the old width.
//
// THE ONE RULE. Under-erasing leaves today's cosmetic defect; over-erasing walks up into live transcript rows and
// destroys the user's session (SP-R0 lost six). So nothing here corrects optimistically: a correction is emitted
// only for a MEASURED `"reflow"` (`reflowOracle.probeReflow`), only on a genuine narrowing, and only when there is
// a recorded frame to measure. `"unknown"` behaves exactly like `"truncate"` — emit nothing.
//
// WHY THE CURSOR IS PARKED, AND WHAT PARKING COSTS. The oracle can only answer when the cursor sits PAST the new
// right edge, and the new width is not known until the resize has already happened — so the cursor must be parked
// in advance, on every frame. Ink leaves it at column 1 of the blank row below the frame, and MEASUREMENT (tmux
// 3.7b, the emulator the residue bug reproduces under) settled how to move it: a bare `\x1b[<col>G` on that blank
// row reports column 1 after the drag, not the re-wrapped column, because tmux clamps a cursor to its line's USED
// cells when it reflows (`grid_wrap_position`: `if (px >= gl->cellused) xx = ax + gl->cellused`). Padding the row
// with spaces out to the park column makes those cells used, and the same 120→80 drag then reports exactly
// `((117 − 1) mod 80) + 1 = 37`. So the park PADS, and the padded row re-wraps on a shrink like any other content
// — which is why `occupiedRows` counts it rather than assuming the brief's flat "+ 1".
//
// WHY TWO EMISSION POINTS. `probeReflow` is async and Ink's own `resized` handler (`ink.js:83`) repaints
// synchronously on SIGWINCH, so the FIRST shrink of a session cannot be corrected before Ink paints. It is
// corrected after instead: erase the residue AND the frame Ink just painted, then write that frame straight back
// (`createForceRepaint`). Once the verdict is cached — it is a property of the TERMINAL, not of the resize — every
// later shrink is corrected from the resize listener ahead of Ink's repaint, which costs no flicker at all.
import stringWidth from "string-width";
import type { ReflowVerdict } from "./reflowOracle.js";

/** How many PHYSICAL terminal rows `frame` occupies at `width` — the reflowed height, which is what a resize
 *  changes and what Ink's own `previousLineCount` (logical lines, at the OLD width) gets wrong. Counts the frame's
 *  own lines only: Ink writes `str + "\n"` and records `split("\n").length`, i.e. logical lines + 1, so callers add
 *  that trailing term themselves — deliberately, so the convention stays visible at the point of use (W-R t4). */
export function physicalRows(frame: string, width: number): number {
  let rows = 0;
  for (const line of frame.replace(/\n$/, "").split("\n")) rows += Math.max(1, Math.ceil(stringWidth(line) / width));
  return rows;
}

/** How many rows Ink will erase before its next repaint: its `previousLineCount`, which is exactly the recorded
 *  frame's own `split("\n").length` (the frame is stored as Ink wrote it, trailing newline included). */
export function inkErases(frame: string): number { return frame.split("\n").length; }

/** `ansiEscapes.eraseLines(n)`, byte for byte: a run of `\x1b[2K` / `\x1b[1A` closed by `\x1b[G`. It clears n rows
 *  counting upward from the cursor's own row and leaves the cursor at column 1 of the TOPMOST one — so two runs
 *  laid end to end cover `a + b − 1` distinct rows, not `a + b`. Every count below carries that shared row. */
export function eraseRows(n: number): string {
  return n <= 0 ? "" : "\x1b[2K\x1b[1A".repeat(n - 1) + "\x1b[2K" + "\x1b[G";
}

/** How far in from the right margin the cursor parks. NOT 1: the re-review found `oldWidth − 1` permanently
 *  refuses the exact-half drag (120→60 re-wraps to 59, a near-margin column the oracle will not read), while
 *  `oldWidth − 3` answers 105 of 118 possible new widths from a 120-column start and puts 120→60 on column 57. */
export const PARK_INSET = 3;

/** The column to park in, or 0 for a terminal with no interior column to park in (and no residue worth chasing). */
export function parkColumn(columns: number): number {
  return Number.isFinite(columns) && columns >= 8 ? columns - PARK_INSET : 0;
}

/** Home the cursor, pad the row out to `col` with spaces, then sit inside the padding. The padding is what makes
 *  the cell USED, which is what makes a reflowing emulator carry the cursor with it (see the header). */
export function parkSequence(col: number): string { return `\x1b[G${" ".repeat(col)}\x1b[${col}G`; }

/** Rows the painted frame plus the parked cursor row below it occupy at `width`. The cursor row is one row only
 *  while the padding fits inside `width`; on a shrink it re-wraps too, and forgetting that under-erases by
 *  `ceil(parkedCol / width) − 1`. */
export function occupiedRows(frame: string, parkedCol: number, width: number): number {
  return physicalRows(frame, width) + Math.max(1, Math.ceil(Math.max(0, parkedCol) / width));
}

/** What the resize listener knows synchronously, before Ink has repainted: the frame that is currently painted,
 *  the column it parked the cursor in, the widths either side of the drag, and the screen height. */
export interface ResizeSample { frame: string; parkedCol: number; oldWidth: number; newWidth: number; rows: number }

/** The region that must end up clear: everything from the top of the painted frame through the cursor's row,
 *  measured at the NEW width. Capped at the screen — the cap is a bound on a miscalculation, NOT what makes the
 *  erase safe (a recorded frame taller than the live region would still over-erase inside the cap). What makes it
 *  safe is upstream: `createResumeSafeStdout` drops the recorded frame the moment an erase-only write puts it off
 *  screen, so `lastFrame()` is `undefined` and nothing here is emitted at all. */
function regionRows(s: ResizeSample): number {
  return Math.min(occupiedRows(s.frame, s.parkedCol, s.newWidth), Math.max(1, s.rows));
}

/** True only for a genuine narrowing with a measured reflow — every other combination emits nothing. */
function corrects(s: ResizeSample, verdict: ReflowVerdict): boolean {
  return verdict === "reflow" && s.newWidth >= 2 && s.newWidth < s.oldWidth;
}

/** THE CORRECTION, EMITTED AHEAD OF INK'S OWN REPAINT (the cached-verdict path). Ink is about to erase
 *  `inkErases(frame)` rows from wherever the cursor is and repaint from there; we erase the rows above that first,
 *  plus the one row the two runs share, so together they cover the region exactly and Ink's repaint lands on the
 *  frame's original top row. Emitting the WHOLE region here instead would leave Ink's own erase to walk a further
 *  `inkErases − 1` rows into the live transcript — which is exactly the six rows SP-R0 lost. */
export function correctionBeforeRepaint(s: ResizeSample, verdict: ReflowVerdict): string {
  if (!corrects(s, verdict)) return "";
  const region = regionRows(s), ink = inkErases(s.frame);
  return region > ink ? eraseRows(region - ink + 1) : "";                 // no residue → nothing to correct
}

/** THE CORRECTION FOR A SESSION'S FIRST SHRINK, once the async verdict lands. Ink has already repainted and the
 *  proxy has already re-parked, so the screen is now `residue · newFrame · parked cursor row` and the cursor is at
 *  the bottom of it. Erase all of that — the new frame included, there is no way to reach the residue above it
 *  otherwise — and write the frame straight back. That ordering is safe precisely BECAUSE the frame comes back:
 *  the bytes are the ones Ink last wrote, so its `previousLineCount` / `previousOutput` still describe the screen
 *  and its next render is unaffected. Costs one repaint's flicker, once per session. */
export function correctionAfterRepaint(s: ResizeSample, verdict: ReflowVerdict, frameNow: string | undefined, parkedColNow: number): string {
  if (!corrects(s, verdict) || frameNow === undefined) return "";
  const residue = regionRows(s) - inkErases(s.frame);
  if (residue <= 0) return "";
  const erase = Math.min(residue + occupiedRows(frameNow, parkedColNow, s.newWidth), Math.max(1, s.rows));
  return eraseRows(erase) + frameNow;
}

/** FORCE A RENDER INK'S DEDUPE CANNOT SWALLOW. `log-update` returns early when the output equals the last one and
 *  `ink.js` guards on `output !== this.lastOutput`, so nothing in the tree can ask for the same frame twice — and
 *  after we erase, the same frame is exactly what the screen needs. Write the recorded bytes ourselves instead:
 *  they are Ink's own, so every counter it keeps stays true. `prefix` carries whatever must land in the same write
 *  (task 4 the erase run; task 7's `/clear` the terminal wipe) and is emitted even with nothing recorded to
 *  repaint, which is why the return value reports whether a frame actually went back. */
export function createForceRepaint(deps: { lastFrame: () => string | undefined; write: (s: string) => void }): (prefix?: string) => boolean {
  return (prefix = "") => {
    const frame = deps.lastFrame();
    if (frame === undefined) { if (prefix) deps.write(prefix); return false; }
    deps.write(prefix + frame);
    return true;
  };
}

export interface ResizeRepaintDeps {
  lastFrame: () => string | undefined;
  parkedColumn: () => number;
  size: () => { columns: number; rows: number };
  /** Terminal bookkeeping straight to the tty — never recorded as a frame, never re-parked. */
  emit: (s: string) => void;
  /** Ink's own stdout, so an erase-plus-frame write re-records the frame and re-parks the cursor on it. */
  repaint: (s: string) => void;
  probe: (a: { colBefore: number; oldWidth: number; newWidth: number }) => Promise<ReflowVerdict>;
}

export interface ResizeRepaint {
  /** Attach this to `stdout`'s `resize` BEFORE `render()` — Ink subscribes in its constructor (`ink.js:77`) and
   *  repaints synchronously, so a listener added later can never get ahead of it. */
  onResize: () => void;
  /** The task-7-shared primitive, exposed so `/clear` does not have to rebuild it. */
  forceRepaint: (prefix?: string) => boolean;
}

export function createResizeRepaint(deps: ResizeRepaintDeps): ResizeRepaint {
  let width = deps.size().columns;
  // ONE MEASUREMENT PER TERMINAL. The verdict describes the emulator, not the drag, so a success caches for the
  // session. `"unknown"` is a fact about THIS probe (an ambiguous column, a width dividing it, a terminal that
  // stayed silent) and is never cached — the next shrink asks again.
  let verdict: ReflowVerdict | undefined;
  // ONE PROBE IN FLIGHT. A DSR reply carries no correlation token, so `createCursorReports` hands replies out
  // oldest-first; a second concurrent probe would be answered by the first one's reply.
  let probing = false;
  const forceRepaint = createForceRepaint({ lastFrame: deps.lastFrame, write: deps.repaint });
  const onResize = (): void => {
    const oldWidth = width, size = deps.size(), newWidth = size.columns;
    width = newWidth;
    const frame = deps.lastFrame(), parkedCol = deps.parkedColumn();
    if (frame === undefined || !(newWidth >= 2) || !(newWidth < oldWidth)) return;
    const sample: ResizeSample = { frame, parkedCol, oldWidth, newWidth, rows: size.rows };
    if (verdict !== undefined) { const seq = correctionBeforeRepaint(sample, verdict); if (seq) deps.emit(seq); return; }
    if (probing) return;
    probing = true;
    void deps.probe({ colBefore: parkedCol, oldWidth, newWidth }).then((answer) => {
      probing = false;
      if (answer !== "unknown") verdict = answer;
      // THE VERDICT SURVIVES A LATER DRAG; THE MEASUREMENT DOES NOT. `probeReflow` waits up to 750 ms, and every
      // row count in `sample` was taken at `sample.newWidth`. If the terminal has been dragged again since, the
      // frame on screen re-wrapped to a different height and the sample's erase is measured against a width that
      // no longer exists — a shrink to 80 followed by a widen to 200 mid-flight erases 13 rows over 7 occupied,
      // i.e. six live transcript rows, the over-erase this whole correction exists to avoid. So keep the answer
      // (it describes the TERMINAL) and abandon the emission (it described a screen that is gone). The next
      // shrink takes the cached-verdict path and is corrected synchronously, with no stale sample at all.
      if (deps.size().columns !== sample.newWidth) return;
      const seq = correctionAfterRepaint(sample, answer, deps.lastFrame(), deps.parkedColumn());
      if (seq) deps.repaint(seq);
    });
  };
  return { onResize, forceRepaint };
}
