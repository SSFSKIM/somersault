// tui/src/render.ts — pure, UI-agnostic rich formatter: one SDK message → renderable lines (data, not ink).
// A line may carry an optional `gutter`: a leading styled marker (the CC `●` bullet / `⎿` connector) the
// <Line> view renders as its own <Text> so the glyph keeps its own color independent of the line's text style.
// A line is EITHER single-styled (`text` + the style fields) OR carries `segments` for per-span inline
// styling (mixed bold/italic/code in one line); when `segments` is present the <Line> view renders those
// and `text` is the plain fallback. `gutter` is a leading styled marker (the CC `●` bullet / `⎿` connector).
// `strikethrough`/`underline`/`bg` (F4 Task 1) are the substrate the rest of F4 builds on: markdown `~~…~~`
// and `<u>…</u>` (Task 3) set the first two, the diff background bands (Task 7) set `bg`. `bg` is a color in
// the same §2.2 TH2 grammar as `color` and is resolved by the <Line> view, not by its producers.
export interface RenderLine { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; bg?: string; gutter?: Gutter; segments?: Segment[]; }
// `italic` on the gutter: the `∴` thinking gutter (pack §8.3, Task 9) is dim+italic while its line is not.
export interface Gutter { text: string; color?: string; dim?: boolean; italic?: boolean; }
// `preStyled` (F3 Task 1, the bold-count mechanism of spec Decision Log 2026-08-04): the segment's `text`
// is ALREADY a raw-SGR byte string and the <Line> view must render it through an UNSTYLED <Text> — no
// color/dim/bold/italic/strikethrough/underline/bg props. F1 proved `<Text dimColor bold>` never emits `\x1b[1m` (bold is dropped) and
// that chalk REWRITES a raw `\x1b[22m` nested inside a styled <Text> into `\x1b[2m` (a plain tail comes out
// dim). Passthrough is the only way to put bold inside a dim run. Style fields are ignored when set.
export interface Segment { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; bg?: string; preStyled?: true; }
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

// F4 Task 7 RETIRED `toolDiffLines`. It was F1's hand-rolled Edit/Write diff — a `● Name path` head, a
// prefix/suffix hunk numbered 1-based off the snippet, and a 24-row cap with a `… N more lines` note. Every
// part of that is now wrong: the header belongs to `diffRender.diffHeader` (upstream `fbn`), the body to
// `diffRender.renderDiff` (upstream `K3e`/`H2p`/`chH`), line numbers come off Task 6's patch ladder, and
// upstream caps a diff at nothing. It had no production caller left — the "reused by liveTurn" note above it
// was stale — so this is a deletion, not a migration.

/** The renderer's per-call context (F4 Task 5). `width` is the terminal column count the markdown walker
 *  fits width-sensitive blocks (tables) to; `platform` selects the bullet glyph (Task 8) and `showThinking`
 *  decides whether a `thinking` block draws at all (Task 9). All three are THREADED from the projection now
 *  — `projectMessageEntry` forwards `columns`/`platform`/`projection`+`verbose` — so the two later tasks
 *  change only this file. Omitting the bag keeps the pre-F4 defaults (80 columns, current glyph, thinking on). */
export interface RenderMessageOptions { width?: number; platform?: NodeJS.Platform; showThinking?: boolean }

/** Map one SDK message to renderable lines — the NON-TOOL species only. `tool_use`/`tool_result` blocks are
 *  deliberately absent since F1 Task 4: every tool row goes through `renderToolEvent` instead, so there is
 *  exactly ONE tool grammar and no hand-rolled `⎿` gutter survives outside `TOOL_RESULT_GUTTER`.
 *  Unknown/empty/result/system → []. */
export function renderMessage(m: any, opts: RenderMessageOptions = {}): RenderLine[] {
  if (!m || typeof m !== "object") return [];
  if (m.type === "assistant") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) out.push(...withAssistantBullet(renderMarkdown(String(b.text), { width: opts.width })));
      else if (b?.type === "thinking" && b.thinking) for (const l of String(b.thinking).split("\n")) out.push({ text: l, dim: true });
    }
    return out;
  }
  if (m.type === "user") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) out.push({ text: `› ${l}`, dim: true });
    }
    return out;
  }
  return [];
}
