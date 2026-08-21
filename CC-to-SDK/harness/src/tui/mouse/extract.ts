// tui/mouse/extract.ts — F9 T-MOUSE Task 5: cells → plain text, canon's `R0p` (L198893-198911) minus the
// scrolled-off-row snapshot (`Cka`) v1 does not carry (recorded divergence, spec M5). Given the per-row
// column ranges `selection.ts#selectedSpans` already computed, this is JUST the slice-and-join: no geometry,
// no clamping, no grapheme math of its own — `columnToChar` (T1) already resolved every span's edges onto
// cluster boundaries, so slicing at those exact character offsets can never cut a combining sequence or a
// surrogate pair in half. PURE — no React, no clipboard, no toast (Task 7 owns the copy channel this feeds).
import { columnToChar, type HitRow } from "./hitmap.js";
import type { RowSpan } from "./selection.js";

/** One span's highlighted text, `colStart`..`colEnd` (half-open, 1-based) resolved back to `row.text`
 *  character offsets via `columnToChar` — the SAME function `selectedSpans` used to place those columns in
 *  the first place, so a boundary that landed on a cluster's edge there lands on that identical edge here.
 *  `colEnd` is exclusive, so the last INCLUDED column is `colEnd - 1`; its cluster's `charEnd` is the slice's
 *  upper bound (or `row.text.length` if that column addresses nothing — an empty/gutter-only row, or a span
 *  already collapsed to zero width by `selectedSpans`'s own clamping). */
function sliceRow(row: HitRow, span: RowSpan): string {
  if (span.colEnd <= span.colStart) return "";
  const startHit = columnToChar(row, span.colStart);
  if (!startHit) return "";
  const endHit = columnToChar(row, span.colEnd - 1);
  return row.text.slice(startHit.charStart, endHit ? endHit.charEnd : row.text.length);
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
