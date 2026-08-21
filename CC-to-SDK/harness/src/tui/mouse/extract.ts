// tui/mouse/extract.ts — F9 T-MOUSE Task 5: cells → plain text, canon's `R0p` (L198893-198911) minus the
// scrolled-off-row snapshot (`Cka`) v1 does not carry (recorded divergence, spec M5). Given the per-row
// column ranges `selection.ts#selectedSpans` already computed, this is JUST the slice-and-join: no geometry,
// no clamping, no grapheme math of its own — `columnToChar` (T1) already resolved every span's edges onto
// cluster boundaries, so slicing at those exact character offsets can never cut a combining sequence or a
// surrogate pair in half. PURE — no React, no clipboard, no toast (Task 7 owns the copy channel this feeds).
import { columnToChar, type HitRow } from "./hitmap.js";
import type { RowSpan } from "./selection.js";

/** One span's highlighted text, `colStart`..`colEnd` (half-open, 1-based) resolved back to `row.text`
 *  CHARACTER offsets via `columnToChar` — the SAME function `selectedSpans` used to place those columns in
 *  the first place, so a boundary that landed on a cluster's edge there lands on that identical edge here.
 *  `colEnd` is exclusive, so the last INCLUDED column is `colEnd - 1`; its cluster's `charEnd` is the range's
 *  upper bound (or `row.text.length` if that column addresses nothing — an empty/gutter-only row, or a span
 *  already collapsed to zero width by `selectedSpans`'s own clamping). `null` for a zero-width/unresolvable
 *  span, never `{charStart: charEnd}` — a caller (F9 T-MOUSE Task 6's paint path, below) can tell "nothing
 *  here" from "an empty range at column N" without a second comparison.
 *
 *  EXPORTED for Task 6's paint path (`FullscreenViewport.tsx`): the same terminal-column → character-offset
 *  translation this file's own `sliceRow` needs for copy is EXACTLY what the paint path needs to turn a
 *  `RowSpan` into the char range `Line.tsx` splits a row's text on — one function, not two independent
 *  re-derivations of the same grapheme-snapped arithmetic. */
export function charRangeOf(row: HitRow, span: RowSpan): { charStart: number; charEnd: number } | null {
  if (span.colEnd <= span.colStart) return null;
  const startHit = columnToChar(row, span.colStart);
  if (!startHit) return null;
  const endHit = columnToChar(row, span.colEnd - 1);
  return { charStart: startHit.charStart, charEnd: endHit ? endHit.charEnd : row.text.length };
}

function sliceRow(row: HitRow, span: RowSpan): string {
  const range = charRangeOf(row, span);
  return range ? row.text.slice(range.charStart, range.charEnd) : "";
}

/** Canon's soft-wrap-aware join (`Tka`/`Hii`, L198542): a `"continuation"` row is the TAIL of the same
 *  logical line as the row before it, so it joins with NOTHING — no space, no newline, exactly as the
 *  original unwrapped text read before `wrapItems.ts` ever broke it across rows. A `"hard"` row starts a NEW
 *  logical line, so it joins with `"\n"`, reproducing the real line break canon's own `HardBreak` case
 *  copies. The first span in the list never gets a separator regardless of its own `softWrap` value — there
 *  is nothing before it to join to. */
export function extractText(spans: readonly RowSpan[], rows: readonly HitRow[]): string {
  let out = "";
  spans.forEach((span, i) => {
    const row = rows[span.row - 1];
    if (!row) return;
    const text = sliceRow(row, span);
    out += i === 0 ? text : (row.softWrap === "continuation" ? "" : "\n") + text;
  });
  return out;
}
