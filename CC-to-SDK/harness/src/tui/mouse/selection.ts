// tui/mouse/selection.ts — F9 T-MOUSE Task 5: the pure drag-selection state machine plus the query that
// turns it into per-row column ranges, ported from canon's `g0p`/`Eka`/`y0p`/`b0p`/`T0p`/`R0p` (R1 §2.4) with
// the tree canon walks (`SAa`'s `selectionScope`) replaced by the region-bounds v1 scope the spec records as
// a divergence: every row this module ever sees IS the region (Task 6 hands it the SAME `HitRow[]` window it
// paints), so "clamp to the row" already IS "clamp to the scope." PURE — no React, no paint, no key handling
// (those are Tasks 6-7); its only import is `hitmap.ts`'s two column-addressing functions, reused rather than
// re-derived so a click landing on a wide cell's trailing half, a combining mark, or a gutter column resolves
// EXACTLY as `columnToChar`/`charToColumn` already define it for every other mouse feature in this track.
import { columnToChar, charToColumn, type HitRow } from "./hitmap.js";

/** A terminal cell — 1-based row AND column, like every consumer in this track (T1's `col`, T2's decoded
 *  events, T3/T4's `anchorAt`/`hoverAt`). `row` here is an index into the `rows: HitRow[]` array THIS module
 *  is handed (1 → `rows[0]`), not an absolute screen row: translating a motion report's screen row into that
 *  array position needs the frame's `top` origin, which only the gesture-wiring layer (Task 6) has — keeping
 *  it out of this module is what keeps `selectedSpans` a pure query over "the rows I was given," matching
 *  `FullscreenViewport.hitRowsOf`'s own array, nothing about where on the physical screen it started. */
export interface Cell {
  row: number;
  col: number;
}

/** Canon's `g0p()` state (L198549), stripped of the fields the layout tree owned (`scope`,
 *  `scrolledOffAbove/Below*`, `virtualAnchor/FocusRow/Col`) since v1's region-bounds scope and "no
 *  scrolled-off capture" (both recorded divergences, spec M5) make them dead weight here — a v2 that adds
 *  scroll-through-drag capture would resurrect them, but nothing in this track's acceptance needs them now.
 *    `anchorSpan` is the multi-click product (`b0p`): once set it OVERRIDES `anchor`/`focus` entirely in
 *  `selectedSpans` (a double/triple click IS a selection, no drag required — `hasSelection` must answer
 *  `true` off a click alone). `focus === null` is not "unset," it is canon's own click/sweep discriminant:
 *  a plain press leaves it `null` forever; `dragTo` only ever writes a REAL sweep into it. */
export interface SelectionState {
  anchor: Cell | null;
  focus: Cell | null;
  isDragging: boolean;
  anchorSpan: { lo: Cell; hi: Cell; kind: "word" | "line" } | null;
}

/** A fresh, empty machine — no selection, no press in flight. Convenience for callers (Task 6's gesture
 *  wiring, this file's own tests) that would otherwise repeat the same four-field literal at every mount. */
export function createSelectionState(): SelectionState {
  return { anchor: null, focus: null, isDragging: false, anchorSpan: null };
}

/** Canon's `Eka(sel, col, row, scope)` (L198550) — a fresh press. Resets EVERYTHING, including a stale
 *  `anchorSpan` from a previous multi-click: a new plain press always starts a plain (not word/line) sweep
 *  until `multiClick` says otherwise again. */
export function startSelection(state: SelectionState, cell: Cell): void {
  state.anchor = cell;
  state.focus = null;
  state.isDragging = true;
  state.anchorSpan = null;
}

/** Canon's `y0p` (L198553): record the drag's current cell as `focus` — EXCEPT when it lands back on the
 *  anchor's own cell, canon's documented nicety (R1 §2.4) that keeps a press-then-release-on-the-same-cell a
 *  plain click rather than a zero-width selection. Un-recording (not merely skipping the write) matters just
 *  as much: a sweep that drags away and back to the anchor before release must ALSO read back as "no
 *  selection," which only happens if landing on the anchor clears whatever `focus` a prior drag step wrote. */
export function dragTo(state: SelectionState, cell: Cell): void {
  state.focus = state.anchor && cellsEqual(cell, state.anchor) ? null : cell;
}

function cellsEqual(a: Cell, b: Cell): boolean {
  return a.row === b.row && a.col === b.col;
}

/** `false` for no press yet, or a plain click that never moved (`hasSelection` — brief's own naming); `true`
 *  the moment EITHER a real sweep exists (`focus` non-null — `dragTo` only ever writes a genuinely different
 *  cell there) OR a multi-click already produced a word/line span, drag or no drag. */
export function hasSelection(state: SelectionState): boolean {
  return state.anchorSpan !== null || (state.anchor !== null && state.focus !== null);
}

/** Canon's word-select char class, verbatim (`tfS`, L198741, plan's Global Constraints): a letter, digit,
 *  underscore, or one of the path/URL-ish punctuation marks canon folds into "word" so `foo_bar/baz` and a
 *  file path both select as one token. Tested against a SINGLE cluster's leading codepoint at a time (below),
 *  never the whole row — `classOf` classifies one grapheme, `wordSpan`'s walk is what turns a run of
 *  same-class clusters into a span. */
const WORD_CHAR = /[\p{L}\p{N}_/.\-+~\\]/u;

/** Canon's three-way `Lii` classification (L198578) of the grapheme cluster starting at `text`'s codepoint
 *  index `charStart`: `0` whitespace, `1` a `WORD_CHAR`, `2` anything else (punctuation canon does NOT fold
 *  into a word — brackets, quotes, `#`, …). Classifying by the cluster's OWN leading codepoint is enough: a
 *  combining mark or the trailing half of a surrogate pair never starts a cluster (grapheme boundaries, not
 *  codepoint ones, are what `columnToChar` already walks), so `charStart` always lands on a real base char. */
function classOf(text: string, charStart: number): 0 | 1 | 2 {
  const ch = String.fromCodePoint(text.codePointAt(charStart)!);
  if (/\s/u.test(ch)) return 0;
  return WORD_CHAR.test(ch) ? 1 : 2;
}

/** Canon's `_0p` outward walk (L198598ff), reimplemented one CLUSTER at a time via `columnToChar`/
 *  `charToColumn` rather than a fresh grapheme walker: each step re-resolves the next/previous column through
 *  `columnToChar`, which is already wide-cell- and combining-mark-safe (T1's own backstep), so this never
 *  needs to know a cluster's byte width itself — it just asks "what's one column further, and is it the same
 *  class." Hyperlink-aware (canon L198615-198617): if the click's own cluster falls inside a `linkRanges`
 *  span, the WHOLE link is the word — checked first, before the char-class walk ever runs, exactly as canon's
 *  `_0p` tries `v0p` (the OSC-8 span lookup) before falling back to the class walk. */
function wordSpan(cell: Cell, row: HitRow): { lo: Cell; hi: Cell; kind: "word" } | null {
  const hit = columnToChar(row, cell.col);
  if (!hit) return null; // clicked the gutter or past the painted text — nothing to select
  const link = row.linkRanges?.find((l) => hit.charStart >= l.start && hit.charStart < l.end);
  if (link) return { lo: { row: cell.row, col: charToColumn(row, link.start) }, hi: { row: cell.row, col: charToColumn(row, link.end) }, kind: "word" };

  const cls = classOf(row.text, hit.charStart);
  let loCol = charToColumn(row, hit.charStart);
  for (let probe = loCol - 1; probe > row.gutterWidth; ) {
    const prev = columnToChar(row, probe);
    if (!prev || classOf(row.text, prev.charStart) !== cls) break;
    loCol = charToColumn(row, prev.charStart);
    probe = loCol - 1;
  }
  let hiCol = charToColumn(row, hit.charEnd); // one column past the click's own cluster
  for (;;) {
    const next = columnToChar(row, hiCol);
    if (!next || classOf(row.text, next.charStart) !== cls) break;
    hiCol = charToColumn(row, next.charEnd);
  }
  return { lo: { row: cell.row, col: loCol }, hi: { row: cell.row, col: hiCol }, kind: "word" };
}

/** Canon's `T0p` (L198775): triple-click selects the FULL logical line, not just the physical row under the
 *  pointer. `multiClick` only ever sees the ONE row that was clicked (no `rows` array — this function is a
 *  leaf, it has no idea whether the row above or below is a soft-wrap sibling), so it can only stake out that
 *  one row's own full width here; `selectedSpans` (below), which DOES get the whole `rows` array, is what
 *  walks outward through `softWrap === "continuation"` neighbours to find the rest of the logical line — the
 *  `kind: "line"` tag is the signal that tells it to do so rather than trust `lo`/`hi` literally. */
function lineSpan(cell: Cell, row: HitRow): { lo: Cell; hi: Cell; kind: "line" } {
  return { lo: { row: cell.row, col: row.gutterWidth + 1 }, hi: { row: cell.row, col: row.width + 1 }, kind: "line" };
}

/** Canon's `handleMultiClick` → `b0p` (L203446-203456 / L198643-198650): a double (`count===2`, word) or
 *  triple (`count===3`, line) click sets `anchorSpan` directly — no drag required for `hasSelection` to read
 *  `true`, matching canon's own click-not-sweep multi-click. Takes the CLICKED row itself (not the whole
 *  array): a leaf function only ever needs its own row's text, gutter, and link data to answer "what word (or
 *  line-pending) span starts here" — the multi-row expansion `kind: "line"` triggers lives entirely in
 *  `selectedSpans`, the one function in this file that receives the full window. */
export function multiClick(state: SelectionState, cell: Cell, count: 2 | 3, row: HitRow): void {
  state.anchor = cell;
  state.focus = null;
  state.anchorSpan = count === 3 ? lineSpan(cell, row) : wordSpan(cell, row);
}

/** Per-row highlighted COLUMN range — `colStart` inclusive, `colEnd` exclusive, both 1-based terminal
 *  columns, mirroring `CellAddress`'s own half-open `charStart`/`charEnd` convention (T1) rather than
 *  inventing a second one. `row` is the SAME 1-based index into the `rows` array `Cell.row` already uses. */
export interface RowSpan {
  row: number;
  colStart: number;
  colEnd: number;
}

function orderCells(a: Cell, b: Cell): [Cell, Cell] {
  if (a.row !== b.row) return a.row < b.row ? [a, b] : [b, a];
  return a.col <= b.col ? [a, b] : [b, a];
}

/** A raw terminal column resolved to the FULL [start, end) column range of the grapheme cluster it lands on —
 *  the one primitive both a selection's leading and trailing edge need: the leading edge snaps BACK to the
 *  cluster's own start column (a click on a wide char's trailing half must not amputate it), the trailing
 *  edge snaps FORWARD to the cluster's end (so the boundary sits cleanly after the whole cluster, never
 *  mid-way through one) — exactly the "grapheme-snapped via T1 hitmap helpers" the brief asks for, and it is
 *  what makes a CJK/emoji/combining-mark selection un-splittable regardless of which edge `col` belongs to.
 *  `col` is clamped to `[gutterWidth+1, width]` first — the v1 "region bounds" scope (spec M5): this module
 *  has no `selectionScope` tree to walk, so the row it was handed already IS the whole scope. An empty or
 *  all-gutter row (no addressable column at all) answers a zero-width range at the gutter boundary. */
function snappedColumnRange(row: HitRow, col: number): { start: number; end: number } {
  const clamped = Math.max(row.gutterWidth + 1, Math.min(col, row.width));
  const hit = columnToChar(row, clamped);
  if (!hit) return { start: row.gutterWidth + 1, end: row.gutterWidth + 1 };
  return { start: charToColumn(row, hit.charStart), end: charToColumn(row, hit.charEnd) };
}

/** Every row's FULL painted extent past the gutter — canon's `T0p`/line-group rows and the untouched middle
 *  rows of a multi-row drag both want "the whole row," and neither needs grapheme snapping to get it: a
 *  row's own bounds are already whole cells by construction, nothing to backstep off of. */
function fullRowSpan(rowIndex: number, row: HitRow): RowSpan {
  return { row: rowIndex, colStart: row.gutterWidth + 1, colEnd: row.width + 1 };
}

/** `kind: "line"` expansion — canon's `T0p` walking the screen's soft-wrap array to find a logical line's
 *  full row group (R1 §2.4's `Tka`/`Hii` machinery, read here off `HitRow.softWrap` instead of a screen
 *  buffer): starting at the clicked row, walk UP while the row above is a `"continuation"` (so triple-clicking
 *  a WRAPPED row still finds its own hard-break start), then walk DOWN while the next row is a
 *  `"continuation"` of the row we are already inside. Every row in the resulting contiguous group gets its
 *  full width — this is how "triple-click takes both wrap rows" is satisfied without `multiClick` itself ever
 *  seeing more than the one row it was clicked on. */
function lineGroupSpans(clickRow: number, rows: readonly HitRow[]): RowSpan[] {
  let start = clickRow - 1; // 0-based
  while (start > 0 && rows[start]?.softWrap === "continuation") start--;
  let end = clickRow - 1;
  while (end + 1 < rows.length && rows[end + 1]?.softWrap === "continuation") end++;
  const spans: RowSpan[] = [];
  for (let i = start; i <= end; i++) {
    const row = rows[i];
    if (row) spans.push(fullRowSpan(i + 1, row));
  }
  return spans;
}

/** Canon's `x0p`/`R0p` geometry (L198930-198947 / L198893-198911), minus the per-cell `noSelect` mask (no
 *  ccx row opts out yet — nothing in this track needs one) and minus scrolled-off capture (recorded
 *  divergence, spec M5: v1 clamps to the rows it was handed, canon's `Cka` snapshot of rows that scrolled out
 *  mid-drag has no ccx equivalent). Three cases, in priority order:
 *    1. `anchorSpan` set (a multi-click happened) — `kind: "word"` is already a single-row `lo`/`hi` in
 *       terminal columns (no re-snapping needed, `wordSpan` built it through the very same helpers this
 *       function uses); `kind: "line"` re-derives the row GROUP via `lineGroupSpans` since `multiClick` could
 *       only stake out its own one row.
 *    2. No `focus` (or no `anchor`) — nothing dragged past a plain click: no span, matching `hasSelection`.
 *    3. An ordinary two-endpoint drag — `lo`/`hi` ordered by row then column, boundary rows get a
 *       grapheme-snapped PARTIAL range on the anchor/focus side, every row strictly between gets its full
 *       width, and a single-row drag naturally collapses cases 1(start)/1(end) below into ONE partial span. */
export function selectedSpans(state: SelectionState, rows: readonly HitRow[]): RowSpan[] {
  if (state.anchorSpan) {
    const { lo, hi, kind } = state.anchorSpan;
    if (kind === "line") return lineGroupSpans(lo.row, rows);
    return [{ row: lo.row, colStart: lo.col, colEnd: hi.col }];
  }
  if (!state.anchor || !state.focus) return [];

  const [lo, hi] = orderCells(state.anchor, state.focus);
  const loRow = Math.max(1, lo.row);
  const hiRow = Math.min(rows.length, hi.row);
  const spans: RowSpan[] = [];
  for (let r = loRow; r <= hiRow; r++) {
    const row = rows[r - 1];
    if (!row) continue;
    if (r === lo.row && r === hi.row) {
      const start = snappedColumnRange(row, lo.col).start;
      const end = snappedColumnRange(row, hi.col).end;
      spans.push({ row: r, colStart: start, colEnd: Math.max(start, end) });
    } else if (r === lo.row) {
      spans.push({ row: r, colStart: snappedColumnRange(row, lo.col).start, colEnd: row.width + 1 });
    } else if (r === hi.row) {
      spans.push({ row: r, colStart: row.gutterWidth + 1, colEnd: snappedColumnRange(row, hi.col).end });
    } else {
      spans.push(fullRowSpan(r, row));
    }
  }
  return spans;
}
