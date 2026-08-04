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
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { renderMarkdown } from "./markdown.js";
import { resolveThemeColor, themeTokens } from "./theme.js";

/** Prepend `pad` to a line's leading text — to BOTH the plain fallback and the first segment (if any). */
function indentLine(l: RenderLine, pad: string): RenderLine {
  if (l.segments && l.segments.length) return { ...l, text: pad + l.text, segments: [{ ...l.segments[0], text: pad + l.segments[0].text }, ...l.segments.slice(1)] };
  return { ...l, text: pad + l.text };
}

/** CC's assistant-message identity, F4 Task 8 — two corrections to F1's guess, both from the pack §7:
 *  1. THE GLYPH IS PER-PLATFORM. `Za = Pt() === "macos" ? "⏺" : "●"` (bundle L41484). In THIS bundle `Pt()`
 *     is `Vr(() => { try { return "macos" } catch { … } })` (L18015–18021) — the platform check is already
 *     constant-folded, so the artifact we read only ever paints `⏺`. That makes the bundle evidence for the
 *     PRODUCT's rule, not for a runtime branch: the darwin build folds to `⏺`, other builds to `●`. The
 *     product-level port is the switch, and `platform` reaches here from `renderMessage`'s options, which
 *     `projectMessageEntry` already fills from `ProjectionOptions` — the same seam the tool bullets read.
 *  2. THE BULLET IS NOT THE ACCENT. `VAr`'s gutter is `<Text aria-label="claude:" color="text">{Za}</Text>`
 *     (L422851) — the ordinary foreground token. F1's ACCENT bullet was an invention and dies here.
 *  The token is resolved PER CALL (never captured at module scope) so a /theme switch — the picker's live
 *  preview included — repaints on the very next render. Continuation indent is unchanged: upstream's body is
 *  a sibling column of a `minWidth: 2` gutter box, so a wrapped line aligns under the text, not the glyph. */
export function withAssistantBullet(lines: RenderLine[], platform: NodeJS.Platform = process.platform): RenderLine[] {
  if (lines.length === 0) return lines;
  const gutter: Gutter = { text: platform === "darwin" ? "⏺ " : "● ", color: resolveThemeColor(themeTokens().text) };
  return lines.map((l, i) => (i === 0 ? { ...l, gutter } : indentLine(l, "  ")));
}

// ── The user prompt echo (pack §7.3–7.6) ───────────────────────────────────────────────────────────────
// Upstream `Mqo` (L426143–426181) wraps `xqo` (L426067–426082) in a Box carrying
// `backgroundColor: "userMessageBackground"` + `paddingRight: 1`; `xqo` is a ROW of a `flexShrink: 0` gutter
// box holding `[Ge.pointer, " "]` in `subtle` and a COLUMN holding the text in `text`. Flattened onto our
// RenderLine substrate that is: a full-width band `width - 1` wide, the pointer on row 0 only, every later
// row indented two columns under it. The band rides `Segment.bg` rather than `RenderLine.bg` because a
// `Gutter` has no bg field (Task 1) and the gutter cell must be banded too — same shape Task 7's diff rows use.
const USER_GUTTER = "❯ ";        // `Ge.pointer` (L104968) + the literal " " of `[Ge.pointer, " "]`
const RULE_CHAR = "─";           // `qK` (L41482) — `Sg`'s default `char`
const FOLD_THRESHOLD = 10_000;   // `tWp = 1e4`  (L426183)
const FOLD_HEAD = 2500;          // `Rqo = 2500` (L426183)
const FOLD_TAIL = 2500;          // `rWp = 2500` (L426183)
/** `jjp = 3 + (paddingWidth ?? 0)` (L426067), the `padding` `dEn` hands `Sg` — which SHRINKS the rule
 *  (`dys = width - padding`) rather than indenting it. 3 = the 2-column gutter plus upstream's paddingRight,
 *  which is exactly our `width - 1 - USER_GUTTER.length`. A QUEUED echo's `paddingWidth` is 4 (§7.7), and
 *  ChatApp reproduces that by handing us a width already narrowed by its `paddingX: 2` box — same `dys`. */
const RULE_INSET = 3;
/** Upstream `au(e, t, r)` (L15190): occurrences of `\n` in `s` at or after `from`. */
const newlines = (s: string, from = 0): number => { let n = 0; for (let i = s.indexOf("\n", from); i !== -1; i = s.indexOf("\n", i + 1)) n++; return n; };
/** Ink's `wrap` mode, the same call `diffRender` makes. `hard` keeps an unbroken token inside the band. */
const wrapRows = (text: string, width: number): string[] => wrapAnsi(text, width, { trim: false, hard: true }).split("\n");

/** THE single prompt-echo renderer: the live echo (useChat), the replayed one (replay.ts + `renderMessage`'s
 *  user branch) and the queued one (ChatApp) all come through here, because upstream has exactly one prompt
 *  component and three surfaces that hand-rolled their own `› ` is precisely how they drift.
 *
 *  `width` is the FULL column budget of the band (the terminal width, or — for a queued echo — the width
 *  left inside its `paddingX: 2` box); every row is padded out to `width - 1` because upstream's band Box
 *  carries `paddingRight: 1`. An empty prompt renders nothing at all: `Mqo` bails with `return null` on
 *  falsy text (L426169), and a bare band with no content in it would be a row claiming a turn that isn't there. */
export function userEchoLines(text: string, opts: { width?: number } = {}): RenderLine[] {
  if (text === "") return [];
  const width = Math.max(USER_GUTTER.length + 2, Math.floor(opts.width ?? 80));
  const tokens = themeTokens();
  const band = resolveThemeColor(tokens.userMessageBackground), fg = resolveThemeColor(tokens.text), subtle = resolveThemeColor(tokens.subtle);
  const inner = width - 1, content = Math.max(1, inner - USER_GUTTER.length);
  const row = (lead: string, leadColor: string, body: string, bodyColor: string): RenderLine => {
    const tail = body + " ".repeat(Math.max(0, inner - stringWidth(lead) - stringWidth(body)));
    return { text: lead + tail, bg: band, segments: [{ text: lead, color: leadColor, bg: band }, { text: tail, color: bodyColor, bg: band }] };
  };
  const blank = " ".repeat(USER_GUTTER.length);
  const bodyRows = (t: string): string[] => t.split("\n").flatMap((line) => wrapRows(line, content));
  // `dEn` (L426084): `(N line[s] hidden)` in `subtle`, `titleAlign: "start"` → up to FOUR leading dashes
  // (`Math.min(4, gap)`), the rest trailing, the whole rule `dys = width - padding` columns wide. The DASHES
  // are not dim — `Sg`'s `dimColor` is `!color` (L183981) and `dEn` passes one — but the TITLE span is:
  // L183972 nests it in its own `<Text dimColor={true}>` inside the subtle rule (t8 review Minor 1).
  const ruleRow = (hidden: number): RenderLine => {
    const title = `(${hidden} ${hidden === 1 ? "line" : "lines"} hidden)`;
    const span = Math.max(0, width - RULE_INSET), gap = Math.max(0, span - (stringWidth(title) + 2));
    const lead = Math.min(4, gap);
    const head = RULE_CHAR.repeat(lead) + " ", trail = " " + RULE_CHAR.repeat(gap - lead);
    const pad = " ".repeat(Math.max(0, inner - USER_GUTTER.length - stringWidth(head + title + trail)));
    return { text: blank + head + title + trail + pad, bg: band, segments: [
      { text: blank, color: fg, bg: band },
      { text: head, color: subtle, bg: band },
      { text: title, color: subtle, dim: true, bg: band },
      { text: trail + pad, color: subtle, bg: band },
    ] };
  };
  // The fold (L426143–426167): head = first 2 500 chars, tail = LAST 2 500 chars, and `hiddenLines` is the
  // newline count from char 2 500 onward MINUS the tail's own — i.e. the lines that fall in the dropped
  // middle. The head/rule/tail all live inside the one text column, so only the head's first row is gutted.
  const pieces = text.length > FOLD_THRESHOLD
    ? (() => { const tail = text.slice(-FOLD_TAIL); return { rows: [...bodyRows(text.slice(0, FOLD_HEAD)), null, ...bodyRows(tail)], hidden: newlines(text, FOLD_HEAD) - newlines(tail) }; })()
    : { rows: bodyRows(text) as (string | null)[], hidden: 0 };
  return pieces.rows.map((piece, index) => (piece === null ? ruleRow(pieces.hidden) : row(index === 0 ? USER_GUTTER : blank, index === 0 ? subtle : fg, piece, fg)));
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
 *  change only this file. Omitting the bag falls back to 80 columns, the HOST's own `process.platform` and
 *  thinking on — the width default is `renderMarkdown`'s, the platform default is the honest answer for a
 *  caller that has no projection to thread one from (liveTurn takes an explicit one; see its constructor). */
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
      if (b?.type === "text" && b.text) out.push(...withAssistantBullet(renderMarkdown(String(b.text), { width: opts.width }), opts.platform));
      else if (b?.type === "thinking" && b.thinking) for (const l of String(b.thinking).split("\n")) out.push({ text: l, dim: true });
    }
    return out;
  }
  if (m.type === "user") {
    // Task 10a routes sentinels before this path: an interrupt/local-command sentinel is engine bookkeeping
    // wearing a user frame, not a prompt, and must never be band-wrapped as one.
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) out.push(...userEchoLines(String(b.text), { width: opts.width }));
    }
    return out;
  }
  return [];
}
