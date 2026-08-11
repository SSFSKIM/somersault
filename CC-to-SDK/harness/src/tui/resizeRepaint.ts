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
// WHY THE CORRECTION LIVES AT THE WRITE, NOT AT THE SIGNAL (task 4b, forced by task 4's review). A SIGWINCH does
// not imply an Ink write. `ink.js:83` `resized()` calls `onRender()`, but `onRender` (`:133`) hands the bytes to
// `throttledLog` — `throttle(this.log, undefined, {leading:true, trailing:true})` (`:45`-`:48`) — so a burst of
// signals produces one immediate write and one deferred to a trailing timer; and `log-update.js`'s `render`
// returns early when `output === previousOutput`, so Ink may write NOTHING. Task 4 erased the rows above Ink's
// own erase from the resize listener, on the contract that Ink's `eraseLines(previousLineCount)` follows
// immediately and the two runs share one row — a contract Ink breaks both of those ways, which is why a
// one-column-at-a-time drag still left 3 stale rule rows (measured over 46 cells).
//   Residue is created only by a frame write that under-erases, so `frameWriteCorrection` corrects THAT, from the
// stdout proxy, at the moment the bytes arrive. Nothing there is predicted: the previous frame and the width it
// was painted at are recorded, the park is where the proxy last put it, Ink's erase depth is countable in its own
// prefix, and the width is read live. A deduped write needs no correction (the re-wrapped old frame is simply on
// screen, whole); a deferred write is corrected against the width that is true when it lands. Bursts stop being
// a case at all.
// TWO EMISSION POINTS SURVIVE HERE, and both are about the window in which the terminal is not yet MEASURED.
// At a session's FIRST shrink the verdict is still unknown when Ink writes, so that one write goes out
// uncorrected and `correctionAfterRepaint` repairs the screen once the probe answers: erase the residue AND the
// frame Ink just painted, then write that frame straight back, in one chunk. Every later shrink is a property of
// a TERMINAL already measured, so the write-time corrector has its verdict.
//   …EXCEPT WHEN THE DRAG DOES NOT STOP (W2 t7, s2qa2-07). One probe may be in flight at a time and its sample is
// abandoned the moment the terminal moves off the width it was measured at (`:191`), so a BURST — a drag that
// crosses several widths before it settles — leaves every one of its legs uncorrected, and the residue they
// stranded is permanent: nothing in the system ever looks above the current frame again. `correctionAtSettle` is
// the second point: one bounded pass, once the drag has stopped for `RESIZE_SETTLE_MS`, and DIRECTION-INDEPENDENT
// — a round-trip burst (120 → 90 → 150 → 120) nets no narrowing at all, so every path that compares old against
// new declines while the 90 leg's residue is still on screen. It measures the SETTLED screen for everything the
// settled screen can report, and remembers the narrowing as a PAIR (width and the frame that was on it).
//   A MONOTONIC burst (120 → 100 → 80) stops ON its narrowing instead of walking back off it, and that pass runs
// `correctionAfterRepaint` rather than `correctionAtSettle` — the same repair, arriving late, because nothing has
// re-wrapped since the leg that stranded the rows. See `repairAtSettle`.
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

/** What is known at the instant a frame write reaches the proxy, all of it measured rather than predicted:
 *  `inkErases` counted out of this write's own erase prefix, the frame recorded from the PREVIOUS write and the
 *  width that write went out at, the park as it currently stands on screen, and the live terminal size. */
export interface FrameWriteInfo { inkErases: number; prevFrame: string; parkedCol: number;
  widthAtPaint: number; width: number; rows: number }

/** THE CORRECTION, INJECTED BETWEEN INK'S ERASE PREFIX AND THE BODY OF THE WRITE THAT NEEDS IT. Ink's prefix
 *  clears `inkErases` rows and leaves the cursor at column 1 of the topmost of them; the frame it is replacing
 *  actually occupies more rows than that at the LIVE width, and the difference is the residue. `eraseRows(
 *  shortfall + 1)` re-clears that topmost row plus `shortfall` above it, so the two runs cover exactly
 *  `inkErases + shortfall` distinct rows and the body paints from the region's true top.
 *  The refusals are the whole safety argument (over-erase destroys the session, under-erase costs a cosmetic
 *  row): only a MEASURED `"reflow"` corrects, only when this frame was painted at a wider terminal than the one
 *  it is being re-written into, and never off a width the arithmetic cannot be trusted on — `stdout.columns` is 0
 *  off a tty, and `ceil(n / 0)` is Infinity, which the screen cap would silently turn into a full-screen erase. */
export function frameWriteCorrection(info: FrameWriteInfo, verdict: ReflowVerdict | undefined): string {
  if (verdict !== "reflow" || !(info.width >= 2) || !(info.width < info.widthAtPaint)) return "";
  const region = Math.min(occupiedRows(info.prevFrame, info.parkedCol, info.width), Math.max(1, info.rows));
  const shortfall = region - info.inkErases;
  return shortfall > 0 ? eraseRows(shortfall + 1) : "";                   // no residue → nothing to correct
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

/** WAVE 2 TASK 7 (s2qa2-07) — how long the drag has to STOP for before the burst repair runs. Trailing: every
 *  signal restarts it, so one drag produces one pass however many SIGWINCHes it emitted. It does NOT delay the
 *  probe (see `onResize`) — 80 ms is chosen only to outlast the gap between two signals of one drag. */
export const RESIZE_SETTLE_MS = 80;

/** What the SETTLED screen is (`frame`, `parkedCol`, `width`, `rows` — all read live at the moment the repair
 *  runs), plus the one thing about the burst that the settled screen cannot report about itself: the narrowest
 *  width a NARROWING inside it landed on (`Infinity` for a burst that only grew) AND THE FRAME THAT WAS ON
 *  SCREEN THEN. Those two are ONE SAMPLE and are recorded together — a remembered width paired with whatever
 *  frame happens to be live at settle time measures a re-wrap that never happened (fix round 1, finding 2). */
export interface SettleSample { frame: string; frameAtNarrowest: string; parkedCol: number; width: number; narrowest: number; rows: number }

/** THE BURST REPAIR (W2 t7), run once the drag has stopped for `RESIZE_SETTLE_MS`. It exists because every other
 *  path in this module is gated on a narrowing BETWEEN TWO ADJACENT SIGNALS, and a burst that ends where it began
 *  — 120 → 90 → 150 → 120, the finding's own sequence — contains no such pair at settle time: `onResize` refuses
 *  (`newWidth < oldWidth`), `frameWriteCorrection` refuses (`width < widthAtPaint`), and the probe's sample is
 *  abandoned by the `:191` guard the moment the terminal moves off the width it was measured at. The residue the
 *  90 leg left is on screen all the same, and nothing in the system ever looks above the current frame again.
 *  So this one is DIRECTION-INDEPENDENT: it does not compare old against new at all. It asks how much taller the
 *  frame that was ON SCREEN WHEN THE BURST NARROWED would have been at that narrowest width — those extra rows
 *  are rows that frame painted during the drag and Ink's logical-line erase never covered — erases them together
 *  with the frame that is on screen NOW and its park row, and writes that frame straight back, exactly as
 *  `correctionAfterRepaint` does and for the same reason (the bytes are the ones Ink last wrote, so log-update's
 *  counters still describe the screen).
 *  THE SAFETY ARGUMENT IS THE FILE'S, UNCHANGED (`:6-9`). Only a MEASURED `"reflow"` corrects; the erase is
 *  capped at the screen; and — fix round 1, finding 2 — EACH TERM IS MEASURED OFF THE FRAME IT IS ABOUT, which
 *  is `correctionAfterRepaint`'s split exactly: the residue off the REMEMBERED frame, the region off the LIVE
 *  one. The shipped version paired the live frame with the remembered WIDTH, which moves the stale-sample
 *  hazard the `:191` guard exists for rather than removing it: a streaming turn that grew the frame during the
 *  drag scaled the claim with the wrong frame, and the reviewer drove 31 rows erased over 21 occupied and 0
 *  owed — ten live viewport rows. Where this is wrong it is wrong SHORT: a burst with several shrinks strands
 *  more than one frame's worth and this claims only the deepest single excursion, which leaves a cosmetic row
 *  rather than eating a live one.
 *  THE STANDING UNDER-ERASE RESIDUAL, for whoever reads a stale row and comes looking: on a terminal that has
 *  ALREADY been measured, a burst leg whose frame write took Ink's tall-frame (`clearTerminal`) branch or was
 *  deduped away is out of this pass's reach by construction — `onResize` ends the burst on any narrowing once a
 *  verdict is cached, on the argument that every write from there is corrected at the write, and those two are
 *  the writes that are not. Cosmetic, and on the side of the asymmetry at `:6-9`. */
export function correctionAtSettle(s: SettleSample, verdict: ReflowVerdict | undefined): string {
  if (verdict !== "reflow" || !(s.width >= 2) || !(s.narrowest >= 2) || !(s.narrowest < s.width)) return "";
  // The park row is deliberately NOT in this difference: the proxy re-parks after every frame Ink wrote during
  // the drag, and `parkColumn` is always inside its own width, so that row was one row at every width the burst
  // visited. Measuring the LIVE park (117, chosen for 120) against 90 would claim a second row that was never
  // painted — an over-erase of exactly one row, the direction this file does not take.
  const residue = physicalRows(s.frameAtNarrowest, s.narrowest) - physicalRows(s.frameAtNarrowest, s.width);
  if (residue <= 0) return "";
  const erase = Math.min(residue + occupiedRows(s.frame, s.parkedCol, s.width), Math.max(1, s.rows));
  return eraseRows(erase) + s.frame;
}

export interface ResizeRepaintDeps {
  lastFrame: () => string | undefined;
  parkedColumn: () => number;
  size: () => { columns: number; rows: number };
  /** Ink's own stdout, so an erase-plus-frame write re-records the frame and re-parks the cursor on it. */
  repaint: (s: string) => void;
  probe: (a: { colBefore: number; oldWidth: number; newWidth: number }) => Promise<ReflowVerdict>;
  /** W2 t7 — the settle window's timer, injected in this codebase's usual shape (`statusLine.ts:263`-`:264`).
   *  The default unrefs, so a drag in flight at exit never holds the process open. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  settleMs?: number;
}

export interface ResizeRepaint {
  /** Attach this to `stdout`'s `resize` BEFORE `render()` — Ink subscribes in its constructor (`ink.js:77`) and
   *  repaints synchronously, so a listener added later can never get ahead of it. */
  onResize: () => void;
  /** W2 t7 — drop the settle window on the way out. The trailing timer is the one thing here that outlives the
   *  signal that armed it, and its emission WRITES: a drag in the last 80 ms of a session would otherwise repaint
   *  a frame into a terminal `runChatClient`'s `finally` has already unparked and handed back to the shell. */
  stop: () => void;
  /** The measured verdict AS THE WRITE-TIME CORRECTOR MUST SEE IT: the cached answer, except while this module is
   *  writing its own erase-plus-frame chunk, where it reads `undefined`. That chunk already carries a full-region
   *  erase and goes back through Ink's stdout (which is what re-records the frame and re-parks the cursor) — so it
   *  passes the corrector too, and a second erase run stacked on the first walks into live transcript. */
  verdict: () => ReflowVerdict | undefined;
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
  // Our own erase-plus-frame writes carry their own full-region erase; see `ResizeRepaint.verdict`.
  let selfWriting = false;
  const repaintSelf = (s: string): void => { selfWriting = true; try { deps.repaint(s); } finally { selfWriting = false; } };
  const arm = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => { const h = setTimeout(fn, ms); h.unref?.(); return h; });
  const disarm = deps.clearTimeout ?? ((h: unknown): void => { clearTimeout(h as ReturnType<typeof setTimeout>); });
  const settleMs = deps.settleMs ?? RESIZE_SETTLE_MS;
  // THE BURST (W2 t7), in the two pieces of state a settled screen cannot report about itself: the narrowest
  // width a NARROWING inside it landed on, and the trailing timer every signal restarts. `Infinity` is a burst
  // that only ever grew — and a grow strands nothing, because Ink erases the previous frame's LOGICAL line count,
  // which at a wider terminal is at least the rows that frame occupies.
  let narrowest = Infinity;
  // …and the frame that was on screen at that narrowing. It is half of the same sample (`SettleSample`): the
  // rows the leg stranded are rows THAT frame painted, and by settle time Ink may have replaced it with a
  // taller one (a streaming turn) whose height has nothing to do with the leg.
  let frameAtNarrowest: string | undefined;
  // …and the two remaining terms of that same sample, needed only by the settle-AT-narrowest branch below (see
  // `repairAtSettle`), which measures the leg exactly as `correctionAfterRepaint` measures a first shrink: the
  // width the frame was displayed at before this leg re-wrapped it, and the park that was on it then.
  let widthBeforeNarrowest = 0, parkedColAtNarrowest = 0;
  let settling: unknown;
  // …and the one case the window cannot answer by itself: the probe measuring THIS burst's shrink takes up to
  // 750 ms and the window is 80, so the verdict the repair needs routinely lands after it. The repair waits for
  // it rather than declining on it, and re-measures when it runs.
  let awaitingVerdict = false;
  const endBurst = (): void => { narrowest = Infinity; frameAtNarrowest = undefined; awaitingVerdict = false; };
  /** The settle pass. Returns whether it emitted, because the probe's continuation must not ALSO emit: two
   *  erase-plus-frame writes in a row each move the frame up by their own residue, so the second one's erase
   *  lands on rows the first one just declared live. */
  const repairAtSettle = (): boolean => {
    const size = deps.size(), frame = deps.lastFrame();
    if (!(narrowest <= size.columns) || frame === undefined || frameAtNarrowest === undefined) { endBurst(); return false; }
    if (verdict === undefined) { if (probing) awaitingVerdict = true; else endBurst(); return false; }
    // TWO MEASUREMENTS, ONE PER SHAPE OF BURST, and the width the drag stopped at is what tells them apart
    // (external review, finding B). A drag that walked BACK off its narrowing settles wider than it: the rows
    // it stranded have re-wrapped since, and what survives of them is the re-wrap DIFFERENCE
    // `correctionAtSettle` takes. A MONOTONIC drag — 120 → 100 → 80 — stops at `narrowest`, so nothing has
    // re-wrapped since the leg that stranded the rows and the screen is a first shrink's screen arriving late:
    // that difference is zero by construction (same frame, same width, twice) and the honest measurement is
    // `correctionAfterRepaint`'s — the remembered frame's region at the width it is STILL on, less Ink's own
    // erase. It used to be refused outright (`narrowest < size.columns`), which left both legs of every
    // monotonic burst permanent: the probe covering them is still in flight for the whole drag, and its sample
    // is abandoned the moment the second leg moves the terminal off the width it was measured at (`:191`).
    //   ONE EXCURSION EITHER WAY, which is the file's standing under-erase residual (`:176`-`:179`) and not a
    // new one: a burst with several unmeasured legs stranded more than one frame's worth, and this claims the
    // deepest — the leg `frameAtNarrowest` belongs to — leaving the shallower ones cosmetic rather than
    // summing terms measured off frames that are no longer anywhere on screen.
    const seq = narrowest < size.columns
      ? correctionAtSettle({ frame, frameAtNarrowest, parkedCol: deps.parkedColumn(), width: size.columns, narrowest, rows: size.rows }, verdict)
      : correctionAfterRepaint({ frame: frameAtNarrowest, parkedCol: parkedColAtNarrowest, oldWidth: widthBeforeNarrowest, newWidth: narrowest, rows: size.rows },
        verdict, frame, deps.parkedColumn());
    endBurst();
    if (!seq) return false;
    repaintSelf(seq);
    return true;
  };
  const onResize = (): void => {
    const oldWidth = width, size = deps.size(), newWidth = size.columns;
    width = newWidth;
    // Read BEFORE Ink has repainted (this listener is attached ahead of Ink's own — `ResizeRepaint.onResize`),
    // so this is the frame the terminal is about to re-wrap, which is what both samples below are about.
    const frame = deps.lastFrame(), parkedCol = deps.parkedColumn();
    // W2 t7 — REMEMBER THE NARROWING EVEN WHEN THE DRAG WALKS BACK OFF IT, and restart the window. Two clauses,
    // and both are refusals:
    //   · only a leg that actually NARROWED counts. A burst read as "narrower earlier than it is now" purely
    //     because it grew in steps (120 → 160 → 200) has no residue, and erasing above the frame there eats live
    //     transcript.
    //   · and only while the terminal is still UNMEASURED. The settle pass exists for residue nothing else can
    //     reach, and once a verdict is cached there is none: `frameWriteCorrection` runs synchronously inside
    //     every frame write Ink makes from here, measured against that write's own live width. Claiming a leg
    //     that was already corrected at its write is a double erase, i.e. an over-erase — so the pass only ever
    //     claims what went out unmeasured, which is exactly the burst the finding describes (the first shrink's
    //     probe is still in flight, so every leg of the drag falls through with `verdict === undefined`).
    //   · and only a leg whose frame is RECORDED. With no frame there is no measurement to take, which is the
    //     same refusal `lastFrame()` has always meant here.
    // …and a narrowing on an ALREADY-MEASURED terminal does not merely fail to be remembered, it ENDS the burst
    // (fix round 2). A burst retained across the verdict holds real residue, but this leg's own write is
    // corrected at the write, and `frameWriteCorrection`'s depth reaches above the frame it replaces by exactly
    // the rows that lie inside that retained residue — so keeping the pass alive claims them twice.
    if (newWidth < oldWidth) {
      if (verdict !== undefined) endBurst();
      else if (newWidth < narrowest && frame !== undefined) { narrowest = newWidth; frameAtNarrowest = frame; widthBeforeNarrowest = oldWidth; parkedColAtNarrowest = parkedCol; }
    }
    if (settling !== undefined) disarm(settling);
    awaitingVerdict = false;                            // the drag is still going; the NEXT settle asks again
    settling = arm(() => { settling = undefined; repairAtSettle(); }, settleMs);
    // THE MEASUREMENT IS NOT DEBOUNCED, AND CANNOT BE. `probeReflow` compares the cursor's reported column
    // against where the column it was parked in BEFORE this drag would have re-wrapped to — so it is only
    // answerable in the window between the terminal's reflow and Ink's repaint, which re-parks inside the new
    // width (and `colBefore > newWidth` then refuses every probe for the rest of the session). The window above
    // debounces the REPAIR; the probe stays on the signal, where the evidence is.
    if (frame === undefined || !(newWidth >= 2) || !(newWidth < oldWidth)) return;
    const sample: ResizeSample = { frame, parkedCol, oldWidth, newWidth, rows: size.rows };
    // WITH A VERDICT IN HAND THERE IS NOTHING TO DO HERE. Ink may write on this signal, on a later tick, or never;
    // whichever it is, that write is where the correction belongs and the corrector reads `verdict()` then.
    if (verdict !== undefined) return;
    if (probing) return;
    probing = true;
    void deps.probe({ colBefore: parkedCol, oldWidth, newWidth }).then((answer) => {
      probing = false;
      if (answer !== "unknown") {
        verdict = answer;
        // W2 t7 FIX ROUND 1 (finding 3) — AND THE BURST IS FORGOTTEN THE MOMENT THE VERDICT CACHES, UNLESS A
        // WRITE HAS ALREADY GONE OUT UNCORRECTED. From here `frameWriteCorrection` runs inside every frame
        // write Ink makes, and the FIRST write after a narrowing is measured against exactly the frame that
        // narrowing remembers — so if that write has not landed yet, the corrector is about to claim these
        // rows and the settle pass claiming them too is one erase run too many, over live transcript. A
        // SIGWINCH does not imply a write (`throttledLog` defers, the dedupe drops), so "has one landed" is
        // not inferable from the signals; the recorded frame's own identity is the observation, because the
        // proxy records one per frame write. Unchanged frame ⇒ nothing under-erased yet ⇒ forget.
        //   This subsumes the narrower guard that shipped (clear on an emitting first-shrink repair): an
        // emission implies a cached "reflow", and by then Ink has repainted the leg it repairs.
        if (deps.lastFrame() === frameAtNarrowest) endBurst();
      }
      // W2 t7 — THE BURST REPAIR WAS WAITING ON EXACTLY THIS, and it is the better-informed of the two: it
      // measures the screen as it stands now, while everything below measures a sample taken before the drag
      // finished. If it emitted, this one must not — see `repairAtSettle`. If it declined, the sample below
      // still has its own guard and may be the correction this shrink needs.
      if (awaitingVerdict) { awaitingVerdict = false; if (repairAtSettle()) return; }
      // THE VERDICT SURVIVES A LATER DRAG; THE MEASUREMENT DOES NOT. `probeReflow` waits up to 750 ms, and every
      // row count in `sample` was taken at `sample.newWidth`. If the terminal has been dragged again since, the
      // frame on screen re-wrapped to a different height and the sample's erase is measured against a width that
      // no longer exists — a shrink to 80 followed by a widen to 200 mid-flight erases 13 rows over 7 occupied,
      // i.e. six live transcript rows, the over-erase this whole correction exists to avoid. So keep the answer
      // (it describes the TERMINAL) and abandon the emission (it described a screen that is gone). The next
      // shrink takes the cached-verdict path and is corrected synchronously, with no stale sample at all.
      if (deps.size().columns !== sample.newWidth) return;
      const seq = correctionAfterRepaint(sample, answer, deps.lastFrame(), deps.parkedColumn());
      // …and when it emits, the screen above the frame is clean and the burst has nothing left to claim (W2 t7).
      // This is the branch the rule above deliberately KEEPS — Ink did repaint after the narrowing, so a real
      // residue existed — and this write is what removes it. Without this, a probe that answers WHILE the drag
      // is still running repairs the first leg here and the settle pass claims the same rows again 80 ms later.
      if (seq) { endBurst(); repaintSelf(seq); }
    });
  };
  const stop = (): void => { if (settling !== undefined) { disarm(settling); settling = undefined; } endBurst(); };
  return { onResize, stop, verdict: () => (selfWriting ? undefined : verdict) };
}
