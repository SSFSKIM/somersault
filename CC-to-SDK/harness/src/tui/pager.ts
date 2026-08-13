// tui/src/pager.ts — pure scroll reducer for the transcript pager (Ctrl-O).
//
// F2 task 7: this module no longer knows about KEYS. Which key scrolls the pager is the binding table's
// business (keys/bindings.ts, the `Transcript` context — the 2.1.220 bundle's own context, plus the Scroll
// context's pageup/pagedown and, new here, home/end: our byte parser can name them, which Ink's `useInput`
// never could, so the g/G-only gap recorded in docs/parity/tui-ux.md is closed). What survives is what an
// ACTION MEANS, as `PAGER_ACTIONS` — the one map the resolver's action names are reduced through. Exit
// (q/escape/ctrl+c/ctrl+o) and toggleShowAll (ctrl+e) are not here at all: the component owns closing and
// owns the show-all state, and both are plain action handlers on it.
import type { RenderItem } from "./toolRenderer.js";

export type PagerAction = { kind: "top" } | { kind: "bottom" } | { kind: "lines"; n: number } | { kind: "pages"; n: number };
/** One item's contribution to one page. `start`/`end` index the gutter block's BODY rows; a `line` item is
 *  always the whole (single-row) item. `showGutter` is true only for the fragment that carries the block's
 *  first visible row, so a body split across pages prints exactly one `⎿` and every continuation keeps the
 *  same five-column indent. */
export type RenderItemSlice = { item: RenderItem; start: number; end: number; showGutter: boolean };

/** Every `scroll:*` action the Transcript context binds, as the operation it performs. Null-prototype so a
 *  lookup by an arbitrary action name can never hit `Object.prototype` (the t2 spec-table rule). Pinned
 *  against the binding table by pager.test.ts: an action bound with no entry here would be a dead key. */
export const PAGER_ACTIONS: Record<string, PagerAction> = Object.assign(Object.create(null), {
  "scroll:halfPageUp": { kind: "pages", n: -0.5 }, "scroll:halfPageDown": { kind: "pages", n: 0.5 },
  "scroll:fullPageUp": { kind: "pages", n: -1 }, "scroll:fullPageDown": { kind: "pages", n: 1 },
  "scroll:pageUp": { kind: "pages", n: -1 }, "scroll:pageDown": { kind: "pages", n: 1 },
  "scroll:lineUp": { kind: "lines", n: -1 }, "scroll:lineDown": { kind: "lines", n: 1 },
  "scroll:top": { kind: "top" }, "scroll:bottom": { kind: "bottom" },
});

export function clampOffset(offset: number, total: number, height: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, total - height)));
}
/** How far a `pages` move travels: FLOOR ON THE MAGNITUDE, floored at one row.
 *
 *  It was `Math.round(a.n * height)`, and that is wrong twice over on a fractional page. `Math.round` is
 *  round-HALF-UP, not round-half-away-from-zero — `round(18.5)` is 19 while `round(-18.5)` is −18 — so on
 *  every ODD height a half page down travelled one row further than a half page up and the pair did not
 *  return the reader to the row they started on. Worse at height 1: `round(-0.5)` is `-0`, so the up key
 *  moved nothing at all and a one-row window could only ever scroll one way.
 *  Taking the floor of the ABSOLUTE value and re-applying the sign makes the two directions the same
 *  distance by construction, and the `max(1, …)` floor keeps a fractional page from rounding away to a dead
 *  key in a window too short to halve. Integer pages are untouched (`floor(1 * h) === h`), so `fullPage*`
 *  and `page*` behave exactly as they did; the only actions that move are the half-page pair, on odd
 *  heights, by one row — in the direction that makes them reversible. */
function pageDelta(n: number, height: number): number {
  return Math.sign(n) * Math.max(1, Math.floor(Math.abs(n) * height));
}
export function applyPager(offset: number, a: PagerAction, total: number, height: number): number {
  if (a.kind === "top") return 0;
  if (a.kind === "bottom") return Math.max(0, total - height);
  if (a.kind === "lines") return clampOffset(offset + a.n, total, height);
  return clampOffset(offset + pageDelta(a.n, height), total, height);
}

/** Scrolling is by PHYSICAL row, never by item: a tool result's body has already been wrapped to visual rows
 *  at `columns - 10` by the projection, so a gutter block is exactly `body.length` rows tall and a 40-row
 *  result can be paged through without the window jumping over it.
 *    AND THE ONE FOR A LINE IS TRUE ONLY OF A PROJECTION ALREADY WRAPPED TO THE PAINT WIDTH (T17 fix round).
 *  Ink re-wraps anything wider than its box, so an over-wide line paints two rows and is counted here as one
 *  — which is a windowing surface's most expensive kind of error, since the rows it loses are the newest
 *  ones. This function stays width-unaware on purpose; the caller owes it painted rows, and `wrapItems`
 *  (`wrapItemsToWidth`) is how every caller gets them. */
export function renderItemHeight(item: RenderItem): number { return item.kind === "line" ? 1 : item.body.length; }

/** The window `[offset, offset+rows)` over those physical rows, expressed as per-item slices. The returned
 *  `offset` is the clamped one the caller should render/label with, and `total` is the physical-row count. */
export function pageItemSlices(items: readonly RenderItem[], offset: number, rows: number): { slices: readonly RenderItemSlice[]; offset: number; total: number } {
  let total = 0; for (const item of items) total += renderItemHeight(item);
  const off = clampOffset(offset, total, rows), limit = off + rows, slices: RenderItemSlice[] = [];
  let cursor = 0;
  for (const item of items) {
    const height = renderItemHeight(item), itemEnd = cursor + height;
    // A zero-height item (an empty body) occupies no row, so it can never be part of a window.
    if (height > 0 && itemEnd > off && cursor < limit) {
      const start = Math.max(0, off - cursor);
      slices.push({ item, start, end: Math.min(height, limit - cursor), showGutter: start === 0 });
    }
    cursor = itemEnd;
  }
  return { slices, offset: off, total };
}
