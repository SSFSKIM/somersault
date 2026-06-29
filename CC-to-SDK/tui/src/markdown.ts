// tui/src/markdown.ts — pure markdown → RenderLine[]. Lightweight: the cases assistant replies actually use.
// Inline styles (bold/italic/inline-code) are parsed per-span: a line with a SINGLE style folds into the line
// (whole-line bold/italic/code); a line MIXING styles carries `segments` (the <Line> view renders each span).
import type { RenderLine, Segment } from "./render.js";

const HEADER = /^#{1,6}\s+(.*)$/;          // # .. ###### header → bold, # stripped
const BULLET = /^[-*+]\s+(.*)$/;           // - * + bullet → "• "
const NUMBERED = /^(\d+)\.\s+(.*)$/;       // "1. " numbered → keep number
const QUOTE = /^>\s?(.*)$/;                // > blockquote → dim, "│ "
// one inline span: **bold** / __bold__ / *italic* / _italic_ / `code`
const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;

// Strip inline markers from a line (used where per-span color isn't applied — headers, quotes).
function stripInline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
          .replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

/** Split a line into styled segments (plain runs + bold/italic/code spans). */
function parseInline(text: string): Segment[] {
  const segs: Segment[] = []; let last = 0; let m: RegExpExecArray | null;
  const re = new RegExp(INLINE);   // own lastIndex
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index) });
    if (m[1] != null || m[2] != null) segs.push({ text: m[1] ?? m[2], bold: true });
    else if (m[3] != null || m[4] != null) segs.push({ text: m[3] ?? m[4], italic: true });
    else if (m[5] != null) segs.push({ text: m[5], color: "cyan" });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs;
}

/** Build a line from an optional plain `prefix` (the `• `/`N. ` marker) + inline-parsed `content`.
 *  All-plain → a bare line; one styled span → fold the style into the line; mixed → carry `segments`. */
function inlineLine(prefix: string, content: string): RenderLine {
  const all: Segment[] = prefix ? [{ text: prefix }, ...parseInline(content)] : parseInline(content);
  if (all.length === 0) return { text: "" };
  if (all.every((s) => !s.bold && !s.italic && !s.color)) return { text: all.map((s) => s.text).join("") };
  if (all.length === 1) { const s = all[0]; return { text: s.text, ...(s.bold && { bold: true }), ...(s.italic && { italic: true }), ...(s.color && { color: s.color }) }; }
  return { text: all.map((s) => s.text).join(""), segments: all };
}

export function renderMarkdown(text: string): RenderLine[] {
  const out: RenderLine[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (/^```/.test(raw)) { inFence = !inFence; continue; }            // drop fence lines, toggle state
    if (inFence) { out.push({ text: "  " + raw, dim: true }); continue; } // code body: dim + indented
    let m: RegExpMatchArray | null;
    if ((m = raw.match(HEADER))) { out.push({ text: stripInline(m[1]), bold: true }); continue; }
    if ((m = raw.match(QUOTE))) { out.push({ text: "│ " + stripInline(m[1]), dim: true }); continue; }
    if ((m = raw.match(BULLET))) { out.push(inlineLine("• ", m[1])); continue; }
    if ((m = raw.match(NUMBERED))) { out.push(inlineLine(`${m[1]}. `, m[2])); continue; }
    out.push(inlineLine("", raw));                                     // plain / mixed-inline → segments
  }
  return out;
}
