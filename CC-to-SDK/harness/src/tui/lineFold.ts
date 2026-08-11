// tui/src/lineFold.ts — the one place `Segment[]` becomes a `RenderLine` (F4). Extracted from
// markdown.ts at Task 4 so mdTable.ts can fold its own rows without importing markdown.ts (which
// imports mdTable.ts — a runtime cycle). Type-only imports of render.ts keep this leaf-free.
import type { RenderLine, Segment } from "./render.js";

const STYLE_KEYS = ["color", "dim", "bold", "italic", "strikethrough", "underline", "bg", "preStyled"] as const;
/** Two segments render identically iff their style keys match — the fold/merge equality. */
export const styleKey = (s: Segment): string => STYLE_KEYS.map((k) => String(s[k] ?? "")).join(" ");

export const lineAsSegment = (l: RenderLine): Segment => { const { text, color, dim, bold, italic, strikethrough, underline, bg } = l; return { text, ...(color && { color }), ...(dim && { dim }), ...(bold && { bold }), ...(italic && { italic }), ...(strikethrough && { strikethrough }), ...(underline && { underline }), ...(bg && { bg }) }; };

/** One line's segments → a RenderLine. A line whose segments all share ONE style folds into a bare/single-
 *  styled line (matching the old renderer's `inlineLine` folding, so downstream consumers and their tests
 *  keep seeing the simple shape); a mixed line carries `segments` with `text` as the plain fallback. */
export function foldLine(segs: Segment[]): RenderLine {
  const kept = segs.filter((s) => s.text !== "");
  if (kept.length === 0) return { text: "" };
  const text = kept.map((s) => s.text).join("");
  const k = styleKey(kept[0]);
  if (kept.every((s) => styleKey(s) === k)) {
    const { color, dim, bold, italic, strikethrough, underline, bg } = kept[0];
    return { text, ...(color && { color }), ...(dim && { dim }), ...(bold && { bold }), ...(italic && { italic }), ...(strikethrough && { strikethrough }), ...(underline && { underline }), ...(bg && { bg }) };
  }
  return { text, segments: kept };
}
