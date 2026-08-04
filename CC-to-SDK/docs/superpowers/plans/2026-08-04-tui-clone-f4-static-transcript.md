# F4 — The Static Transcript (markdown, diffs, message species) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the harness TUI's lightweight markdown/diff/message rendering with cell-level clones of Claude Code 2.1.220's static-transcript renderers: `marked`-token markdown (TR5–TR21), real structured diffs with absolute line numbers and background bands (TR23–TR29), upstream message identity (TR1–TR4), hidden-by-default thinking (TR30–TR32), and reachability-scoped message species (TR35–TR39).

**Architecture:** A `marked` token walker emits our existing `RenderLine[]`/`Segment[]` model (NOT glued ANSI — spec Decision Log "F4 design settlements" 2026-08-04), so the one `renderMarkdown` swap upgrades all three call sites (render.ts, liveTurn.ts, PlanDialog.tsx). Diffs move to a two-module pipeline: a patch-source ladder (recognized sidecar `structuredPatch` → jsdiff-derived with disk anchoring → snippet-relative with a visible marker) and a renderer producing full-width background bands with word-level intra-line diffs. Species routing extends the live path with the sentinel classification `sessions/rows.ts` already does for replay.

**Tech Stack:** TypeScript ESM, Ink (existing fork pins), `marked@18.0.7` + `diff@9.0.0` (new deps — both spec-Decision-Log-settled), vitest + ink-testing-library (keyless).

## Global Constraints

- Reference bundle: `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js`. On any conflict between this plan, the census (`docs/superpowers/research/2026-07-31-tui-clone/02-transcript.md`), the constants pack (`.../14-f4-constants-pack.md`), and the bundle: **the bundle wins**; record the correction.
- Honesty invariant (spec E2/E4): no rendered string may advertise a chord/command that does not resolve in the live keymap/catalog; no fabricated numbers — a value with no honest source renders nothing (or a visibly approximate form), never a guess.
- All commands run from `CC-to-SDK/harness/`. Gates after every task: `npm run typecheck` && `npx vitest run test/tui test/unit`. No live/keyed tests in tasks (controller runs those at wave close). Tests must never read or write the real `~/.claude`.
- Dense hand-style, no Prettier; ESM import specifiers end in `.js`; modules stay <500 lines (split rather than grow); theme colors read per call via `themeTokens()`/`resolveThemeColor` (never cached at module scope).
- Commit per task, message prefix `f4(tN): …`, **no Co-Authored-By or attribution trailers**.
- `Segment.preStyled` stays the fold-row escape hatch — markdown/diff output uses styled-prop segments, never raw SGR (spec Decision Log).
- Glyphs are exact: `⏺` U+23FA, `●` U+25CF, `❯` U+276F, `▎` U+258E, `✻` U+273B, `∴` U+2234, `⎿` U+23BF. Never substitute lookalikes.

---

### Task 1: Substrate — `strikethrough`/`underline`/`bg` on the line model

**Files:**
- Modify: `src/tui/render.ts` (the `RenderLine`/`Segment` interfaces only)
- Modify: `src/tui/Line.tsx`
- Test: `test/tui/line-substrate.test.tsx` (new)

**Interfaces:**
- Consumes: existing `RenderLine`/`Segment`/`Line`.
- Produces: `Segment` and `RenderLine` each gain optional `strikethrough?: boolean; underline?: boolean; bg?: string` (bg is a theme-grammar color resolved in Line.tsx like `color`). `Line` forwards them to Ink `<Text strikethrough underline backgroundColor>`. Every later task relies on these three fields.

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
// test/tui/line-substrate.test.tsx
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Line } from "../../src/tui/Line.js";

describe("F4 Task 1 — line-model substrate", () => {
  it("forwards strikethrough and underline segment flags as SGR", () => {
    const { lastFrame } = render(<Line l={{ text: "ab", segments: [
      { text: "a", strikethrough: true }, { text: "b", underline: true }] }} />);
    expect(lastFrame()).toContain("\x1b[9m");   // strikethrough on
    expect(lastFrame()).toContain("\x1b[4m");   // underline on
  });
  it("resolves bg through the theme grammar to a background color", () => {
    const { lastFrame } = render(<Line l={{ text: "x", bg: "rgb(240,240,240)" }} />);
    expect(lastFrame()).toMatch(/\x1b\[48;2;240;240;240m/);
  });
  it("single-styled line path forwards the same three fields", () => {
    const { lastFrame } = render(<Line l={{ text: "s", strikethrough: true, underline: true }} />);
    expect(lastFrame()).toContain("\x1b[9m");
    expect(lastFrame()).toContain("\x1b[4m");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run test/tui/line-substrate.test.tsx`): TS errors — the fields don't exist.

- [ ] **Step 3: Implement.** In `render.ts` extend both interfaces:

```ts
export interface RenderLine { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; bg?: string; gutter?: Gutter; segments?: Segment[]; }
export interface Segment { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; bg?: string; preStyled?: true; }
```

In `Line.tsx`, forward on both paths (segment map and single-styled fallback):

```tsx
<Text key={i} color={ink(s.color)} backgroundColor={ink(s.bg)} dimColor={s.dim} bold={s.bold} italic={s.italic} strikethrough={s.strikethrough} underline={s.underline}>{s.text}</Text>
// …and on the fallback <Text> the same props from `l`.
```

- [ ] **Step 4: Run the new test + full tui/unit suites — green.** `npm run typecheck && npx vitest run test/tui test/unit`

- [ ] **Step 5: Sabotage check (both directions).** Temporarily drop `strikethrough` forwarding in Line.tsx → the new test MUST fail; restore. (Work on committed files or stash first — F2/F3 lesson: never `git checkout` over an uncommitted fix.)

- [ ] **Step 6: Commit** `f4(t1): line-model substrate — strikethrough/underline/bg through Line`

---

### Task 2: Markdown core — `marked` block walker + inline segments

**Files:**
- Create: `src/tui/markdownInline.ts`
- Rewrite: `src/tui/markdown.ts` (same public export; new engine)
- Test: `test/tui/markdown.test.ts` (REWRITE — the old regex-renderer pins die with the engine)
- Modify: `package.json` (+ `marked@18.0.7` dependency), `package-lock.json`

**Interfaces:**
- Consumes: Task 1's `Segment` fields; `highlightCode`/`KNOWN_LANGS` from `highlight.ts`; `resolveThemeColor`/`themeTokens` from `theme.ts`.
- Produces (exact signatures later tasks use):

```ts
// markdown.ts
export interface MarkdownOptions { width?: number; dim?: boolean }        // width default 80; dim = thinking-content mode
export function renderMarkdown(text: string, opts?: MarkdownOptions): RenderLine[];
// markdownInline.ts
export interface InlineStyle { bold?: boolean; italic?: boolean; strikethrough?: boolean; color?: string; dim?: boolean }
export function inlineSegments(tokens: import("marked").Token[], style: InlineStyle): Segment[];
export function strikethroughSupported(env?: NodeJS.ProcessEnv): boolean;   // dHn port (Task 3 fills the allowlist; stub true here)
```

**Behavior contract (bundle, via census §2.1 — all line-cited there):**
- Walker model: each f2 case appends styled runs whose text may embed `\n` exactly as upstream glues them (paragraph → content + `\n`; heading → content + `\n\n`; `space`/`br` → `\n`; `hr` → literal `---`); a final `runsToLines()` splits the run stream into `RenderLine[]` (segments preserved per line). This makes upstream's blank-line structure a **transcription**, not a reconstruction.
- Heading depth 1 → bold+italic+underline; depth ≥2 → bold (markers already stripped by marked).
- Lists: unordered marker is the **literal `- `**; ordered marker `JhH(depth, n)` port: depth 0/1 → `${n}.`, depth 2 → base-26 letters (`a.`), depth 3 → roman (`i.`), deeper → arabic; `start` honoured (`ordered ? start + index : null`). Item children indent `"  ".repeat(listDepth)` EXCEPT `code`/`blockquote`/`hr`/`table` children. Task lists render literal `[x] `/`[ ] ` on the first token.
- Blockquote (both levels): dim `▎` rail + one space, content italic — top-level via the rail prefix on every non-blank line (upstream's `quote` border style is `left:"▎"`, everything else space).
- Top-level assembly (Oaa port): tokens split three ways — `table` → Task 4's `renderTable` (stub until then: fall through to raw), `blockquote` → rail block, everything else → glued runs; **one blank line between top-level chunks** (`gap: 1`).
- Fast path: if the first 500 chars match none of `/[#*`|[>\-_~]|\n\n|(?:^|\n) {0,3}\d+\. |https?:\/\/|www\./` → emit as plain paragraph lines without lexing. Lexer results LRU-cached, 500 entries, keyed by source text.
- `opts.dim` threads `dim: true` onto every produced segment/line (thinking mode); `opts.width` is stored for Task 4's table fitting (unused until then).
- Inline walker: recursive with style accumulation (`strong` sets bold, `em` italic, `del` strikethrough — gated on `strikethroughSupported()`, else literal `~~text~~`; `codespan` → color = `permission` theme token resolved per call; `escape`/`html`/`text` → raw text). Nesting (`**bold with *italic***`) must compose flags on one segment.

**Steps:**

- [ ] **Step 1:** `npm i marked@18.0.7` (exact pin).

- [ ] **Step 2: Write the failing tests** — rewrite `test/tui/markdown.test.ts` with (at minimum) these pins, each a separate `it`:

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/tui/markdown.js";
import { themeTokens, resolveThemeColor } from "../../src/tui/theme.js";

const lines = (s: string) => renderMarkdown(s);
const texts = (s: string) => lines(s).map((l) => l.text);

describe("F4 markdown — block grammar (census §2.1, bundle f2 L420590–420711)", () => {
  it("h1 is bold+italic+underline; h2+ bold only; blank line follows a heading", () => {
    const out = lines("# One\n\nbody");
    expect(out[0]).toMatchObject({ bold: true, italic: true, underline: true });
    expect(out[1].text).toBe("");                        // the \n\n transcription
    const h2 = lines("## Two\n\nbody")[0];
    expect(h2.bold).toBe(true); expect(h2.italic).toBeFalsy(); expect(h2.underline).toBeFalsy();
  });
  it("unordered marker is the literal '- ', not a bullet glyph", () => {
    expect(texts("- item")[0]).toBe("- item");
  });
  it("ordered honours start and depth numbering 1./a./i.", () => {
    expect(texts("3. third\n4. fourth")).toEqual(["3. third", "4. fourth"]);
    const nested = texts("1. a\n   1. b\n      1. c\n         1. d");
    expect(nested[1]).toBe("  1. b");                    // depth 1 → arabic, 2-col indent
    expect(nested[2]).toBe("    a. c");                  // depth 2 → letters
    expect(nested[3]).toBe("      i. d");                // depth 3 → roman
  });
  it("task list renders literal checkbox text", () => {
    expect(texts("- [x] done\n- [ ] open")).toEqual(["- [x] done", "- [ ] open"]);
  });
  it("hr is the literal ---", () => { expect(texts("above\n\n---\n\nbelow")).toContain("---"); });
  it("blockquote: dim ▎ rail, italic content", () => {
    const q = lines("> quoted");
    const first = q[0];
    expect(first.text.startsWith("▎ ")).toBe(true);
    const content = first.segments ? first.segments[first.segments.length - 1] : first;
    expect(content.italic).toBe(true);
  });
  it("one blank line separates top-level blocks (gap:1)", () => {
    expect(texts("para one\n\npara two")).toEqual(["para one", "", "para two"]);
  });
  it("inline nesting composes: bold containing italic", () => {
    const l = lines("**bold *both***")[0];
    const both = l.segments!.find((s) => s.bold && s.italic);
    expect(both?.text).toBe("both");
  });
  it("codespan takes the permission token color", () => {
    const l = lines("has `code` span")[0];
    const code = l.segments!.find((s) => s.text === "code");
    expect(code?.color).toBe(resolveThemeColor(themeTokens().permission));
  });
  it("fast path: plain prose renders without markdown mangling", () => {
    expect(texts("just words, nothing else")).toEqual(["just words, nothing else"]);
  });
  it("dim option dims every line and segment (thinking mode)", () => {
    for (const l of lines("**b** and plain", { dim: true })) {
      expect(l.dim ?? l.segments!.every((s) => s.dim)).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (old engine renders `• item`, no underline field, etc.).

- [ ] **Step 4: Implement** `markdownInline.ts` (inline walker + style accumulation) and the `markdown.ts` rewrite (lexer + LRU + fast path + block walker + `runsToLines`). Port shape guidance:

```ts
// markdownInline.ts — the recursive inline walker. Style flows DOWN by spreading; marked guarantees
// token.tokens on strong/em/del/link; text tokens may carry nested tokens (escaped entities).
export function inlineSegments(tokens: Token[], style: InlineStyle): Segment[] {
  const out: Segment[] = [];
  for (const t of tokens) switch (t.type) {
    case "strong": out.push(...inlineSegments(t.tokens ?? [], { ...style, bold: true })); break;
    case "em": out.push(...inlineSegments(t.tokens ?? [], { ...style, italic: true })); break;
    case "del": strikethroughSupported()
      ? out.push(...inlineSegments(t.tokens ?? [], { ...style, strikethrough: true }))
      : out.push({ ...style, text: `~~${t.raw.slice(2, -2)}~~` }); break;
    case "codespan": out.push({ ...style, text: t.text, color: resolveThemeColor(themeTokens().permission) }); break;
    case "escape": case "text": {
      const tt = t as Tokens.Text;
      if (tt.tokens?.length) out.push(...inlineSegments(tt.tokens, style));
      else out.push({ ...style, text: tt.text });
      break;
    }
    default: out.push({ ...style, text: (t as { raw?: string }).raw ?? "" });
  }
  return out;
}
```

`markdown.ts` block walker: a `Run = Segment & { text: string }` accumulator; each block case pushes segments then a terminator run `{ text: "\n" }` / `{ text: "\n\n" }` exactly per the census table; `runsToLines` splits the accumulated stream on `\n` boundaries into `RenderLine[]` (a line with one unstyled segment folds to a bare line, matching the old `inlineLine` folding so downstream tests stay simple). Top-level: lex (LRU-cached) → three-way split → chunks joined with one blank line. Fast path before lexing. `list` case tracks `listDepth` in walker context; marker text is emitted as a plain (unstyled) segment prefix on the item's first line. Keep the file under 500 lines — the table branch is one `renderTable` call (stub returning raw pipe lines until Task 4 replaces it; mark with a `// Task 4` comment).

- [ ] **Step 5: Run new tests — green.** Then the full gates. **Expected collateral:** old markdown pins in other suites (PlanDialog, render, liveTurn, frame tests asserting `• ` bullets or undivided blocks) fail — update those assertions to the upstream forms in the same commit; every changed assertion must move TOWARD a bundle-cited form, never be deleted outright.

- [ ] **Step 6: Sabotage.** Swap depth-2 numbering to arabic → the nested-list test must fail; restore.

- [ ] **Step 7: Commit** `f4(t2): marked-token markdown core — block walker, inline nesting, depth numbering, fast path + LRU`

---

### Task 3: Links, images, code blocks, strikethrough gate, highlight color map

**Files:**
- Modify: `src/tui/markdownInline.ts` (link/image cases + real `strikethroughSupported`)
- Modify: `src/tui/markdown.ts` (`code` block case)
- Modify: `src/tui/highlight.ts` (color-map alignment)
- Test: `test/tui/markdown-links-code.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's walkers.
- Produces: OSC-8 links inline in segment text; `code` blocks flush-left with the label-polarity rule. `highlight.ts` keeps its exports (`highlightCode`, `KNOWN_LANGS`) — only colors change.

**Behavior contract (census §2.2/§3, bundle ZF L393098 / f2 code case L420598–420603 / DhH L420494):**
- Link: when hyperlinks supported → `\x1b]8;;<url>\x07<blue text>\x1b]8;;\x07` (text colored `blue` on light themes, `blueBright` on dark — port as: resolve via theme's link intent; use Ink-safe names `blue`/`blueBright` chosen by theme `kind`); when not supported → `text (url)` plain, or bare url when text === url. `mailto:` collapses to the bare address. `file:` URLs normalised to absolute `file://` href. Support detection: a `hyperlinksSupported(env)` helper (TERM_PROGRAM/`FORCE_HYPERLINK` heuristic — document the exact heuristic in code; upstream's is `supports-hyperlinks`-shaped). OSC-8 bytes ride INSIDE the segment text with `preStyled` **not** set — the segment may still carry color (chalk-style wrappers do not rewrite OSC bytes; pinned by test).
- Image: no alt and no title → bare href; else `` `${alt} (${href}${title ? " " + JSON.stringify(title) : ""})` `` — copy the exact assembled form from the constants pack §1 before implementing.
- `strikethroughSupported`: port dHn's allowlist (constants pack §1 has it verbatim): TERM_PROGRAM allowlist + ghostty/mintty/JetBrains/kitty/alacritty/foot/Konsole/WT/Zed/VTE≥4400; Apple_Terminal and `TERM=linux` excluded.
- Code block: **no indent** (flush-left), no border, no line numbers, no length cap. Language resolution: full `lang` string, then its `[\w.+#-]+` prefix, then `"plaintext"`. **Label polarity:** with highlighting active (our only mode — we ship no `syntaxHighlightingDisabled` setting), a dim line containing the raw language string appears ABOVE the block exactly when `lang` is present and unrecognized; recognized languages get no label; unknown-language block body is PLAIN (not dimmed). (Constants pack §5 correction: upstream ALSO labels every tagged fence when highlighting is globally disabled — that mode is unreachable in our harness; record in the parity doc, do not build.)
- `highlight.ts` colors move to upstream's scope map: keyword→`blue`, string→`red`, number→`green`, comment→`green` (was cyan/green/yellow/dim). `KNOWN_LANGS` unchanged.

**Steps:**

- [ ] **Step 1: Failing tests** (`test/tui/markdown-links-code.test.ts`):

```ts
it("link emits OSC-8 wrapping when supported, text (url) when not", () => { /* drive hyperlinksSupported via env arg/DI */ });
it("Ink width treats the OSC-8 run as text-only (frame does not overflow)", () => { /* render <Line> with a linked segment at width 20 via ink-testing-library; assert no wrap artifacts */ });
it("code block is flush-left and unlabelled for a recognized language", () => { /* ```ts fence → first body line has no leading spaces, no 'ts' label line */ });
it("unknown language gets a dim label line and a PLAIN body", () => { /* ```weirdlang → label line dim 'weirdlang'; body lines not dim */ });
it("fence info string 'ts title=x' resolves ts via the prefix regex", () => {});
it("del falls back to literal ~~text~~ when unsupported", () => { /* env without allowlisted TERM_PROGRAM */ });
```

Write each body concretely against the Task 2/3 signatures (env injected via a module-level `setTerminalCapsForTest` or an env parameter — pick the house DI style: an optional `env` argument defaulting to `process.env`).

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the link/image/code cases + `hyperlinksSupported`/`strikethroughSupported` + the highlight color swap. Update `highlight.ts` tests' color pins in the same change.
- [ ] **Step 4: Gates green.**
- [ ] **Step 5: Sabotage.** Invert the label polarity (label on recognized) → tests fail; restore.
- [ ] **Step 6: Commit** `f4(t3): links/images/code — OSC-8, label polarity flip, dHn gate, upstream highlight colors`

---

### Task 4: Box tables — `mdTable.ts`

**Files:**
- Create: `src/tui/mdTable.ts`
- Modify: `src/tui/markdown.ts` (route `table` tokens; delete the Task-2 stub AND the old `flushTableBuffer` remnants if any survive)
- Test: `test/tui/mdTable.test.ts` (new)

**Interfaces:**
- Consumes: `inlineSegments` (cell content), Task 1 fields.
- Produces: `export function renderTable(token: Tokens.Table, width: number): RenderLine[]` — called by `markdown.ts` with `opts.width ?? 80`.

**Behavior contract (census §2.3, bundle IBp L420907 / kaa L421019 — cross-check every constant against constants pack §4):**
- Grid: `┌─┬┐` / `├─┼┤` / `└─┴┘`, cell separator `│`; a `middle` rule between EVERY pair of data rows, not just under the header.
- Header cells force-centred; body cells honour markdown `align` (left/center/right pad).
- Width fitting, three ways: natural widths if they fit in `width - 4`; else distribute slack over longest-word minima; else hard-scale with per-column minimum 3.
- Row cap 200; overflow appends `… ${n.toLocaleString()} more ${row|rows} not shown`.
- Vertical record fallback when any cell needs >4 wrapped lines or the assembled table exceeds `width - 4`: each row as `header: value` lines separated by a `─`-rule of `min(width-1, 40)`.
- Rules/borders dim; cell text through the inline walker (styles survive inside cells).

**Steps:**

- [ ] **Step 1: Failing tests** — pin: box shape for a 3-column table (exact `┌`/`├`/`└` line text at a fixed width); per-column alignment (`:---`, `:--:`, `---:`); a rule between every data-row pair (count `├` lines = rows−1 + header rule... derive the exact expected strings, don't count loosely); 200-row cap message; vertical fallback trigger (one 300-char cell at width 40 → `header: value` lines + 39-char rule); header centering.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** `mdTable.ts` (<300 lines: measure → fit → emit).
- [ ] **Step 4: Gates green** (markdown.ts table route swapped in).
- [ ] **Step 5: Sabotage.** Remove the between-rows rule → fail; restore.
- [ ] **Step 6: Commit** `f4(t4): box tables — grid, alignment, three-way fitting, row cap, vertical fallback`

---

### Task 5: Integration — width plumbing, call-site swap, streaming fence pin

**Files:**
- Modify: `src/tui/render.ts` (`renderMessage` passes width/options through), `src/tui/liveTurn.ts`, `src/tui/PlanDialog.tsx` (pass width where available)
- Test: `test/tui/markdown-integration.test.tsx` (new), plus updates in `test/tui/liveTurn.test.ts`

**Interfaces:**
- Consumes: `renderMarkdown(text, { width })`.
- Produces: `renderMessage(m, opts?: { width?: number })` — additive optional param; existing callers unaffected.

**Behavior contract:**
- **The completed-message seam is `toolRenderer.tsx` `projectMessageEntry` (line ~412)** — it renders every non-tool block through `renderMessage` and currently VOIDS its projection context (`void options;`). Thread it: `renderMessage(block, { width: options.columns })` (the context type already carries `columns` — verify whether `projectMessageEntry` receives `ProjectionContext` or `ProjectionOptions` and use its real field). liveTurn passes the width it already knows (trace its plumbing); PlanDialog its dialog width. Where no width exists, omit (default 80).
- TR18 pin (spec settlement 4): a mid-stream open fence (` ```ts\nconst x = 1 ` with no closer) renders the partial body highlighted — marked treats the unterminated fence as code. Pin in a liveTurn-level test: feed accumulated partial text, assert the const line carries highlight segments, not prose.
- Performance guard: one test lexes a 4-paragraph text 200× through `renderMarkdown` and asserts the LRU makes repeat calls cheap — pin **behaviorally**: `marked.lexer` call count via a spy/wrapper ≤ distinct-text count (structure the cache so the lexer fn is injectable or spy-able).

**Steps:** failing tests → FAIL → wire widths + export what the fence test needs → green → sabotage (bypass the LRU → spy test fails) → commit `f4(t5): markdown integration — width plumb, streaming fence pin, LRU guard`.

---

### Task 6: Diff substrate — patch-source ladder (`diffSource.ts`)

**Files:**
- Create: `src/tui/diffSource.ts`
- Test: `test/tui/diffSource.test.ts` (new)
- Modify: `package.json` (+ `diff@9.0.0`)

**Interfaces:**
- Consumes: the tool-event shape `toolRenderer` already holds (`call.input`, `call.result.sidecar` — read `transcriptModel.ts` for exact fields).
- Produces:

```ts
export interface DiffLineRow { kind: "add" | "remove" | "context"; text: string; }
export interface DiffHunk { oldStart: number | undefined; rows: DiffLineRow[]; }
export interface ResolvedPatch { hunks: DiffHunk[]; numbering: "absolute" | "approximate"; added: number; removed: number; }
export function resolvePatch(args: { input: Record<string, unknown>; sidecar?: unknown; readFile?: (p: string) => string | undefined }): ResolvedPatch | undefined;
```

`readFile` is DI (default: `fs.readFileSync` with try/undefined) so tests never touch disk implicitly.

**Behavior contract (spec Decision Log "Diff line numbers", P94 memory):**
1. Recognized sidecar with `structuredPatch[]` (each `{oldStart, oldLines, newStart, newLines, lines: string[]}` — jsdiff shape; lines prefixed `+`/`-`/space) → map directly; `numbering: "absolute"`; **never call `readFile` in this branch**.
2. Flat-only Edit (`old_string`/`new_string` present): build hunks via jsdiff `structuredPatch(...)` with 3 context lines. Anchoring: `readFile(file_path)`; if the current content **contains `old_string` exactly once**, seed `oldStart` from its line index (+1) → `"absolute"`; else (missing file, changed content, zero or multiple matches) `oldStart: undefined` on all hunks → `"approximate"` with snippet-relative numbering downstream.
3. Write (content only): single all-add hunk; `oldStart` from sidecar if recognized, else undefined.
4. `added`/`removed` counts = `+`/`-` rows across all hunks (upstream NHH/FHH semantics) — this feeds the Task 7 header AND upgrades `toolSummaries.diffSummaryRow`'s counts (it currently counts input lines; the census notes upstream reports diffed lines).
- Return `undefined` when there is nothing diffable (no old/new/content and no recognized sidecar).

**Steps:** failing tests (sidecar-direct with absolute starts + no readFile call — assert via a throwing readFile spy; derived+anchored unique match; ambiguous double match → approximate; missing file → approximate; write-only; counts) → FAIL → `npm i diff@9.0.0` + implement → green → sabotage (make ambiguous match anchor anyway → fail) → commit `f4(t6): diff patch-source ladder — sidecar-first, disk-anchored, visibly-approximate`.

---

### Task 7: Diff rendering — bands, word diff, wrap, `...`, no cap

**Files:**
- Create: `src/tui/diffRender.ts`
- Modify: `src/tui/toolRenderer.tsx` (route Edit/Write bodies through it), `src/tui/toolSummaries.ts` (counts from `ResolvedPatch`), `src/tui/render.ts` (DELETE `toolDiffLines`), `src/tui/liveTurn.ts` (follow the routing if it referenced toolDiffLines)
- Test: `test/tui/diffRender.test.ts` (new) + updates to `test/tui/render.test.ts` (toolDiffLines pins die), `toolRenderer.test.tsx`, `toolSummaries.test.ts`

**Interfaces:**
- Consumes: `ResolvedPatch` (Task 6), Task 1 `bg`.
- Produces: `export function renderDiff(patch: ResolvedPatch, width: number): RenderLine[]` and `export function diffHeader(added: number, removed: number): RenderLine`.

**Behavior contract (census §4, bundle fbn/K3e/H2p/chH/shH/lhH — verbatim quotes in census):**
- Header: `Added <b>N</b> lines, removed <b>M</b> line` — counts bold (segments), positional capitalization: `Removed` capitalizes only when added === 0; singular/plural per count; omit absent halves. (This REPLACES the body of `toolSummaries.diffSummaryRow` — one implementation, re-exported or imported there; do not leave two.)
- Numbering: absolute → seed each hunk at `oldStart`, port chH exactly: context/add increment; a remove-RUN pushes rows with incrementing numbers then **rewinds** by the run length so following adds reuse the first remove's number. Approximate → 1-based snippet numbering **plus the visible marker**: prefix the number gutter with `~` (e.g. `~ 12`) — the honest-approximation affordance (spec E4; exact glyph OUR choice, record as divergence-with-reason in the parity doc — upstream has no approximate mode).
- Gutter width = `String(maxLineNumber).length + 1`, number right-aligned, then one space, then marker `+`/`-`/space, then content. No space between marker and content.
- Bands: add rows `bg: diffAdded`, remove `bg: diffRemoved` (theme tokens resolved per call), right-padded with spaces to `width` so the band is full-width; context rows no bg — and **only the number gutter is dimmed, the content is plain** (constants pack §6 correction to the census; copy H2p's exact dimColor conditions from the pack).
- Word diff: for each paired remove/add at the same offset within a remove-run/add-run pair, jsdiff `diffWords(oldLine, newLine)` (pack §6 confirms `_vs` IS jsdiff diffWords); paint changed words with `diffRemovedWord`/`diffAddedWord` bg segments; **bail to whole-line bands when changed fraction > 0.4** or when rendering dimmed.
- Wrap: content wraps at `width - gutterWidth - 3` on the plain path; **the word-diff path wraps one column wider** (pack §6 — copy its exact arithmetic); continuation lines carry a blank number gutter and repeat the band.
- Collapsed-by-default diffs: upstream collapses only scratchpad-path files (`aHr` = isScratchpadDisplayPath, pack §6 — closes the census "not determined"); we model no scratchpad, so the trigger is unreachable — record in the parity doc, do not build.
- Hunks joined by a dim `...` line. **No `@@` headers. No line cap** — delete our 24-line cap; collapse/expand (existing outputFold) is the only elision.
- toolRenderer routing: the Edit/Write detail body renders `renderDiff`; the compact body keeps the typed summary row (F3 form) — read `toolRenderer.tsx`'s existing Edit routing and the `ResultProjection` values in `outputFold.ts` before wiring; the diff body appears where the current input-derived body appears today.

**Steps:** failing tests (header forms incl. `Removed 2 lines` capital-R; chH rewind on a 2-remove/2-add hunk at oldStart 40 → numbers 40,41 then 40,41; band right-padding to width; word-diff paints a changed word and bails at >40%; wrap continuation blank gutter; `...` between hunks; approximate `~` gutter; NO cap on a 60-row patch) → FAIL → implement → green (update collateral pins: render.test.ts loses toolDiffLines, toolRenderer/toolSummaries pins move to new forms) → sabotage (drop the rewind → numbering test fails) → commit `f4(t7): diff renderer — bands, word diff, wrap, hunk dots, no cap; toolDiffLines retired`.

---

### Task 8: Identity — bullet, user band, 10k fold, queued indent

**Files:**
- Modify: `src/tui/render.ts` (`withAssistantBullet`, user-echo path in `renderMessage`)
- Test: `test/tui/identity.test.tsx` (new) + collateral updates (any test pinning `● ` accent or `› `)

**Interfaces:**
- Consumes: Task 1 `bg`; `renderMessage(m, { width })` from Task 5.
- Produces: `withAssistantBullet` signature unchanged; user rows change shape (downstream frame pins update).

**Behavior contract (census §1, bundle L41484/422857/426026–426181):**
- Assistant bullet: `⏺ ` on `process.platform === "darwin"`, `● ` elsewhere; gutter color = `text` theme token (resolved per call) — the accent bullet dies. Continuation indent unchanged (2 cols). (Pack §10: in THIS bundle `Pt()` returns the constant `"macos"` — a per-platform build fold, so the `●` branch is unreachable in the artifact; the platform switch is the correct product-level port and stays.)
- User echo: gutter `❯ ` colored `subtle`; every line of the block carries `bg: userMessageBackground`, text color `text`, right-padded to `width - 1` (upstream `paddingRight: 1`). Replaces `› ` + dim.
- Long prompts: over 10 000 chars → first 2 500 chars of lines, then a dim titled rule `── (N lines hidden) ──`-form — build the rule as: title `(${N} ${N === 1 ? "line" : "lines"} hidden)` left-aligned in `subtle`, dashes to width (match upstream's titled-rule shape: `─ <title> ─────…`; constants pack §7 has the Sg call — follow its titleAlign:"start" + padding), then the last 2 500 chars of lines. Constants: threshold 10 000, head 2 500, tail 2 500.
- Queued messages: when the composer queue renders queued prompts into the transcript (find the call site — `useChat.ts` queue handling), indent the block 2 columns (`paddingX: 2` port).
- Sentinel-bearing user texts are NOT band-wrapped here — Task 10 routes them first; Task 8 only touches the plain-prompt path (leave a `// Task 10 routes sentinels before this path` comment).

**Steps:** failing tests (darwin/other bullet via injectable platform arg defaulting to `process.platform`; bullet color = resolved `text` token; user line carries bg + `❯ `; a 12 000-char prompt yields head lines + a rule line containing `lines hidden)` + tail lines and drops the middle; padded width) → FAIL → implement → green + collateral updates → sabotage (drop the fold, feed 12k prompt → test fails) → commit `f4(t8): identity — platform bullet in text color, ❯ user band, 10k fold, queued indent`.

---

### Task 9: Thinking — hidden by default, ✻ placeholder, ∴ detail gutter

**Files:**
- Modify: `src/tui/render.ts` (thinking branch), `src/tui/liveTurn.ts` (placeholder glyph/form), whatever surface owns the detail projection of assistant messages (trace from `Transcript.tsx` / pager — the ctrl+o path; read before writing)
- Test: `test/tui/thinking.test.tsx` (new)

**Interfaces:**
- Consumes: `renderMarkdown(text, { dim: true })` (Task 2); the projection context `projectMessageEntry` already receives — `ProjectionOptions` carries `projection: ResultProjection` AND `verbose: boolean` today (toolRenderer.tsx:77), so `showThinking = projection !== "compact" || verbose` is derivable at the seam with NO new plumbing.
- Produces: `renderMessage(m, { width, showThinking })`; default `showThinking: false`.

**Behavior contract (census §5, bundle e8o L422457 / Gha L429447 / zAr L422947):**
- Default projection: thinking blocks render **nothing** (the single largest behavioral divergence today — our always-dim-lines path dies).
- Detail projection (ctrl+o pager) and `--verbose`: `∴` gutter (dim, italic, minWidth-2 → `"∴ "` two-col gutter), content through `renderMarkdown(text, { dim: true })`, continuation lines aligned under the content like the assistant bullet's.
- Streaming placeholder (liveTurn): `✻ Thinking…` dim + italic — U+273B, replacing our `✦ Thinking` (U+2726). Same form for `redacted_thinking`.
- TR33 (duration) verification pins, no new mechanism: assert F3's fold clause still renders `Thought for Ns` from the thoughtMs map (existing tests cover it — add one pin here that the THINKING task didn't regress it: run the existing `toolFold`/`liveTurn` duration tests).

**Steps:** failing tests (default hides; showThinking shows `∴ ` gutter + dim markdown-styled content — e.g. a `**bold**` inside thinking arrives as a dim+bold segment; liveTurn placeholder is exactly `✻ Thinking…` dim italic) → FAIL → implement → green (update any test pinning always-visible thinking or `✦`) → sabotage (flip default to shown → default test fails) → commit `f4(t9): thinking — hidden by default, ✻ placeholder, ∴ markdown detail`.

---

### Task 10: Message species — sentinel router, system subtypes, error sentinels, compact form, teammate attribution

*(Exact strings for every branch come from the constants pack `docs/superpowers/research/2026-07-31-tui-clone/14-f4-constants-pack.md` §9 — the brief hands the implementer that file; the contracts below name the branch set and the reachability adjudications, and the pack supplies the literals. If the pack contradicts a claim below, the pack wins.)*

**Files:**
- Create: `src/tui/species.ts` (sentinel classification + species rows; shares regexes with `sessions/rows.ts` — extract the shared constants there rather than duplicating)
- Modify: `src/tui/render.ts` (user path routes through species first), `src/tui/useChat.ts` (compact boundary + system subtype notices), `src/tui/replay.ts` (same routing for disk replay), `src/tui/toolRenderer.tsx` (plain-interrupt standalone row — see S6b)
- Test: `test/tui/species.test.ts` (new)

**Interfaces:**
- Consumes: pack §9 literals; P80/P81 wire facts; F3's `INTERRUPT_SENTINEL` suppression; `agentMeta` (F3) for teammate lifecycle.
- Produces: `export function classifyUserText(text: string): SpeciesKind` + `export function speciesLines(kind, text, opts): RenderLine[] | null` (null = render nothing, e.g. caveat).

**Behavior contract:**
- Sentinel routes (reachability-scoped per spec settlement 3): **the router is `ERe`, and the pack §9 shows it has FIFTEEN exits, not the census's ten** — enumerate from the pack, adjudicate each for wire reachability, ship or record-unreachable every one. Known routes: `<local-command-caveat>` → **null**; `<command-name>/<command-message>/<command-args>` → the command-echo form; `<local-command-stdout|stderr>` → command-output form; `<bash-input>`/`<bash-stdout|stderr>` → bash forms; `<task-notification` → task form; `<mcp-resource-update|mcp-polling-update>` → `↻ <server>: <target> · <reason>` with `success`-colored `↻`; interrupt sentinels → tool form stays suppressed (F3), **plain form** (`[Request interrupted by user]`, no "for tool use") renders a standalone `⎿ Interrupted · What should Claude do instead?` dim row; remaining pack exits adjudicated in-task.
- Error sentinels (P80): **the pack §9 shows `VAr` has ELEVEN sentinel cases plus two default-path predicates plus a 1000-character truncation path** (census said seven rows). Copy the literals and the truncation behavior from the pack; adjudicate reachability per case (P80 proved the passthrough channel). `is_api_error_message` (where present) is the trustworthy bit — never the result frame's subtype.
- Compact boundary (P81): the in-flight `compact_boundary` frame replaces our `─── context compacted ───` divider with the bulleted form: `⏺` (text color) + bold `Compact summary` + dim expand hint; detail projection shows the summary body. The hint chord must come from the live keymap resolution (honesty rule E2) — reuse F3's hint derivation. NOTE (pack §9): the metadata "Summarized conversation" shape's hint reads "expand **history**", the no-metadata shape plain "expand" — copy each form's exact string; the metadata shape ships only if our wire carries `summarizeMetadata` (else recorded unreachable). Replay-from-disk cannot see the boundary (P81: stripped) — replay keeps the honest degradation via `rows.ts` `compact_summary`.
- System subtypes: generic fallback `⏺ <content>` wrapped at `width - 10`, plain text, for any system frame carrying renderable content — **except pack §9's two corrections: `api_error` returns null (no dedicated branch), and `level === "info"` messages are blanket-suppressed**; port both. Dedicated branches only for subtypes our wire delivers (SDK union: e.g. `local_command_output`, model-refusal pair, `tool_use_summary`, `memory_recall` — adjudicate each against sdk.d.ts + observed frames; unreachable upstream subtypes recorded, not built).
- Teammate attribution (TR39): child-attributed messages in the detail projection get `@ <subagent_type>❯` in a per-agent color cycling the eight `*_FOR_SUBAGENTS_ONLY` tokens (already in theme.ts); collapsed form `› N messages from @<name> (ctrl+o to expand)` — **pack §9: the noun is `Message` singular when N === 1** — chord from live keymap; lifecycle row `⏺ Teammate @<name> finished/failed/was interrupted` colored success/error/warning, from F3's agent terminal state. **Integration fact:** `projectMessageEntry` currently returns `[]` for `isNested(message)` — child messages render NOTHING in projections today; the F3 agent-progress rows are the only child surface. This task adds the nested branch (detail projection only), keyed on the F3 `agentMeta` map for name/state. `osc8FileLink` in toolRenderer.tsx:85 is the house OSC-8 precedent if links are needed.

**Steps:** failing tests per route (incl. caveat-null, plain-interrupt standalone, compact bulleted form with live-keymap hint, generic system fallback wrap width, teammate color assignment stability) → FAIL → implement → green → sabotage (route caveat to visible → fail) → commit `f4(t10): species — sentinel router, error sentinels, compact summary form, teammate attribution`.

---

### Task 11: Acceptance pins + parity re-score

**Files:**
- Test: `test/tui/f4-acceptance.test.tsx` (new)
- Modify: `docs/parity/tui-ux.md` (§2 re-score + F4 section), `docs/parity/coverage.md`

**Spec acceptance, executed as written (spec F4 §Acceptance):**
1. A reply containing nested bullets, an ordered list starting at 3, a task list, a blockquote, a horizontal rule, a link, an image and struck-through text renders each the upstream way — one composite markdown fixture, per-feature assertions (bundle-cited expected forms).
2. A three-column table draws a box with a rule between every pair of data rows and per-column alignment.
3. An Edit renders `Added 3 lines, removed 1 line`, full-width bands, word-level highlighting inside a changed line, and line numbers matching `cat -n` on the file; editing the file behind ccx's back → snippet-relative numbers WITH the visible marker, never a confident wrong number (drive `resolvePatch` with a DI readFile that first matches, then mismatches).
4. Thinking invisible by default; detail reveals `∴` gutter + markdown + `Thought for 12s`.
5. A 12 000-char prompt shows head, a titled `(N lines hidden)` rule, and tail.

Each acceptance test must be **mutation-proven** in the task report: name the one-line sabotage that makes it fail.

**Parity re-score:** update §2 rows (markdown rows, Edit/Write diff, thinking, compact boundary, user echo, assistant identity, species rows — new rows where none exist) with evidence pointers; recount §2 and the overall headline; retire superseded F0-correction notes; record deliberate divergences (the `~` approximate marker, anything reachability-killed) in the divergence table with reasons.

**Steps:** write tests → run (should pass if T1–T10 are correct — any failure is a real defect, fix in this task or bounce) → sabotage each pin → re-score docs → commit `f4(t11): acceptance pins + parity re-score`.

---

## Final Verification Task (wave close — controller-run)

- Full suites: `npm run typecheck && npx vitest run test/tui test/unit && npm run build`.
- Live e2e (keyed, controller only): one interactive turn producing a markdown-rich reply (table + list + fence) and one real Edit — assert absolute numbers match the file on disk, bands present, no crash on compact form. Pattern after `test/live/f3-live-turn.e2e.test.ts`.
- External whole-branch review per house rule (codex-companion `review --base <F4 base> --model gpt-5.6-sol`, background Bash, stderr → scratch).
- Spec acceptance §F4 1–5 re-read against the shipped tests; parity + coverage refreshed; memory written.

