// tui/src/streamingItems.ts — the in-flight turn's `RenderLine[]` as `RenderItem[]`, pre-wrapped to a width.
//
// WHY THIS EXISTS AT ALL. `LiveTurn.snapshot()` hands out lines wrapped at the width the turn STARTED with,
// and `<Line>` then lets Ink re-wrap them at whatever the terminal is now — which is fine for painting and
// useless for arithmetic. Every surface that has to reason about ROWS (the live window's budget, and
// Task 10's `pageItemSlices` walk over the fullscreen viewport) needs a height it can trust before Ink
// lays anything out: a line three times the region's width MUST report three rows, not one. So the wrap
// happens here, ahead of the renderer, and each physical row becomes its own one-row `kind: "line"` item —
// `renderItemHeight` is 1 for a line item, so the item count IS the row count by construction.
//
// IDS ARE SYNTHETIC AND STABLE, keyed by position (`stream:<line>`, plus `wrapItems`' own `#w<row>` suffix
// on a line that took more than one row). The streaming region is transient and is never published into
// `<Static>`, so these ids need no document identity — they only have to stay put across the re-renders of
// one turn, so React keeps its element instances instead of remounting the whole tail on every delta, and
// the SOURCE id has to survive a re-wrap so a held scroll offset can be remapped across a width change
// (`remapRowOffset`).
//
// THE WRAP ITSELF MOVED (T17 fix round) into `wrapItems`, which is now the one place the substrate turns a
// projection into painted rows — this module is the streaming region's id scheme over it. The behaviour is
// unchanged: a line that fits keeps its object, its `segments` and its styling; one that does not becomes
// one item per physical row with the gutter on the first and the continuation rows indented under the text.
import type { RenderLine } from "./render.js";
import type { RenderItem } from "./toolRenderer.js";
import { wrapItemsToWidth } from "./wrapItems.js";

/** Pre-wrap the live region to `width`, one item per physical row. */
export function streamingItems(lines: readonly RenderLine[], width: number): readonly RenderItem[] {
  return wrapItemsToWidth(lines.map((line, index) => ({ kind: "line" as const, id: `stream:${index}`, line })), width);
}
