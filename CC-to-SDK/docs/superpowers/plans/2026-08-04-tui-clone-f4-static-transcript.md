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
- Produces: `Segment` and `RenderLine` each gain optional `strikethrough?: boolean; underline?: boolean; bg?: string` (bg is a theme-grammar color resolved in Line.tsx like `color`). `Gutter` gains `italic?: boolean` (Task 9's `∴` gutter is dim+italic — pack §8.3; adding it here means Task 9 never reopens Line.tsx). `Line` forwards all of them. Every later task relies on these fields.

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
- Top-level assembly (Oaa port) — **the chunking rule, stated exactly (plan-review finding 14):** a MAXIMAL RUN of consecutive non-table, non-blockquote top-level tokens is ONE chunk glued through the f2 walker (paragraph blanks inside it come from `space` tokens, nothing else); each `table` and each top-level `blockquote` is its own chunk; `gap: 1` = one blank line ONLY at chunk boundaries. Consecutive paragraphs never get a gap:1 blank — misreading this as one-chunk-per-token doubles every blank line. (`table` stub until Task 4: fall through to raw.)
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
  it("a `space` token becomes exactly one blank line between paragraphs (f2, NOT gap:1)", () => {
    expect(texts("para one\n\npara two")).toEqual(["para one", "", "para two"]);
  });
  it("gap:1 fires only at prose-run/table/blockquote chunk boundaries — one blank line, never two", () => {
    const t = texts("before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter");
    // prose chunk, ONE blank, table lines, ONE blank, prose chunk — no doubled blanks anywhere
    expect(t.filter((x, i) => x === "" && t[i + 1] === "")).toEqual([]);
  });
  it("inline nesting composes: bold containing italic", () => {
    const l = lines("**bold *both***")[0];
    const both = l.segments!.find((s) => s.bold && s.italic);
    expect(both?.text).toBe("both");
  });
  // TR15 (codespan → `permission` token): the implementation switches role("suggestion") → permission,
  // but `permission` and `suggestion` are byte-identical in ALL FOUR shipped themes, so no test can
  // observe the change (plan-review finding 12). No test here; the parity doc records
  // TR15 as satisfied-by-value with this note.
  it("fast path: plain prose renders without markdown mangling", () => {
    expect(texts("just words, nothing else")).toEqual(["just words, nothing else"]);
  });
  it("dim option dims every SEGMENT (Line.tsx ignores line-level dim when segments exist)", () => {
    for (const l of lines("**b** and plain", { dim: true }))
      expect((l.segments ?? [l as unknown as Segment]).every((s) => s.dim)).toBe(true);
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

**Behavior contract (census §2.2/§3, bundle ZF L393098 / f2 code case L420597–420602 / DhH L420495 — pack-corrected cites):**
- Link: when hyperlinks supported → `\x1b]8;;<url>\x07<blue text>\x1b]8;;\x07` (text colored `blue` on light themes, `blueBright` on dark — port as: resolve via theme's link intent; use Ink-safe names `blue`/`blueBright` chosen by theme `kind`); when not supported → `text (url)` plain, or bare url when text === url. `mailto:` collapses to the bare address. `file:` URLs normalised to absolute `file://` href. Support detection: a `hyperlinksSupported(env)` helper (TERM_PROGRAM/`FORCE_HYPERLINK` heuristic — document the exact heuristic in code; upstream's is `supports-hyperlinks`-shaped). OSC-8 bytes ride INSIDE the segment text with `preStyled` **not** set — the segment may still carry color (chalk-style wrappers do not rewrite OSC bytes; pinned by test).
- Image: no alt and no title → bare href; else `` `${alt} (${href}${title ? " " + JSON.stringify(title) : ""})` `` — copy the exact assembled form from the constants pack §1 before implementing.
- `strikethroughSupported`: port dHn's allowlist (constants pack §1 has it verbatim): TERM_PROGRAM allowlist + ghostty/mintty/JetBrains/kitty/alacritty/foot/Konsole/WT/Zed/VTE≥4400; Apple_Terminal and `TERM=linux` excluded.
- Code block: **no indent** (flush-left), no border, no line numbers, no length cap. Language resolution: full `lang` string, then its `[\w.+#-]+` prefix, then `"plaintext"`. **Label polarity:** with highlighting active (our only mode — we ship no `syntaxHighlightingDisabled` setting), a dim line containing the raw language string appears ABOVE the block exactly when `lang` is present and unrecognized; recognized languages get no label; unknown-language block body is PLAIN (not dimmed). (Constants pack §5 correction: upstream ALSO labels every tagged fence when highlighting is globally disabled — that mode is unreachable in our harness; record in the parity doc, do not build.)
- `highlight.ts` colors move to upstream's scope map: keyword→`blue`, string→`red`, number→`green`, comment→`green` as **bare ANSI names** — a DECIDED trade, not a mechanical swap (plan-review finding 13): upstream's DhH map is chalk constants, theme-INDEPENDENT — upstream paints code red/green in every theme including its daltonized ones, and its code colors do not repaint on theme switch. Fidelity wins: we adopt the same fixed colors (`resolveThemeColor` passes bare names through), accepting the loss of `/theme` live-repaint for fenced code and the red/green presence under daltonized themes — BOTH recorded in the parity doc as upstream-faithful divergences from our house theme pattern. (The current values being replaced are theme tokens — suggestion/success/warning/inactive — not the literal cyan/yellow the first draft claimed.) `KNOWN_LANGS` unchanged.
- `⧉` (TR12's link-affordance glyph): adjudicate from pack §1 in-task — pack §1.9 rules it out for images; determine from the pack's `yAr`/link extracts whether any reachable path emits it around our OSC-8 runs; ship or record with the citation (it must not silently vanish from the parity re-score).

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

### Task 5: Integration — width plumbing, THE CACHE KEY, call-site swap, streaming fence pin

**Files:**
- Modify: `src/tui/render.ts` (`renderMessage` options), `src/tui/toolRenderer.tsx` (`projectMessageEntry` threading + **the anchored-entry cache key** + its load-bearing comment), `src/tui/liveTurn.ts` (columns seam), `src/tui/PlanDialog.tsx` (no width change — see contract)
- Test: `test/tui/markdown-integration.test.tsx` (new), plus updates in `test/tui/liveTurn.test.ts`

**Interfaces:**
- Consumes: `renderMarkdown(text, { width })`.
- Produces: `renderMessage(m, opts?: { width?: number; platform?: NodeJS.Platform; showThinking?: boolean })` — the FULL options bag lands now (Tasks 8/9 fill in behavior; this task threads the values). `LiveTurn` constructor deps gain `columns?: () => number` (mirrors the existing `now` DI; `useChat.ts` passes its `columnsFn`). **The anchored-entry cache key** (toolRenderer.tsx ~658) becomes revision × themeGeneration × **columns × projection × verbose** — every later task relies on this key being honest.

**Behavior contract:**
- **The completed-message seam is `projectMessageEntry` (toolRenderer.tsx ~412)**: it currently does `void options;`. It stops voiding and forwards `{ width: options.columns, platform: options.platform, showThinking: options.projection !== "compact" || options.verbose }` (verify the received type's real fields — `ProjectionContext` vs `ProjectionOptions` — before wiring).
- **The cache-key correctness step (plan-review finding 2 — the one decision that had to precede code):** the WeakMap memo at toolRenderer.tsx:658–668 is keyed on `document.revision() × themeGeneration()` ONLY, and its comment block (639–651) documents "renderMessage is a single-argument function of the message" as the correctness premise. Threading new inputs FALSIFIES that premise: compact (`projectCompact`) and detail (`projectDetail`) projections run over the same document at the same revision — whichever ran first would serve its items to the other (thinking uniformly hidden or shown by call order), and a terminal resize would serve stale-width markdown forever. Fix in THIS task, before any consumer behavior exists: extend the memo key with `columns`, `projection`, and `verbose` (composite string key inside the per-document WeakMap entry), and REWRITE the 639–651 comment to state the new key and why. A stale comment asserting a falsified premise is a defect.
- Regression test: project the SAME unmutated document compact-then-detail and detail-then-compact; assert the two projections' item sets are independent of call order (they need not differ yet — thinking behavior lands in Task 9 — so pin order-independence via a probe `renderMessage` input the test can vary… simplest honest form: pin that changing `columns` between two projections of one document yields re-projected output, not the cached first).
- `LiveTurn`: gains the `columns` dep; its markdown rendering passes `{ width: columns() }`. `PlanDialog`: **no width param exists in that component and none is invented** — it renders at the default 80; recorded as a known simplification in the parity doc (plan-review finding 4).
- TR18 pin (spec settlement 4): a mid-stream open fence (` ```ts\nconst x = 1 ` with no closer) renders the partial body highlighted — marked treats the unterminated fence as code. Pin in a liveTurn-level test: feed accumulated partial text, assert the const line carries highlight segments, not prose.
- Performance guard: `marked.lexer` call count via an injectable/spy-able lexer ≤ distinct-text count across 200 repeat renders (LRU proof).

**Steps:** failing tests (incl. the cache-key order-independence pin) → FAIL → cache key + threading + LiveTurn seam → green → sabotage (revert the key to revision×theme only → the columns-change test must fail; bypass the LRU → spy test fails) → commit `f4(t5): markdown integration — cache key widened, projection threading, LiveTurn columns, fence pin`.

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

**Behavior contract (spec Decision Log "Diff line numbers", P94 memory; scope corrected per plan-review findings 7–9):**
1. Recognized sidecar with `structuredPatch[]` (each `{oldStart, oldLines, newStart, newLines, lines: string[]}` — jsdiff shape; lines prefixed `+`/`-`/space) → map directly; `numbering: "absolute"`; **never call `readFile` in this branch**.
2. Flat-only Edit (`old_string`/`new_string` present): build hunks via jsdiff `structuredPatch(...)` with 3 context lines. Anchoring: `readFile(file_path)`; if the current content **contains `old_string` exactly once**, seed `oldStart` from its line index (+1) → `"absolute"`; else (missing file, changed content, zero or multiple matches) `oldStart: undefined` on all hunks → `"approximate"` with snippet-relative numbering downstream.
3. **Scope: Edit and Write-as-UPDATE only.** `writeRows` already routes `structured?.type === "update"` to the edit path; a Write CREATE keeps F3's 10-line preview-alone form (census 01#58–62, F3 t6 adjudication) — routing creates through the diff pipeline would reverse that settled decision. No all-add hunk for creates.
4. `added`/`removed` counts = `+`/`-` rows across all hunks (upstream NHH/FHH semantics). **What actually changes** (the first draft misdescribed current code): `patchLineCounts` is ALREADY sidecar-only and honest — the extension is that a **flat-only Edit gains a header derived from the jsdiff hunks where today it gets NO row** (toolSummaries.ts:106-108 records why whole-input counting was rejected; that rejection STANDS). Pin: a flat-only Edit's counts equal the changed-line count, never the input line count.
5. **Resolution runs once per event, not per repaint (finding 9):** tool rows are UNCACHED (the toolRenderer memo covers only message/local entries) and useChat re-projects on a 600 ms blink — a per-projection `readFileSync` would run ~2×/s per Edit row. Memoize `resolvePatch` per event identity (WeakMap keyed on the call/result object). Test: a counting `readFile` spy across 5 projections of one event → exactly 1 invocation.
- Return `undefined` when there is nothing diffable (no old/new and no recognized Edit/update sidecar).

**Steps:** failing tests (sidecar-direct with absolute starts + no readFile call — assert via a throwing readFile spy; derived+anchored unique match; ambiguous double match → approximate; missing file → approximate; write-only; counts) → FAIL → `npm i diff@9.0.0` + implement → green → sabotage (make ambiguous match anchor anyway → fail) → commit `f4(t6): diff patch-source ladder — sidecar-first, disk-anchored, visibly-approximate`.

---

### Task 7: Diff rendering — bands, word diff, wrap, `...`, no cap

**Files:**
- Create: `src/tui/diffRender.ts`
- Modify: `src/tui/toolSummaries.ts` (**the real diff-body seam** — `editRows` at ~99–105, dispatched from `summaryLines` which already receives `(event, normalized, options: ProjectionOptions)`, so input/columns/projection are all in scope; plan-review finding 5), `src/tui/render.ts` (DELETE `toolDiffLines` — **pure dead-code removal**: grep proves zero production call sites; the "reused by liveTurn" docstring is stale)
- Test: `test/tui/diffRender.test.ts` (new) + updates to `test/tui/render.test.ts` (toolDiffLines pins die), `test/tui/theme.test.ts` (**imports toolDiffLines at :13 and pins its output at :88–97 including the live-theme-repaint proof — that proof is re-pointed at `renderDiff`, NOT deleted**; finding 6), `toolSummaries.test.ts`

**Interfaces:**
- Consumes: `ResolvedPatch` (Task 6), Task 1 `bg`.
- Produces: `export function renderDiff(patch: ResolvedPatch, width: number): RenderLine[]` and `export function diffHeader(added: number, removed: number): RenderLine`.

**Behavior contract (census §4; pack §6 verbatim — pack-corrected cites: `H2p` L419987, `chH` L420004; census placed both ~100 lines early):**
- Header: `Added <b>N</b> lines, removed <b>M</b> line` — counts bold (segments), positional capitalization: `Removed` capitalizes only when added === 0; singular/plural per count; omit absent halves. (This REPLACES the body of `toolSummaries.diffSummaryRow` — one implementation, re-exported or imported there; do not leave two.)
- Numbering: absolute → seed each hunk at `oldStart`, port chH exactly: context/add increment; a remove-RUN pushes rows with incrementing numbers then **rewinds** by the run length so following adds reuse the first remove's number. Approximate → 1-based snippet numbering **plus the visible marker**: prefix the number gutter with `~` (e.g. `~ 12`) — the honest-approximation affordance (spec E4; exact glyph OUR choice, record as divergence-with-reason in the parity doc — upstream has no approximate mode).
- Gutter width = `String(maxLineNumber).length + 1`, number right-aligned, then one space, then marker `+`/`-`/space, then content. No space between marker and content.
- Bands: add rows `bg: diffAdded`, remove `bg: diffRemoved` (theme tokens resolved per call), right-padded with spaces to `width` so the band is full-width; context rows no bg — and **only the number gutter is dimmed, the content is plain** (constants pack §6 correction to the census; copy H2p's exact dimColor conditions from the pack).
- Word diff: for each paired remove/add at the same offset within a remove-run/add-run pair, jsdiff `diffWords(oldLine, newLine)` (pack §6 confirms `_vs` IS jsdiff diffWords); paint changed words with `diffRemovedWord`/`diffAddedWord` bg segments; **bail to whole-line bands when changed fraction > 0.4** or when rendering dimmed.
- Wrap: content wraps at `width - gutterWidth - 3` on the plain path; **the word-diff path wraps one column wider** (pack §6 — copy its exact arithmetic); continuation lines carry a blank number gutter and repeat the band.
- Collapsed-by-default diffs: upstream collapses only scratchpad-path files (`aHr` = isScratchpadDisplayPath, pack §6 — closes the census "not determined"); we model no scratchpad, so the trigger is unreachable — record in the parity doc, do not build.
- Hunks joined by a dim `...` line. **No `@@` headers. No line cap** — the 24-line cap dies with `toolDiffLines`; collapse/expand (existing outputFold) is the only elision.
- `previewHint` (TR29's third elision, pack §6.3 — "/plan to preview" replaces the body when set): upstream state we do not model and the wire does not carry → **recorded unreachable in the parity doc with the pack citation, not built** (finding 20b; same ruling class as the scratchpad-collapse trigger above).
- Routing (finding 5): `editRows(normalized)` becomes `editRows(event, normalized, options)`. **Projection placement is a bundle adjudication, not an assumption:** F3's header-only compact row was an explicit stopgap ("The real diff is F4's; until then the generic body stands" — toolSummaries.ts:98). Verify against the bundle (pack §6 / fbn's call context) whether the diff body renders in upstream's DEFAULT transcript — the expected answer is YES (header + hunks inline, with collapse the only elision), in which case BOTH projections return header + `renderDiff(patch, options.columns)` and any long-body elision rides the existing fold machinery (which is itself TR29-shaped: collapse + expand hint, no truncation). If the bundle shows a transcript-mode-only body, route compact = header-only instead — either way, cite the line in the task report. Write-as-update inherits via the existing `writeRows` → `editRows` route; Write-create untouched.

**Steps:** failing tests (header forms incl. `Removed 2 lines` capital-R; chH rewind on a 2-remove/2-add hunk at oldStart 40 → numbers 40,41 then 40,41; band right-padding to width; word-diff paints a changed word and bails at >40%; wrap continuation blank gutter; `...` between hunks; approximate `~` gutter; NO cap on a 60-row patch) → FAIL → implement → green (update collateral pins: render.test.ts loses toolDiffLines, toolRenderer/toolSummaries pins move to new forms) → sabotage (drop the rewind → numbering test fails) → commit `f4(t7): diff renderer — bands, word diff, wrap, hunk dots, no cap; toolDiffLines retired`.

---

### Task 8: Identity — bullet, user band, 10k fold, queued indent

**Files:**
- Modify: `src/tui/render.ts` (`withAssistantBullet` platform arg; new `userEchoLines` helper; user path of `renderMessage`), `src/tui/useChat.ts` (**the LIVE user echo is minted here** — `appendNewLocal({ kind: "user-echo", lines: [{ text: \`› ${prompt}\`, dim: true }] })` at ~:1057, plus the command echoes at ~:568 and ~:1102 — all reroute through `userEchoLines`; plan-review finding 1: `render.ts`'s user branch only serves SDK frames on replay/attach), `src/tui/replay.ts` (its `› /cmd` hand-roll at ~:43 joins the same helper), `src/tui/ChatApp.tsx` (**queued messages render here**, ~:211–213 — currently a raw `<Text dimColor>⋯ queued: …</Text>` with a 60-char clip; finding 16)
- Test: `test/tui/identity.test.tsx` (new) + collateral (every test pinning `› ` echoes, the `⋯ queued:` form, or `● ` accent)

**Interfaces:**
- Consumes: Task 1 `bg`; `renderMessage(m, { width, platform })` from Task 5.
- Produces: `export function userEchoLines(text: string, opts: { width?: number }): RenderLine[]` in render.ts — THE single prompt-echo renderer for live (useChat), replay (replay.ts + renderMessage user branch), and queued (ChatApp) so the surfaces cannot drift. `withAssistantBullet(lines, platform?: NodeJS.Platform)` — platform arrives from `renderMessage`'s options (ProjectionContext already carries `platform`; that seam, not a new injection point — finding 15 resolved toward the house pattern).

**Behavior contract (census §1; pack §7 — cites corrected: 10k-fold constants at L426183; L422857 is VAr's default branch, not identity):**
- Assistant bullet: `⏺ ` when `platform === "darwin"`, `● ` elsewhere; gutter color = `text` theme token (resolved per call) — the accent bullet dies. Continuation indent unchanged (2 cols). (Pack §10: in THIS bundle `Pt()` returns the constant `"macos"` — a per-platform build fold; the platform switch is the correct product-level port.)
- `userEchoLines`: gutter `❯ ` colored `subtle`; every line carries `bg: userMessageBackground`, text color `text`, right-padded to `width - 1` (upstream `paddingRight: 1`). Replaces `› ` + dim everywhere it was hand-rolled.
- Long prompts (inside `userEchoLines`): over 10 000 chars → first 2 500 chars of lines, then a dim titled rule — title `(${N} ${N === 1 ? "line" : "lines"} hidden)` left-aligned in `subtle`, dashes to width (pack §7's Sg call: titleAlign "start" + padding) — then the last 2 500 chars. Constants: 10 000 / 2 500 / 2 500 (pack §7, L426183).
- Queued messages (ChatApp.tsx): render each queued prompt through `userEchoLines` indented two columns (`paddingX: 2` port) — upstream's form; our `⋯ queued:` prefix and 60-char clip are inventions and die (recorded in the parity doc as a removed over-ship).
- Sentinel-bearing user texts are NOT band-wrapped — Tasks 10a–c route them first (leave a `// Task 10a routes sentinels before this path` comment at the renderMessage user branch).

**Steps:** failing tests (bullet per platform arg + `text`-token color; `userEchoLines` band/gutter/pad; 12 000-char prompt → head + `lines hidden)` rule + tail, middle dropped; live path: a useChat-level test that submits a prompt and asserts the local user-echo entry carries the band form — REQUIRED, acceptance #5 exercises this path; queued form via ChatApp render) → FAIL → implement → green + collateral → sabotage (drop the fold → 12k test fails; revert useChat to `› ` → live-path test fails) → commit `f4(t8): identity — platform bullet, one userEchoLines for live/replay/queued, 10k fold`.

---

### Task 9: Thinking — hidden by default, ✻ placeholder, ∴ detail gutter

**Files:**
- Modify: `src/tui/render.ts` (thinking branch), `src/tui/liveTurn.ts` (placeholder glyph/form), whatever surface owns the detail projection of assistant messages (trace from `Transcript.tsx` / pager — the ctrl+o path; read before writing)
- Test: `test/tui/thinking.test.tsx` (new)

**Interfaces:**
- Consumes: `renderMarkdown(text, { dim: true })` (Task 2); the projection context `projectMessageEntry` already receives — `ProjectionOptions` carries `projection: ResultProjection` AND `verbose: boolean` today (toolRenderer.tsx:77), so `showThinking = projection !== "compact" || verbose` is derivable at the seam with NO new plumbing.
- Produces: `renderMessage(m, { width, showThinking })`; default `showThinking: false`.

**Behavior contract (census §5, bundle e8o L422457 / the `case "thinking"` guard at L429456 (pack-corrected; 429447 is the `redacted_thinking` return) / zAr L422947):**
- Default projection: thinking blocks render **nothing** (the single largest behavioral divergence today — our always-dim-lines path dies).
- Detail projection (ctrl+o pager) and `--verbose`: `∴` gutter (dim, italic, minWidth-2 → `"∴ "` two-col gutter), content through `renderMarkdown(text, { dim: true })`, continuation lines aligned under the content like the assistant bullet's.
- Streaming placeholder (liveTurn): `✻ Thinking…` dim + italic — U+273B, replacing our `✦ Thinking` (U+2726). Same form for `redacted_thinking`.
- TR33 (duration) verification pins, no new mechanism: assert F3's fold clause still renders `Thought for Ns` from the thoughtMs map (existing tests cover it — add one pin here that the THINKING task didn't regress it: run the existing `toolFold`/`liveTurn` duration tests).
- **Cache-behavior pin (plan-review finding 2's second half):** with Task 5's widened key in place, project ONE unmutated document compact-then-detail AND detail-then-compact over a thinking-bearing message; assert thinking is absent from compact and present in detail **in both orders**. This is the test that would have caught the original call-order poisoning.
- **Frame-level dim pin (finding 11):** render a detail-projected thinking block containing `**bold**` through `<Line>` (ink-testing-library) and assert the frame contains `\x1b[2m` — the RenderLine-level dim assertions alone blessed an implementation Line.tsx renders undimmed.

**Steps:** failing tests (default hides; showThinking shows `∴ ` gutter + dim markdown-styled content — a `**bold**` inside thinking arrives as a dim+bold segment; the two cache-order pins; the `\x1b[2m` frame pin; liveTurn placeholder is exactly `✻ Thinking…` dim italic) → FAIL → implement → green (update any test pinning always-visible thinking or `✦`) → sabotage (flip default to shown → default test fails; re-narrow the cache key → order pins fail) → commit `f4(t9): thinking — hidden by default, ✻ placeholder, ∴ markdown detail, cache-order pins`.

---

### Tasks 10a–10c: Message species — split for bisectability (plan-review finding 21: the unsplit task was a third of the wave)

*(All three: exact strings come from the constants pack §9 (`14-f4-constants-pack.md:1935–2583`) — each brief hands the implementer that file; the contracts below name the branch sets and reachability adjudications, the pack supplies the literals. If the pack contradicts a claim below, the pack wins.)*

### Task 10a: Sentinel router — `species.ts`

**Files:**
- Create: `src/tui/species.ts` (sentinel classification + species rows; the tag regexes are EXTRACTED from `sessions/rows.ts` into shared constants — rows.ts imports them back; never duplicated)
- Modify: `src/tui/render.ts` (user path routes through species first), `src/tui/replay.ts` (same routing for disk replay), `src/tui/toolRenderer.tsx` (plain-interrupt standalone row — the F3 gap: the tool-form sentinel stays suppressed because the tool row carries `Interrupted · What should Claude do instead?`, but the PLAIN form `[Request interrupted by user]` currently suppresses with NO surface anywhere)
- Test: `test/tui/species.test.ts` (new)

**Interfaces:**
- Consumes: pack §9.1–9.3 literals; F3's `INTERRUPT_SENTINEL`.
- Produces: `export function classifyUserText(text: string): SpeciesKind` + `export function speciesLines(kind, text, opts: { width?: number }): RenderLine[] | null` (null = render nothing, e.g. caveat). Tasks 10b/10c and Task 8's user branch consume `classifyUserText`.

**Behavior contract:**
- Sentinel routes (reachability-scoped per spec settlement 3): **the router is `ERe`, and the pack §9.2 shows it has FIFTEEN exits, not the census's ten** — enumerate from the pack, adjudicate each for wire reachability, ship or record-unreachable EVERY one (the parity re-score in Task 11 reads this list). Known routes: `<local-command-caveat>` → **null**; `<command-name>/<command-message>/<command-args>` → the command-echo form; `<local-command-stdout|stderr>` → command-output form; `<bash-input>`/`<bash-stdout|stderr>` → bash forms; `<task-notification` → task form; `<mcp-resource-update|mcp-polling-update>` → `↻ <server>: <target> · <reason>` with `success`-colored `↻` (pack §9.3); interrupt sentinels → tool form stays suppressed (F3), **plain form** renders the standalone `⎿ Interrupted · What should Claude do instead?` dim row; remaining pack exits adjudicated in-task.

**Steps:** failing tests per route (incl. caveat-null, plain-interrupt standalone, replay/live routing parity) → FAIL → implement → green → sabotage (route caveat to visible → fail) → commit `f4(t10a): species router — 15-exit sentinel classification, plain-interrupt surface`.

---

### Task 10b: System subtypes, error sentinels, compact boundary

**Files:**
- Modify: `src/tui/species.ts` (system + error-sentinel renderers), `src/tui/useChat.ts` (compact boundary + system subtype notices; **the expand-hint threading**), `src/tui/toolRenderer.tsx` + `src/tui/toolSummaries.ts` + `src/tui/outputFold.ts` (the three hardcoded `EXPAND_HINT = "(ctrl+o to expand)"` sites — see contract)
- Test: `test/tui/species-system.test.ts` (new) + `test/tui/useChat.test.tsx` collateral (**finding 18: `useChat.test.tsx:967–975` and `:1698–1709` pin the `─── context compacted ───` literal; the :1698 redelivery-dedup guard is load-bearing and must be RE-POINTED at the bulleted form, not deleted**; `replay.test.ts:66`'s `"context compacted earlier"` divider stays)

**Interfaces:**
- Consumes: pack §9.4–9.7 literals; P80/P81 wire facts; Task 10a's `species.ts`.
- Produces: `ProjectionOptions.expandHint?: string` (threaded like F3's `bashHint`) consumed by every expand-hint site.

**Behavior contract:**
- **Expand-hint honesty (finding 10 — the mechanism the first draft assumed does NOT exist):** the `(ctrl+o to expand)` string is hardcoded at toolRenderer.tsx:448, toolSummaries.ts:51, and inline in outputFold.ts:41 — a standing E2 violation if the user rebinds ctrl+o. Build the real route: `useChat` computes the resolved chord from the LIVE keymap (including `keybindings.json` overrides — the same table `bashHint` reads, NOT `keys/hints.ts` `defaultLookup`, which ignores overrides) and threads `expandHint` through `ProjectionOptions`; ALL THREE existing sites convert to it, and the compact-boundary form consumes it. Unbound → no hint clause (E2: never advertise a dead chord).
- Error sentinels (P80): **pack §9.7: `VAr` has ELEVEN sentinel cases plus two default-path predicates plus a 1000-character truncation path** (census said seven). Copy literals + truncation from the pack; adjudicate reachability per case (P80 proved the passthrough channel). `is_api_error_message` (where present) is the trustworthy bit — never the result frame's subtype.
- Compact boundary (P81): the in-flight `compact_boundary` frame replaces our `─── context compacted ───` divider with the bulleted form: `⏺` (text color) + bold `Compact summary` + dim expand hint; detail projection shows the summary body. Pack §9.4: the metadata "Summarized conversation" shape's hint reads "expand **history**", the no-metadata shape plain "expand" — copy each form's exact string; the metadata shape ships only if our wire carries `summarizeMetadata` (else recorded unreachable). Replay-from-disk cannot see the boundary (P81: stripped) — replay keeps the honest degradation via `rows.ts` `compact_summary`.
- System subtypes: generic fallback `⏺ <content>` wrapped at `width - 10`, plain text, for any system frame carrying renderable content — **with pack §9.5–9.6's two corrections: `api_error` returns null (no dedicated branch), and `level === "info"` messages are blanket-suppressed**; port both. Dedicated branches only for subtypes our wire delivers (SDK union: e.g. `local_command_output`, model-refusal pair, `tool_use_summary`, `memory_recall` — adjudicate each against sdk.d.ts + observed frames; unreachable upstream subtypes recorded, not built).

**Steps:** failing tests (compact bulleted form + re-pointed dedup guard; expand-hint from a REBOUND keymap renders the user's chord at all four sites; unbound → no hint; error-sentinel literals; info-suppression; api_error null; generic fallback wrap at width−10) → FAIL → implement → green → sabotage (hardcode one hint site back → rebound-keymap test fails) → commit `f4(t10b): system species — error sentinels, compact summary form, live expand-hint threading`.

---

### Task 10c: Teammate attribution (TR39)

**Files:**
- Modify: `src/tui/toolRenderer.tsx` (the nested branch), `src/tui/species.ts` (attribution row builders)
- Test: `test/tui/teammate.test.tsx` (new)

**Interfaces:**
- Consumes: pack §9.8–9.9 (component strings + the eight `*_FOR_SUBAGENTS_ONLY` tokens, already in theme.ts); F3's `agentMeta` map (name = `subagent_type`, terminal state).
- Produces: nested-message rendering in the detail projection (compact stays empty — upstream's default view doesn't show child messages either; F3 agent-progress rows remain the compact surface).

**Behavior contract:**
- **Integration fact:** `projectMessageEntry` returns `[]` for `isNested(message)` — child messages render NOTHING in any projection today. This task adds the nested branch, detail projection only.
- Live attribution: `@ <subagent_type>❯` in a per-agent color cycling the eight subagent tokens (stable assignment per agent id); content through the markdown renderer, `paddingLeft: 2` port.
- Collapsed form: `› N messages from @<name> (<expandHint>)` — **pack §9.8: singular `Message` when N === 1**; hint via Task 10b's `expandHint` (absent → no parenthetical).
- Lifecycle row: `⏺ Teammate @<name> finished/failed/was interrupted` colored success/error/warning, from F3's agent terminal state; `: <reason>` dim when present.

**Steps:** failing tests (nested renders nothing compact / attributed detail; color stability across two agents; singular Message; lifecycle colors) → FAIL → implement → green → sabotage (drop the singular rule → fail) → commit `f4(t10c): teammate attribution — nested detail branch, subagent colors, lifecycle rows`.

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
5. A 12 000-char prompt shows head, a titled `(N lines hidden)` rule, and tail — **driven through the LIVE path** (a useChat-level submit, not a direct `renderMessage`/`userEchoLines` call; plan-review finding 1: the live echo is a local entry minted in useChat, and this criterion exists to prove that path).

Each acceptance test must be **mutation-proven** in the task report: name the one-line sabotage that makes it fail.

**Parity re-score:** update §2 rows (markdown rows, Edit/Write diff, thinking, compact boundary, user echo, assistant identity, species rows — new rows where none exist) with evidence pointers; recount §2 and the overall headline; retire superseded F0-correction notes; record deliberate divergences (the `~` approximate marker, anything reachability-killed) in the divergence table with reasons.

**Steps:** write tests → run (should pass if T1–T10 are correct — any failure is a real defect, fix in this task or bounce) → sabotage each pin → re-score docs → commit `f4(t11): acceptance pins + parity re-score`.

---

## Final Verification Task (wave close — controller-run)

- Full suites: `npm run typecheck && npx vitest run test/tui test/unit && npm run build`.
- Live e2e (keyed, controller only): one interactive turn producing a markdown-rich reply (table + list + fence) and one real Edit — assert absolute numbers match the file on disk, bands present, no crash on compact form. Pattern after `test/live/f3-live-turn.e2e.test.ts`.
- External whole-branch review per house rule (codex-companion `review --base <F4 base> --model gpt-5.6-sol`, background Bash, stderr → scratch).
- Spec acceptance §F4 1–5 re-read against the shipped tests; parity + coverage refreshed; memory written.

