// tui/src/graphemes.ts — the ONE grapheme-cluster snapper, extracted out of suggestPopup.tsx (T-X4T's own
// `BIh`, bundle L536337–536357) so a SECOND consumer (F9 T-MOUSE's hit map, `mouse/hitmap.ts`) can widen a
// range to a cluster boundary without importing a popup component for it. Zero behaviour change at the
// original call site: `suggestPopup.tsx`'s `matchRanges` now imports this instead of defining it, and its own
// test suite is the regression cover — this file adds none of its own, deliberately, since duplicating that
// coverage here would test the same four lines twice while the real risk (a THIRD caller reading it wrong) is
// what the shared home exists to prevent.
//
// Widens each `[start, end)` half-open char-index range out to the nearest grapheme-cluster boundary, so a
// caller can never cut a combining sequence or a multi-codepoint emoji in half. `NON_LATIN1` mirrors
// upstream's `DSw` (`/[^ -˿]/`, L536524, i.e. anything outside U+0020–U+02FF): text made entirely of that
// range is exactly what upstream trusts index === grapheme boundary for, and the `Intl.Segmenter` pass is
// skipped outright — the common case (plain command names, English descriptions, ASCII transcript rows) never
// pays for it.
const NON_LATIN1 = /[^ -˿]/;
export function snapToGraphemes(text: string, ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0 || !NON_LATIN1.test(text)) return ranges;
  const boundaries = new Set<number>();
  for (const { index } of new Intl.Segmenter().segment(text)) boundaries.add(index);
  const snapped: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    let s = start; while (s > 0 && !boundaries.has(s)) s--;         // widen the start back to a cluster boundary
    let e = end; while (e < text.length && !boundaries.has(e)) e++; // widen the end forward to a cluster boundary
    const last = snapped[snapped.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);       // widening made two ranges touch → merge
    else snapped.push([s, e]);
  }
  return snapped;
}
