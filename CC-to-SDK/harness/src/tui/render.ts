// tui/src/render.ts — pure, UI-agnostic rich formatter: one SDK message → renderable lines (data, not ink).
// A line may carry an optional `gutter`: a leading styled marker (the CC `●` bullet / `⎿` connector) the
// <Line> view renders as its own <Text> so the glyph keeps its own color independent of the line's text style.
// A line is EITHER single-styled (`text` + the style fields) OR carries `segments` for per-span inline
// styling (mixed bold/italic/code in one line); when `segments` is present the <Line> view renders those
// and `text` is the plain fallback. `gutter` is a leading styled marker (the CC `●` bullet / `⎿` connector).
export interface RenderLine { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; gutter?: Gutter; segments?: Segment[]; }
export interface Gutter { text: string; color?: string; dim?: boolean; }
export interface Segment { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; }
import { renderMarkdown } from "./markdown.js";
import { ACCENT } from "./theme.js";

/** Prepend `pad` to a line's leading text — to BOTH the plain fallback and the first segment (if any). */
function indentLine(l: RenderLine, pad: string): RenderLine {
  if (l.segments && l.segments.length) return { ...l, text: pad + l.text, segments: [{ ...l.segments[0], text: pad + l.segments[0].text }, ...l.segments.slice(1)] };
  return { ...l, text: pad + l.text };
}

/** CC's assistant-message identity: an accent `●` bullet on the first line, continuation lines indented to
 *  align under the text. Each line keeps its own markdown style; only the bullet carries the accent color. */
export function withAssistantBullet(lines: RenderLine[]): RenderLine[] {
  if (lines.length === 0) return lines;
  return lines.map((l, i) => (i === 0 ? { ...l, gutter: { text: "● ", color: ACCENT } } : indentLine(l, "  ")));
}

export const trunc = (s: string, n = 48): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const firstArg = (input: Record<string, unknown>): string => {
  const v = Object.values(input ?? {})[0];
  return v === undefined ? "" : trunc(typeof v === "string" ? v : JSON.stringify(v));
};
const path = (input: Record<string, unknown>) => String(input.file_path ?? input.path ?? "");

/** The salient argument of a tool, used by the live one-line tool marker and the diff header. */
export function toolTarget(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") return trunc(String(input.command ?? ""), 80);
  if (name === "Edit" || name === "Write" || name === "Read") return path(input);
  return firstArg(input);
}

/** CC's bullet form for a tool-invocation row: `● Name(target)`, gutter-separated so the glyph styles
 *  independently of the text (matching the assistant bullet's gutter convention). */
function toolUseLines(name: string, input: Record<string, unknown>): RenderLine[] {
  return [{ text: `${name}(${toolTarget(name, input)})`, gutter: { text: "● " } }];
}

/** Truncation-aware Edit/Write diff: ● header + a real hunk body + a "… N more lines" note. Reused by liveTurn
 *  (which slices index 0 — the head — off, pairing its own status glyph with this body; that contract is unchanged).
 *  When both old_string/new_string are given (Edit) the body is a hunk: a common prefix/suffix between the two
 *  becomes dim numbered context (≤3 lines each side), the differing middle becomes numbered -/+ rows. Numbering is
 *  1-based and relative to the old_string/new_string snippet — we never read the file, so absolute line numbers
 *  are not available. Write (content only, no old_string) keeps the flat all-+ body. */
export function toolDiffLines(name: string, input: Record<string, unknown>, cap = 24): RenderLine[] {
  const head: RenderLine = { text: `${name} ${path(input)}`, gutter: { text: "● " } };
  const body: RenderLine[] = [];
  const oldS = typeof input.old_string === "string" ? input.old_string : undefined;
  const newS = typeof input.new_string === "string" ? input.new_string : typeof input.content === "string" ? input.content : undefined;
  if (oldS !== undefined && newS !== undefined) {
    const o = oldS.split("\n"), n = newS.split("\n");
    let pre = 0; while (pre < o.length && pre < n.length && o[pre] === n[pre]) pre++;
    // Bounded by (length − pre) on BOTH sides so the suffix scan can never walk back past the prefix — this
    // is what keeps old_string === new_string (or a strict prefix/suffix relationship) from producing negative
    // ranges below (e.g. `o.length - suf` going below `pre`).
    let suf = 0; while (suf < o.length - pre && suf < n.length - pre && o[o.length - 1 - suf] === n[n.length - 1 - suf]) suf++;
    const num = (i: number) => String(i + 1).padStart(3);
    const CTX = 3;
    for (let i = Math.max(0, pre - CTX); i < pre; i++) body.push({ text: `${num(i)}  ${o[i]}`, dim: true });
    for (let i = pre; i < o.length - suf; i++) body.push({ text: `${num(i)} - ${o[i]}`, color: "red" });
    for (let i = pre; i < n.length - suf; i++) body.push({ text: `${num(i)} + ${n[i]}`, color: "green" });
    for (let i = o.length - suf; i < Math.min(o.length, o.length - suf + CTX); i++) body.push({ text: `${num(i)}  ${o[i]}`, dim: true });
  } else if (newS !== undefined) {
    for (const l of newS.split("\n")) body.push({ text: `  + ${l}`, color: "green" });
  }
  if (body.length <= cap) return [head, ...body];
  return [head, ...body.slice(0, cap), { text: `  … ${body.length - cap} more lines`, dim: true }];
}

/** A failed tool_result reads as a failure: red, with a ✗ on its first line only (the tool_result block carries
 *  only `is_error` — no exit code is available — so error framing keys on that boolean alone). */
function resultLines(content: unknown, isError?: boolean): RenderLine[] {
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";
  if (!text.trim()) return [];
  return text.split("\n").slice(0, 12).map((l, i) => isError
    ? { text: `  ⎿ ${i === 0 ? "✗ " : ""}${trunc(l, 100)}`, color: "red" }
    : { text: `  ⎿ ${trunc(l, 100)}`, dim: true });
}

/** Map one SDK message to renderable lines. Unknown/empty/result/system → []. */
export function renderMessage(m: any): RenderLine[] {
  if (!m || typeof m !== "object") return [];
  if (m.type === "assistant") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) out.push(...withAssistantBullet(renderMarkdown(String(b.text))));
      else if (b?.type === "thinking" && b.thinking) for (const l of String(b.thinking).split("\n")) out.push({ text: l, dim: true });
      else if (b?.type === "tool_use") out.push(...(b.name === "Edit" || b.name === "Write" ? toolDiffLines(b.name, b.input ?? {}) : toolUseLines(b.name, b.input ?? {})));
    }
    return out;
  }
  if (m.type === "user") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) out.push({ text: `› ${l}`, dim: true });
      else if (b?.type === "tool_result") out.push(...resultLines(b.content, b.is_error === true));
    }
    return out;
  }
  return [];
}
