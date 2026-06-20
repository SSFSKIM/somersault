// tui/src/markdown.ts — pure markdown → RenderLine[]. Lightweight: the cases assistant replies actually use.
// Whole-line inline styles only (bold/italic/inline-code); a line that MIXES styles has its markers stripped
// and renders as clean text with no per-span color (each RenderLine carries one style set — the accepted limit).
import type { RenderLine } from "./render.js";

const HEADER = /^#{1,6}\s+(.*)$/;          // # .. ###### header → bold, # stripped
const BULLET = /^[-*+]\s+(.*)$/;           // - * + bullet → "• "
const NUMBERED = /^(\d+)\.\s+(.*)$/;       // "1. " numbered → keep number
const QUOTE = /^>\s?(.*)$/;                // > blockquote → dim, "│ "
const BOLD = /^(?:\*\*(.+)\*\*|__(.+)__)$/; // entire line bold
const ITALIC = /^(?:\*(.+)\*|_(.+)_)$/;     // entire line italic
const CODE = /^`(.+)`$/;                    // entire line inline code

// Strip inline markers from a mixed-style line (no per-span color is possible in one RenderLine).
function stripInline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
          .replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

export function renderMarkdown(text: string): RenderLine[] {
  const out: RenderLine[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (/^```/.test(raw)) { inFence = !inFence; continue; }            // drop fence lines, toggle state
    if (inFence) { out.push({ text: "  " + raw, dim: true }); continue; } // code body: dim + indented
    let m: RegExpMatchArray | null;
    if ((m = raw.match(HEADER))) { out.push({ text: m[1], bold: true }); continue; }
    if ((m = raw.match(QUOTE))) { out.push({ text: "│ " + stripInline(m[1]), dim: true }); continue; }
    if ((m = raw.match(BULLET))) { out.push({ text: "• " + stripInline(m[1]) }); continue; }
    if ((m = raw.match(NUMBERED))) { out.push({ text: `${m[1]}. ${stripInline(m[2])}` }); continue; }
    if ((m = raw.match(BOLD))) { out.push({ text: m[1] ?? m[2], bold: true }); continue; }
    if ((m = raw.match(ITALIC))) { out.push({ text: m[1] ?? m[2], italic: true }); continue; }
    if ((m = raw.match(CODE))) { out.push({ text: m[1], color: "cyan" }); continue; }
    out.push({ text: stripInline(raw) });                              // plain / mixed-inline: markers stripped
  }
  return out;
}
