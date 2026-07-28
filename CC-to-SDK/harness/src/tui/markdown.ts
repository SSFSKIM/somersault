// tui/src/markdown.ts — pure markdown → RenderLine[]. Lightweight: the cases assistant replies actually use.
// Inline styles (bold/italic/inline-code) are parsed per-span: a line with a SINGLE style folds into the line
// (whole-line bold/italic/code); a line MIXING styles carries `segments` (the <Line> view renders each span).
import type { RenderLine, Segment } from "./render.js";
import { highlightCode, KNOWN_LANGS } from "./highlight.js";

const HEADER = /^#{1,6}\s+(.*)$/;          // # .. ###### header → bold, # stripped
const BULLET = /^[-*+]\s+(.*)$/;           // - * + bullet → "• "
const NUMBERED = /^(\d+)\.\s+(.*)$/;       // "1. " numbered → keep number
const QUOTE = /^>\s?(.*)$/;                // > blockquote → dim, "│ "
const FENCE = /^```(\w+)?/;                // ``` or ```lang → toggle fence, capture the language
const TABLE_SEP = /^\s*\|?[\s:-]+\|/;      // a table's 2nd line: "|---|---|" (dashes/colons, not prose)
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

/** One non-fence, non-table line → its RenderLine (header/quote/bullet/numbered/plain). Shared by the
 *  main loop and by a table buffer that turned out NOT to be a table (re-emitted through the normal path). */
function plainLine(raw: string): RenderLine {
  let m: RegExpMatchArray | null;
  if ((m = raw.match(HEADER))) return { text: stripInline(m[1]), bold: true };
  if ((m = raw.match(QUOTE))) return { text: "│ " + stripInline(m[1]), dim: true };
  if ((m = raw.match(BULLET))) return inlineLine("• ", m[1]);
  if ((m = raw.match(NUMBERED))) return inlineLine(`${m[1]}. `, m[2]);
  return inlineLine("", raw);                                          // plain / mixed-inline → segments
}

/** "| a | b |" → ["a","b"] — split on "|", trim each cell, drop the empty edge cells a leading/trailing
 *  pipe produces. */
function splitCells(line: string): string[] {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** A buffered run of consecutive `|`-lines: emit as a table if it's ≥2 rows with a `|---|` 2nd line
 *  (header + separator + data rows, right-padded to each column's widest cell); otherwise these were
 *  never a table (e.g. one lone prose line with a `|`, or two prose lines that both happen to contain
 *  one) — re-emit the raw lines through the normal single-line path untouched. */
function flushTableBuffer(buf: string[]): RenderLine[] {
  if (buf.length < 2 || !TABLE_SEP.test(buf[1])) return buf.map(plainLine);
  const header = splitCells(buf[0]);
  const rows = buf.slice(2).map(splitCells);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const padRow = (cells: string[]) => cells.map((c, i) => (c ?? "").padEnd(widths[i])).join(" │ ");
  const headerText = padRow(header);
  const out: RenderLine[] = [{ text: headerText, bold: true }, { text: "─".repeat(headerText.length), dim: true }];
  for (const r of rows) out.push({ text: padRow(r) });
  return out;
}

export function renderMarkdown(text: string): RenderLine[] {
  const out: RenderLine[] = [];
  let inFence = false;
  let fenceLang: string | undefined;
  let tableBuf: string[] = [];
  const flushTable = () => { if (tableBuf.length) { out.push(...flushTableBuffer(tableBuf)); tableBuf = []; } };
  for (const raw of text.split("\n")) {
    let m: RegExpMatchArray | null;
    if ((m = raw.match(FENCE))) { flushTable(); inFence = !inFence; fenceLang = inFence ? m[1] : undefined; continue; }
    if (inFence) {
      if (fenceLang && KNOWN_LANGS.has(fenceLang)) out.push({ text: "  " + raw, segments: [{ text: "  " }, ...highlightCode(raw, fenceLang)] });
      else out.push({ text: "  " + raw, dim: true });
      continue;
    }
    if (raw.includes("|")) { tableBuf.push(raw); continue; }            // buffer — decided once the run ends
    flushTable();
    out.push(plainLine(raw));
  }
  flushTable();
  return out;
}
