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
// IDS ARE SYNTHETIC AND STABLE, keyed by position (`stream:<line>:<row>`). The streaming region is
// transient and is never published into `<Static>`, so these ids need no document identity — they only
// have to stay put across the re-renders of one turn, so React keeps its element instances instead of
// remounting the whole tail on every delta.
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import type { RenderLine } from "./render.js";
import type { RenderItem } from "./toolRenderer.js";

/** The same wrap call the rest of the substrate makes (`render.ts`'s `wrapRows`, `species.ts`'s `wrapBody`):
 *  `hard` so an unbreakable token is cut rather than allowed to overflow the width we just promised. */
const wrapRows = (text: string, width: number): string[] => text.split("\n").flatMap((line) => wrapAnsi(line, width, { trim: false, hard: true }).split("\n"));

/** Pre-wrap the live region to `width`, one item per physical row.
 *
 *  THE GUTTER IS THE ONLY WIDTH SUBTLETY. `<Line>` renders a line's gutter (`⏺ ` / `∴ `) as a leading
 *  `<Text>` inside the same wrapping `<Text>`, so the row it starts is that many columns narrower — the
 *  identical discipline `species.ts` applies with its own inset. The gutter stays on the FIRST row of the
 *  line it came from (a continuation row wearing a second bullet would be a new message on screen) and the
 *  rows below it are indented under the text, which is what `withAssistantBullet` already does to the
 *  continuation lines it produces. A plain line simply wraps at the full width.
 *
 *  RECORDED LIMITATION: a line that carries `segments` (inline markdown styling) keeps them only while it
 *  fits the width in one row. Re-wrapping re-cuts the text at boundaries the segment list knows nothing
 *  about, so a wrapped segmented line falls back to `RenderLine.text` — the plain fallback the substrate
 *  documents for exactly this case — plus the line's own style fields. In steady state this never fires:
 *  `LiveTurn` renders markdown at the live width, so its lines already fit. It fires between a resize and
 *  the next delta, where honest heights matter more than inline emphasis. */
export function streamingItems(lines: readonly RenderLine[], width: number): readonly RenderItem[] {
  const items: RenderItem[] = [];
  const full = Math.max(1, Math.floor(width));
  lines.forEach((line, index) => {
    const gutterWidth = line.gutter ? stringWidth(line.gutter.text) : 0;
    const inner = Math.max(1, full - gutterWidth);
    const rows = wrapRows(line.text, inner);
    // One row, unchanged: the ONLY path that preserves `segments`, and the one every settled frame takes.
    if (rows.length === 1 && rows[0] === line.text) { items.push({ kind: "line", id: `stream:${index}:0`, line }); return; }
    const { segments: _segments, gutter, ...style } = line;
    const pad = " ".repeat(gutterWidth);
    for (const [row, text] of rows.entries())
      items.push({ kind: "line", id: `stream:${index}:${row}`, line: { ...style, text: row === 0 ? text : pad + text, ...(row === 0 && gutter ? { gutter } : {}) } });
  });
  return items;
}
