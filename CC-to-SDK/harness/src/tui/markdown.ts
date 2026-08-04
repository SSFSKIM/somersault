// tui/src/markdown.ts — markdown → RenderLine[] through a `marked` TOKEN WALKER (F4 Task 2; replaces the
// old line-oriented regex renderer). The shape is a transcription of the bundle's `f2` node switch
// (constants pack §1, bundle L420590–420711): each case appends styled RUNS whose text may embed `\n`
// exactly where upstream glues one in (paragraph → content + "\n"; heading → content + "\n\n"; space/br →
// "\n"; hr → the literal "---" with NO newline), and a final `runsToLines()` splits that stream into lines.
// Upstream's blank-line structure therefore falls out of the walk instead of being reconstructed.
//
// Top level mirrors `Oaa` (census §Q2, L421134–421157): tokens split three ways — each `table` and each
// `blockquote` is its own chunk, and every MAXIMAL RUN of the remaining tokens is ONE chunk glued through
// the walker. `gap: 1` (upstream's <Box gap={1}>) is one blank line at CHUNK boundaries only; the blank
// lines between paragraphs inside a chunk come from `space` tokens, nothing else.
import { marked } from "marked";
import type { Token, Tokens } from "marked";
import type { RenderLine, Segment } from "./render.js";
import { inlineSegments, type InlineStyle } from "./markdownInline.js";
import { foldLine, lineAsSegment } from "./lineFold.js";
import { renderTable } from "./mdTable.js";
import { highlightCode, KNOWN_LANGS, UPSTREAM_LANGS } from "./highlight.js";

export interface MarkdownOptions { width?: number; dim?: boolean }

/** A run is a segment whose text may contain `\n`s — the newline positions ARE the block grammar. */
type Run = Segment & { text: string };

// ── depth numbering: `JhH`/`KhH`/`XhH`/`YhH` (pack §1.6, L420810–420838) ────────────────────────────
/** `KhH` — bijective base-26 lowercase (1→a, 26→z, 27→aa); the `n--` before the modulo is what makes it
 *  bijective rather than plain base-26. */
function letters(n: number): string { let t = ""; while (n > 0) { n--; t = String.fromCharCode(97 + (n % 26)) + t; n = Math.floor(n / 26); } return t; }
/** `YhH` — the roman value table, lowercase, greedy descending. */
const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
/** `XhH` — subtractive roman numerals. */
function roman(n: number): string { let t = ""; for (const [v, s] of ROMAN) while (n >= v) { t += s; n -= v; } return t; }
/** `JhH(depth, n)` — depth 0/1 → arabic, 2 → letters, 3 → roman, 4+ → arabic again (the `default`).
 *  The depth `JhH` receives is the CHILD's, offset ONE from the indent depth: `case "list"` (L420647) passes
 *  its own `n` to each item, `list_item` renders its children at `listDepth: n + 1` (L420650) while indenting
 *  with `"  ".repeat(n)` (L420653), and the marker `JhH(n, o)` is computed inside the text CHILD (L420665),
 *  whose `n` is already incremented. So indent level k takes the marker style of k+1: a top-level item
 *  numbers `1.`, its child `a.`, the grandchild `i.`, the great-grandchild `1.` again. */
function ordinal(depth: number, n: number): string {
  switch (depth) { case 0: case 1: return String(n); case 2: return letters(n); case 3: return roman(n); default: return String(n); }
}

// ── fast path + lexer LRU (pack §2, `WBp` L421105 / `hgH` L421280 / `mgH` L421269) ──────────────────
/** `hgH` VERBATIM. Only the first 500 chars are probed — a document whose only markdown appears after
 *  char 500 is deliberately (upstream-faithfully) rendered as one plain paragraph. */
const FAST_PATH = /[#*`|[>\-_~]|\n\n|(?:^|\n) {0,3}\d+\. |https?:\/\/|www\./;
const LRU_MAX = 500;                                   // `mgH = 500` entries
const LEXED = new Map<string, Token[]>();              // plain Map, delete-then-set for recency

function lex(text: string): Token[] {
  if (!FAST_PATH.test(text.length > 500 ? text.slice(0, 500) : text))
    return [{ type: "paragraph", raw: text, text, tokens: [{ type: "text", raw: text, text }] } as unknown as Token];
  const hit = LEXED.get(text);
  if (hit) { LEXED.delete(text); LEXED.set(text, hit); return hit; }        // recency bump
  const toks = marked.lexer(text) as Token[];
  if (LEXED.size >= LRU_MAX) { const oldest = LEXED.keys().next().value; if (oldest !== undefined) LEXED.delete(oldest); }
  LEXED.set(text, toks);
  return toks;
}

// ── the run walker ──────────────────────────────────────────────────────────────────────────────────
interface Ctx { style: InlineStyle; width: number }

const NL = "\n";                                        // `aW` (pack §1.1)

/** marked 18 emits a `space` token after a heading where the bundle's heading regex (L161565) swallowed those
 *  newlines into the heading's own raw; keeping both would double every post-heading blank, so the token is
 *  dropped — the heading case already carries upstream's `aW + aW`. Upstream has no such token at ANY depth,
 *  so this runs over every token list we walk: top level, blockquote children, list-item children. */
const dropPostHeadingSpace = (all: Token[]): Token[] =>
  all.filter((t, i) => !(t.type === "space" && all[i - 1]?.type === "heading"));

function styled(ctx: Ctx, text: string, extra?: Partial<Segment>): Run { return { ...ctx.style, ...extra, text }; }

/** `code` (pack §5, L420597–420602) VERBATIM in shape: `f + body + aW`, where `f` is the label.
 *  FLUSH-LEFT — nothing is prepended to a body line — and no border, no line numbers, no length cap, no
 *  horizontal truncation anywhere in this case.
 *  Language resolution is full `lang` → its `/^[\w.+#-]+/` prefix → `"plaintext"`; hljs leaves plaintext
 *  unscoped, so an unresolved body renders PLAIN (not dim — that was the pre-Task-3 house form).
 *  LABEL POLARITY `f = u && !s?.supportsLanguage(u) ? vt.dim(u) + aW : ""`: a dim line carrying the RAW
 *  lang string sits above the block exactly when `lang` is non-empty and the FULL string is unrecognised.
 *  The test is on `u`, not the prefix `d` — so ```ts title=x is BOTH labelled `ts title=x` AND highlighted
 *  as ts, and a recognised bare ```ts gets no label at all.
 *  TWO DIFFERENT QUESTIONS, two different sets. `supportsLanguage` answers off hljs's WHOLE registry, so the
 *  label is decided by `UPSTREAM_LANGS` (383 names+aliases lifted from the bundle; see highlight.ts) —
 *  ```rust draws no label upstream even though nothing here can colour rust. What we can actually colour is
 *  `KNOWN_LANGS`, and that alone decides highlighted-vs-plain body. Both lookups take the LOWERCASED lang
 *  (`sre` L419379 opens with `e.toLowerCase()`), while the label TEXT stays the raw `u` upstream prints.
 *  NOT PORTED (pack §5's correction): with highlighting globally off (`!s`) upstream labels EVERY tagged
 *  fence, because `s?.supportsLanguage` short-circuits to undefined. We ship no `syntaxHighlightingDisabled`
 *  setting, so that mode is unreachable here; recorded in the parity doc. */
function codeRuns(t: Tokens.Code, ctx: Ctx, out: Run[]): void {
  const lang = t.lang ?? "", lower = lang.toLowerCase();
  const prefix = lower.match(/^[\w.+#-]+/)?.[0] ?? "";
  const resolved = KNOWN_LANGS.has(lower) ? lower : KNOWN_LANGS.has(prefix) ? prefix : "";   // "" is upstream's "plaintext"
  if (lang !== "" && !UPSTREAM_LANGS.has(lower)) { out.push(styled(ctx, lang, { dim: true })); out.push(styled(ctx, NL)); }
  for (const line of t.text.split(NL)) {
    if (resolved !== "") for (const s of highlightCode(line, resolved)) out.push({ ...ctx.style, ...s });
    else out.push(styled(ctx, line));
    out.push(styled(ctx, NL));
  }
}

/** `blockquote` (pack §3.1, L420593–420596 — and §3.2/§3.3, which give the top-level `Naa` path the SAME
 *  dim `▎` + one space rail and italic content, so both levels share this code). The rail goes on lines
 *  whose content is non-blank only; blank lines inside a quote keep no rail. */
function quoteRuns(t: Tokens.Blockquote, ctx: Ctx, out: Run[]): void {
  const inner: Run[] = [];
  for (const child of dropPostHeadingSpace(t.tokens ?? [])) blockRuns(child, ctx, inner);
  for (const line of runsToLines(inner)) {
    if (line.text.trim() === "") { out.push(styled(ctx, NL)); continue; }
    out.push(styled(ctx, "▎ ", { dim: true }));
    for (const s of line.segments ?? [lineAsSegment(line)]) out.push({ ...s, text: s.text, italic: true });
    out.push(styled(ctx, NL));
  }
}

/** `table` — `f2`'s OWN table case (pack §4.9, L420669–420697), reachable only for a table NESTED inside
 *  another block: `Oaa` (L421143) routes every TOP-LEVEL table to the box engine instead (see
 *  `renderMarkdown` below), so this is the plain pipe form and nothing here is terminal-width aware.
 *  Facts that differ from the box: minimum column width is the literal `3` (L420683, not `_Hn`); the
 *  header takes `align?.[y]` with NO forced centering; the separator is ASCII `-` with no colons, so
 *  alignment is not encoded in it even though `bWo` honours it in the cells; no row cap; and the row is
 *  `trimEnd()`ed AFTER a `" | "` suffix, which strips the trailing space and LEAVES the closing `|`
 *  attached. The case ends on `m + aW` — a second newline past the last row's own. */
function nestedTableRuns(t: Tokens.Table, ctx: Ctx, out: Run[]): void {
  const segsOf = (c: Tokens.TableCell | undefined) => inlineSegments(c?.tokens ?? [], ctx.style);
  const widthOf = (c: Tokens.TableCell | undefined) => segsOf(c).map((s) => s.text).join("").replace(/\x1b\]8;;[^\x07]*\x07|\x1b\[[0-9;]*m/g, "").length;
  const colW = t.header.map((h, i) => Math.max(t.rows.reduce((m, r) => Math.max(m, widthOf(r[i])), widthOf(h)), 3));
  const row = (cells: Tokens.TableCell[]) => {
    out.push(styled(ctx, "| "));
    cells.forEach((c, i) => {
      const o = Math.max(0, colW[i] - widthOf(c)), align = t.align?.[i];
      const lead = align === "center" ? Math.floor(o / 2) : align === "right" ? o : 0;
      out.push(styled(ctx, " ".repeat(lead)));
      for (const s of segsOf(c)) out.push(s as Run);
      out.push(styled(ctx, `${" ".repeat(o - lead)} | `));
    });
    out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.trimEnd() };   // `m = m.trimEnd()`
    out.push(styled(ctx, NL));
  };
  row(t.header);
  out.push(styled(ctx, `|${colW.map((w) => "-".repeat(w + 2)).join("|")}|${NL}`));
  for (const r of t.rows) row(r);
  out.push(styled(ctx, NL));                            // the case's closing `+ aW`
}

/** `list` → items (pack §1.4, L420646–420647); the ordered seed honours markdown `start`. */
function listRuns(t: Tokens.List, depth: number, ctx: Ctx, out: Run[]): void {
  const start = Number(t.start === "" || t.start === undefined ? 1 : t.start);
  t.items.forEach((item, i) => itemRuns(item, depth, t.ordered ? start + i : null, ctx, out));
}

/** `list_item` (pack §1.4/§1.5, L420648–420668): the marker + `[x] `/`[ ] ` checkbox ride on the item's
 *  FIRST content child, and children are indented `"  ".repeat(depth)` EXCEPT code/blockquote/hr/table.
 *  marked 18 splits the task marker into its own `checkbox` token, where the bundle's older marked left it
 *  implicit (`i.task && i.tokens?.[0] === e`); we skip that token and synthesize the same literal text from
 *  `item.task`/`item.checked`, which reproduces upstream's output under the newer token shape. */
function itemRuns(item: Tokens.ListItem, depth: number, num: number | null, ctx: Ctx, out: Run[]): void {
  const indent = "  ".repeat(depth);
  const marker = num === null ? "-" : `${ordinal(depth + 1, num)}.`;   // L420665: the marker's depth is the CHILD's
  let first = true;
  for (const child of dropPostHeadingSpace(item.tokens ?? [])) {
    if ((child as { type: string }).type === "checkbox") continue;
    if (child.type === "list") { listRuns(child as Tokens.List, depth + 1, ctx, out); continue; }
    if (child.type === "text" || child.type === "paragraph") {
      // A loose list gives marked 18 `paragraph` children where the bundle's marked gave `text` ones; both
      // carry the item's prose, so both take the marker — otherwise a blank-line-separated list loses every
      // bullet.
      const box = first && item.task ? (item.checked ? "[x] " : "[ ] ") : "";
      out.push(styled(ctx, first ? `${indent}${marker} ${box}` : indent));
      for (const s of inlineSegments((child as Tokens.Text | Tokens.Paragraph).tokens ?? [], ctx.style)) out.push(s as Run);
      out.push(styled(ctx, NL));
      first = false; continue;
    }
    blockRuns(child, ctx, out);                          // code/blockquote/hr/table: never indented
  }
}

function blockRuns(t: Token, ctx: Ctx, out: Run[]): void {
  switch (t.type) {
    case "heading": {                                   // pack §1.2: depth 1 → bold+italic+underline, else bold; TWO newlines
      const h = t as Tokens.Heading;
      const segs = inlineSegments(h.tokens ?? [], { ...ctx.style, bold: true, ...(h.depth === 1 ? { italic: true } : {}) });
      for (const s of segs) out.push((h.depth === 1 ? { ...s, underline: true } : s) as Run);
      out.push(styled(ctx, NL + NL));
      break;
    }
    case "paragraph": for (const s of inlineSegments((t as Tokens.Paragraph).tokens ?? [], ctx.style)) out.push(s as Run);
      out.push(styled(ctx, NL)); break;
    case "space": case "br": out.push(styled(ctx, NL)); break;
    case "hr": out.push(styled(ctx, "---")); break;      // pack §1.3: the literal, unstyled, no trailing newline
    case "code": codeRuns(t as Tokens.Code, ctx, out); break;
    case "blockquote": quoteRuns(t as Tokens.Blockquote, ctx, out); break;
    case "table": nestedTableRuns(t as Tokens.Table, ctx, out); break;
    case "list": listRuns(t as Tokens.List, 0, ctx, out); break;
    case "def": break;                                  // pack §1.10 L420702: the empty string
    default: for (const s of inlineSegments([t], ctx.style)) out.push(s as Run);
  }
}

// ── runs → lines (the fold itself lives in lineFold.ts — mdTable.ts folds its own rows with it) ──────
/** Split the run stream on its embedded `\n`s. A trailing newline closes the last line without adding an
 *  empty one; `"\n\n"` in the middle is what produces a blank line. */
function runsToLines(runs: Run[]): RenderLine[] {
  const out: RenderLine[] = [];
  let cur: Segment[] = [];
  for (const r of runs) {
    const parts = r.text.split(NL);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) { out.push(foldLine(cur)); cur = []; }
      if (parts[i] !== "") cur.push({ ...r, text: parts[i] });
    }
  }
  if (cur.length) out.push(foldLine(cur));
  return out;
}

/** A chunk's own leading/trailing blank lines are the `space` tokens that sat at a chunk BOUNDARY — the
 *  boundary blank is `gap: 1`'s job, so trimming here is what keeps "one blank line, never two". */
function trimBlanks(lines: RenderLine[]): RenderLine[] {
  let a = 0, b = lines.length;
  while (a < b && lines[a].text === "") a++;
  while (b > a && lines[b - 1].text === "") b--;
  return lines.slice(a, b);
}

export function renderMarkdown(text: string, opts: MarkdownOptions = {}): RenderLine[] {
  if (text === "") return [];
  const ctx: Ctx = { style: opts.dim ? { dim: true } : {}, width: opts.width ?? 80 };
  // `Oaa`'s three-way split, over the post-heading-space-dropped token list (see `dropPostHeadingSpace`).
  const tokens = dropPostHeadingSpace(lex(text));
  const chunks: Token[][] = [];
  for (const t of tokens) {
    if (t.type === "table" || t.type === "blockquote") { chunks.push([t]); continue; }
    const last = chunks[chunks.length - 1];
    if (last && last[0].type !== "table" && last[0].type !== "blockquote") last.push(t);
    else chunks.push([t]);
  }
  const out: RenderLine[] = [];
  for (const chunk of chunks) {
    // A top-level table chunk goes to the BOX engine (`Oaa` L421143 → `TWo` → `IBp`), never through `f2`
    // — `blockRuns`' own `table` case is the nested pipe form and is unreachable from here.
    let lines: RenderLine[];
    if (chunk[0].type === "table") lines = renderTable(chunk[0] as Tokens.Table, ctx.width);
    else {
      const runs: Run[] = [];
      for (const t of chunk) blockRuns(t, ctx, runs);
      lines = trimBlanks(runsToLines(runs));
    }
    if (lines.length === 0) continue;
    if (out.length) out.push({ text: "", ...(opts.dim && { dim: true }) });   // gap: 1
    out.push(...lines);
  }
  return out;
}
