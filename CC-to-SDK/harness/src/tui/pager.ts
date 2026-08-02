// tui/src/pager.ts — pure scroll reducer for the transcript pager (Ctrl-O). Bindings are the 2.1.220
// bundle's Transcript context verbatim, plus the Scroll context's pageup/pagedown. One deliberate gap
// remains (docs/parity/tui-ux.md): home/end never reach an Ink app as key flags (g/G are the
// equivalents). ctrl+e (transcript:toggleShowAll) is bound as of F1 Task 5, now that the shared
// projection has a `detail-collapsed` form to toggle against `detail-all`. "exit" is returned for
// q/escape/ctrl+c and "toggleShowAll" for ctrl+e; the component owns closing and owns the show-all state.
import type { RenderItem } from "./toolRenderer.js";

export interface PagerKey { upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean; escape?: boolean; ctrl?: boolean }
export type PagerAction = { kind: "exit" } | { kind: "top" } | { kind: "bottom" } | { kind: "lines"; n: number } | { kind: "pages"; n: number } | { kind: "toggleShowAll" };
/** One item's contribution to one page. `start`/`end` index the gutter block's BODY rows; a `line` item is
 *  always the whole (single-row) item. `showGutter` is true only for the fragment that carries the block's
 *  first visible row, so a body split across pages prints exactly one `⎿` and every continuation keeps the
 *  same five-column indent. */
export type RenderItemSlice = { item: RenderItem; start: number; end: number; showGutter: boolean };

export function pagerAction(input: string, key: PagerKey): PagerAction | null {
  if (key.escape) return { kind: "exit" };
  if (key.ctrl) {
    switch (input) {
      case "c": return { kind: "exit" };
      case "u": return { kind: "pages", n: -0.5 };
      case "d": return { kind: "pages", n: 0.5 };
      case "b": return { kind: "pages", n: -1 };
      case "f": return { kind: "pages", n: 1 };
      case "n": return { kind: "lines", n: 1 };
      case "p": return { kind: "lines", n: -1 };
      case "e": return { kind: "toggleShowAll" };
      default: return null;
    }
  }
  if (key.upArrow) return { kind: "lines", n: -1 };
  if (key.downArrow) return { kind: "lines", n: 1 };
  if (key.pageUp) return { kind: "pages", n: -1 };
  if (key.pageDown) return { kind: "pages", n: 1 };
  if (input === "q") return { kind: "exit" };
  if (input === "j") return { kind: "lines", n: 1 };
  if (input === "k") return { kind: "lines", n: -1 };
  if (input === " ") return { kind: "pages", n: 1 };
  if (input === "b") return { kind: "pages", n: -1 };
  if (input === "g") return { kind: "top" };
  if (input === "G") return { kind: "bottom" };
  return null;
}

export function clampOffset(offset: number, total: number, height: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, total - height)));
}
export function applyPager(offset: number, a: PagerAction, total: number, height: number): number {
  if (a.kind === "top") return 0;
  if (a.kind === "bottom") return Math.max(0, total - height);
  if (a.kind === "lines") return clampOffset(offset + a.n, total, height);
  if (a.kind === "pages") return clampOffset(offset + Math.round(a.n * height), total, height);
  return offset;
}

/** Scrolling is by PHYSICAL row, never by item: a tool result's body has already been wrapped to visual rows
 *  at `columns - 10` by the projection, so a gutter block is exactly `body.length` rows tall and a 40-row
 *  result can be paged through without the window jumping over it. */
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
