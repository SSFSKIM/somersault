// test/tui/f4-acceptance.test.tsx — the F4 wave's five spec acceptance criteria, executed as written
// (spec `docs/superpowers/specs/2026-07-31-tui-clone-design.md` § F4 Acceptance).
//
// These are NOT re-runs of the per-task suites. Each task already pins its own walker, template or constant
// in isolation; what had no pin anywhere was the COMPOSITE — one reply carrying eight markdown features at
// once, one Edit walking the whole source→render ladder, one 12 000-char prompt travelling the LIVE submit
// path. A wave can pass every unit suite and still assemble wrong, so every criterion below drives the
// shipped seam a reader actually meets:
//   #1 `renderMessage` (the assistant reply branch), not `renderMarkdown` directly
//   #2 `renderMarkdown` → `mdTable.renderTable`, the routing `Oaa` (L421143) performs for a top-level table
//   #3 `resolvePatch` (diffSource) → `diffHeader`/`renderDiff` (diffRender), both rungs of the ladder
//   #4 the real `projectCompact`/`projectDetail` projections, not `renderMessage` alone
//   #5 `useChat.submit` — the live echo is a LOCAL entry minted inside useChat (plan-review finding 1), so a
//      direct `userEchoLines` call would prove the renderer and miss the path this criterion exists to prove
//
// Bundle cites are to `~/claude-code-bundle/2.1.220/cli.pretty.js` via the F4 constants pack
// (`docs/superpowers/research/2026-07-31-tui-clone/14-f4-constants-pack.md`).
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { afterEach, describe, expect, it } from "vitest";
import { renderMessage, userEchoLines, type RenderLine } from "../../src/tui/render.js";
import { renderMarkdown } from "../../src/tui/markdown.js";
import { resolvePatch } from "../../src/tui/diffSource.js";
import { diffHeader, renderDiff } from "../../src/tui/diffRender.js";
import { DIFF_SCOPES, selectPalette } from "../../src/tui/diffHighlight.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { projectCompact, projectDetail, type RenderItem } from "../../src/tui/toolRenderer.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";
import { useChat } from "../../src/tui/useChat.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

// ── ACCEPTANCE #1 ─────────────────────────────────────────────────────────────────────────────────────
// "A reply containing nested bullets, an ordered list starting at 3, a task list, a blockquote, a
//  horizontal rule, a link, an image and struck-through text renders each the upstream way."
//
// Both the link form (`ZF` L393098 → `mI` L181827) and the strikethrough form (`dHn` L420498–420509) are
// TERMINAL-GATED off `process.env`, so the whole gate set is cleared and `iTerm.app` — the one TERM_PROGRAM
// on BOTH allowlists (`X3u` L181855 / `UhH` L420509) — is set for the composite. Clearing matters as much as
// setting: `dHn` runs its Apple_Terminal / `TERM=linux` exclusions FIRST, so an ambient value on the runner's
// machine would otherwise decide the answer.
const GATE_KEYS = ["TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM", "TERMINAL_EMULATOR", "LC_TERMINAL", "FORCE_HYPERLINK",
  "WT_SESSION", "TMUX", "CLAUDE_CODE_FORCE_STRIKETHROUGH", "KITTY_WINDOW_ID", "ALACRITTY_LOG", "KONSOLE_VERSION", "ZED_TERM", "VTE_VERSION", "MSYSTEM"];
const savedEnv = Object.fromEntries(GATE_KEYS.map((k) => [k, process.env[k]]));
const setGates = (e: Record<string, string> = {}): void => { for (const k of GATE_KEYS) delete process.env[k]; Object.assign(process.env, e); };
afterEach(() => { for (const k of GATE_KEYS) { const v = savedEnv[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const OSC8 = (href: string, text: string) => `\x1b]8;;${href}\x07${text}\x1b]8;;\x07`;

/** The one reply. Every block is a feature the criterion names, in one document, lexed in one pass. */
const COMPOSITE = [
  "# Release notes",
  "",
  "- outer",
  "  - inner",
  "",
  "3. third",
  "4. fourth",
  "",
  "- [x] done",
  "- [ ] open",
  "",
  "> quoted advice",
  "",
  "---",
  "",
  "See [docs](https://example.com) and ![alt](https://x.dev/i.png), plus ~~gone~~ text.",
].join("\n");

const assistantReply = (text: string, platform: NodeJS.Platform = "darwin"): RenderLine[] =>
  renderMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } } as Record<string, unknown>, { width: 80, platform });

/** Upstream's assistant row is a `minWidth: 2` gutter box beside a sibling column (`VAr` L422851), so every
 *  line after the first carries a two-column inset. Stripping it here keeps each per-feature expectation
 *  the bundle's own form rather than the bundle's form plus our transcript inset — the inset itself is
 *  pinned separately, once, below. */
const body = (lines: RenderLine[]): string[] => lines.map((l, i) => (i === 0 ? l.text : l.text.slice(2)));

describe("F4 acceptance #1 — one reply, eight markdown features, each in its upstream form", () => {
  it("renders every named feature the upstream way, in one composite reply", () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const lines = assistantReply(COMPOSITE);
    const rows = body(lines);

    // NESTED BULLETS — the marker is the literal `- ` (never a bullet glyph) and a child indents by
    // `"  ".repeat(depth)` (L420653).
    expect(rows.slice(2, 4)).toEqual(["- outer", "  - inner"]);

    // ORDERED LIST STARTING AT 3 — `case "list"` seeds from markdown's own `start` (L420646–420647) and
    // `JhH` at child depth 1 is arabic (L420665).
    expect(rows.slice(5, 7)).toEqual(["3. third", "4. fourth"]);

    // TASK LIST — `[x] `/`[ ] ` is LITERAL text riding the item's first content child (pack §1.5), not a
    // glyph substitution, and it is boxed exactly once per item.
    expect(rows.slice(8, 10)).toEqual(["- [x] done", "- [ ] open"]);
    for (const r of rows.slice(8, 10)) expect(r.match(/\[[x ]\]/g)!.length).toBe(1);

    // BLOCKQUOTE — a dim `▎ ` rail segment plus italic content (`Naa`/pack §3.1, L420593–420596).
    const quote = lines[11]!;
    expect(quote.segments![0]).toEqual({ text: "  ▎ ", dim: true });
    expect(quote.segments!.at(-1)).toEqual({ text: "quoted advice", italic: true });

    // HORIZONTAL RULE — the literal `---`, unstyled (pack §1.3, L420617). Recorded divergence (F4 t2, ledger
    // item a): the bundle emits `---` with NO trailing newline, gluing the next block onto the same physical
    // line; ours closes the line. The clean line is what is pinned, deliberately.
    expect(rows[13]).toBe("---");
    expect(lines[13]!.bold).toBeUndefined();
    expect(lines[13]!.dim).toBeUndefined();

    // LINK, IMAGE and STRIKETHROUGH all share the final paragraph.
    const tail = lines.at(-1)!.segments!;
    // link: OSC-8 wrapping when the terminal supports it, in the theme's link colour (`ZF` L393098).
    expect(tail).toContainEqual({ text: OSC8("https://example.com", "docs"), color: "blueBright" });
    // image: `alt (href)` — the alt text, one space, the href in parens (pack §1.9, L420619–420624).
    expect(tail).toContainEqual({ text: "alt (https://x.dev/i.png)" });
    // strikethrough: a `del` marks its children, it does not delete them (`dHn`-gated, pack §1.7).
    expect(tail).toContainEqual({ text: "gone", strikethrough: true });
    // …and the composite's flat text carries the struck word exactly once, i.e. nothing was dropped.
    expect(rows.at(-1)).toBe(`See ${OSC8("https://example.com", "docs")} and alt (https://x.dev/i.png), plus gone text.`);
  });

  it("wears the platform assistant bullet and the two-column inset on every continuation line", () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const lines = assistantReply(COMPOSITE);
    // `Za = Pt() === "macos" ? "⏺" : "●"` (L41484), in the plain `text` token — NOT an accent (pack §7).
    expect(lines[0]!.gutter).toEqual({ text: "⏺ ", color: resolveThemeColor(themeTokens().text) });
    expect(lines.slice(1).every((l) => l.gutter === undefined)).toBe(true);
    expect(lines.slice(1).every((l) => l.text === "" || l.text.startsWith("  "))).toBe(true);
    expect(assistantReply("hi", "linux")[0]!.gutter).toEqual({ text: "● ", color: resolveThemeColor(themeTokens().text) });
  });

  it("degrades the two terminal-gated forms honestly when the terminal cannot draw them", () => {
    setGates({});   // no TERM_PROGRAM at all: neither allowlist matches
    const tail = assistantReply(COMPOSITE).at(-1)!;
    // With both gates off the paragraph is uniformly unstyled, so `foldLine` collapses it to a bare line
    // with no `segments` at all — the house convention this file follows elsewhere.
    const spans = tail.segments ?? [tail];
    expect(tail.text).toContain("docs (https://example.com)");            // `ZF`'s unsupported branch: `text (url)`
    expect(spans.some((s) => s.color !== undefined)).toBe(false);         // …and UNCOLOURED, unlike the OSC-8 form
    expect(spans.some((s) => s.strikethrough === true)).toBe(false);
    expect(tail.text).toContain("gone");                                  // struck text is never dropped, only unmarked
    expect(tail.text).toContain("alt (https://x.dev/i.png)");             // the image form is not terminal-gated
  });
});

// ── ACCEPTANCE #2 ─────────────────────────────────────────────────────────────────────────────────────
// "A three-column table draws a box with a rule between every pair of data rows and per-column alignment."
//
// The routing is the point as much as the drawing: `Oaa` (L421143) sends a TOP-LEVEL table to the box engine
// `IBp` (L420907), never to `f2`'s pipe case — so this goes in as markdown and comes out as a grid.
const TABLE = [
  "| Tool | Calls | Cost |",
  "|:-----|:-----:|-----:|",
  "| Read | 12 | 0.01 |",
  "| Edit | 3 | 0.4 |",
  "| ls | 100 | 12.75 |",
].join("\n");

describe("F4 acceptance #2 — a three-column box table, ruled between every data-row pair", () => {
  it("draws the whole grid with per-column alignment and a `middle` rule between each pair of rows", () => {
    // Exact strings, not shape checks: alignment IS whitespace, so a `toContain` would pass on any padding.
    expect(renderMarkdown(TABLE, { width: 80 }).map((l) => l.text)).toEqual([
      "┌──────┬───────┬───────┐",     // `D.top`   (L420994)
      "│ Tool │ Calls │ Cost  │",     // header — force-CENTRED regardless of the column's own alignment,
      "├──────┼───────┼───────┤",     //          biasing left (`bWo` L420839): "Cost" in a 5-wide column
      "│ Read │  12   │  0.01 │",     // left · centre · right, all three observable in one row
      "├──────┼───────┼───────┤",     // ← the rule between data rows 1 and 2
      "│ Edit │   3   │   0.4 │",
      "├──────┼───────┼───────┤",     // ← and between 2 and 3: a rule after EVERY pair, not just the header
      "│ ls   │  100  │ 12.75 │",     // "ls" flush left proves the left column is not centred by default
      "└──────┴───────┴───────┘",     // `D.bottom`
    ]);
  });

  it("puts a rule between every pair and nowhere else — N data rows give exactly N-1 middle rules plus the header's", () => {
    const rows = renderMarkdown(TABLE, { width: 80 }).map((l) => l.text);
    expect(rows.filter((r) => r.startsWith("├")).length).toBe(3);   // header separator + 2 inter-row rules
    expect(rows.filter((r) => r.startsWith("┌")).length).toBe(1);
    expect(rows.filter((r) => r.startsWith("└")).length).toBe(1);
  });
});

// ── ACCEPTANCE #3 ─────────────────────────────────────────────────────────────────────────────────────
// "An Edit renders `Added 3 lines, removed 1 line`, full-width bands, word-level highlighting inside a
//  changed line, and line numbers matching `cat -n` on the file; editing the file behind ccx's back →
//  snippet-relative numbers WITH the visible marker, never a confident wrong number."
const EDIT_FILE_LINES = [
  'import { catalog } from "./data.js";',
  "",
  "export function computeTotalAmount(items) {",
  // The trailing comment is load-bearing, not decoration: `comment` is one of the twelve scopes the
  // 256-colour map `jmH` (L419855) actually carries, and `params` — the token the `(sum` → `(acc` boundary
  // cuts — is NOT. Renaming the accumulator renames it in its own comment too, which puts a second cut
  // inside a token whose foreground is non-default in ALL THREE palettes, so the boundary assertion below
  // bites on a 256-colour terminal (COLORTERM unset, i.e. CI) exactly as it does on a truecolor one.
  "  const subtotal = items.reduce((sum, item) => sum + item.price, 0); // sum over the cart",
  "  return subtotal;",
  "}",
];
const EDIT_FILE = EDIT_FILE_LINES.join("\n") + "\n";
const OLD_STRING = EDIT_FILE_LINES[3]!;
const NEW_STRING = [
  "  const subtotal = items.reduce((acc, item) => acc + item.price, 0); // acc over the cart",
  "  const tax = subtotal * 0.2;",
  "  const total = subtotal + tax;",
].join("\n");
/** What `cat -n <file>` prints for a line: its 1-based position. The whole point of rung 2's disk anchor is
 *  that a rendered gutter number is this number, so the expectation is derived from the file, not typed. */
const catN = (needle: string): number => EDIT_FILE_LINES.indexOf(needle) + 1;
const DIFF_WIDTH = 100;
/** A fresh input object per call: `resolvePatch` memoizes on the RETAINED CALL'S INPUT OBJECT identity
 *  (diffSource.ts:88), so reusing one literal across the matching and mismatching reads would hand the
 *  second call the first's answer and the criterion's second half would be vacuous. */
const editInput = () => ({ file_path: "/work/total.ts", old_string: OLD_STRING, new_string: NEW_STRING });

describe("F4 acceptance #3 — the Edit ladder, end to end", () => {
  it("rung 2 with a MATCHING disk read: the header's counts, absolute `cat -n` numbers, full-width bands, word highlight", () => {
    const patch = resolvePatch({ input: editInput(), readFile: () => EDIT_FILE })!;
    expect(patch.numbering).toBe("absolute");

    // THE HEADER. `fbn` (L423885–423902): clauses joined by the literal ", ", `> 1` pluralization, and the
    // removed clause lower-cased because it is not in first position (L423894's `gXe === 0 ? "R" : "r"`).
    const header = diffHeader(patch.added, patch.removed)!;
    expect(header.text).toBe("Added 3 lines, removed 1 line");
    expect(header.segments!.filter((s) => s.bold === true).map((s) => s.text)).toEqual(["3", "1"]);

    const rows = renderDiff(patch, DIFF_WIDTH);
    const numbered = rows.map((l) => l.text.slice(0, 4));

    // ABSOLUTE NUMBERS MATCHING `cat -n`. The removed line is file line 4; `chH`'s remove-run rewind
    // (L420004) then puts the FIRST added line on the same number, and the two extra adds on 5 and 6.
    // The number cell is `String(maxNumber).length + 1` wide and right-aligned, then one space, then the
    // marker — so a one-digit number in a hunk topping out at 6 reads `" 4 -"`.
    expect(catN(OLD_STRING)).toBe(4);
    expect(numbered).toEqual([` ${catN(OLD_STRING)} -`, ` ${catN(OLD_STRING)} +`, " 5 +", " 6 +"]);
    expect(rows.every((l) => !l.text.includes("~"))).toBe(true);   // no approximate marker on an anchored patch

    // FULL-WIDTH BANDS. `H2p` (L419996–420001) runs the background out to the whole column budget with a
    // right fill, and every span carries the forced `text` foreground (L419986/L420000).
    const added = resolveThemeColor(themeTokens().diffAdded), removed = resolveThemeColor(themeTokens().diffRemoved);
    const wordAdd = resolveThemeColor(themeTokens().diffAddedWord), wordRemove = resolveThemeColor(themeTokens().diffRemovedWord);
    const fg = resolveThemeColor(themeTokens().text);
    expect(rows.every((l) => l.text.length === DIFF_WIDTH)).toBe(true);        // the band runs to the full budget
    // THE FORCED FOREGROUND is now the FALLBACK, not the only value (Wave R t11 / A9): every span still gets
    // it where nothing else claims one — the number cell, the right fill, and any token hljs left unscoped —
    // but an added or context line is tokenized, so `const` comes out in the active syntax palette. The
    // removed row is the one that must stay entirely flat (`-` arm of L419813, picked before `ZmH` ever sees
    // the word ranges, so the remove SIDE OF A PAIR is flat too). Since t12 the paired ADD row is tokenized
    // like any other add row — the word diff is overlaid on those tokens, not split ahead of them.
    expect(rows.every((l) => l.segments![0]!.color === fg)).toBe(true);        // the number cell, always
    expect(rows[0]!.segments!.every((s) => s.color === fg)).toBe(true);        // the removed row, entirely
    for (const line of rows.slice(1)) expect(line.segments!.some((s) => s.color !== fg)).toBe(true);
    expect(rows[0]!.segments!.every((s) => s.bg === removed || s.bg === wordRemove)).toBe(true);
    for (const line of rows.slice(1)) expect(line.segments!.every((s) => s.bg === added || s.bg === wordAdd)).toBe(true);

    // WORD-LEVEL HIGHLIGHTING INSIDE A CHANGED LINE. `shH` (L419906) pairs the 1st remove with the 1st add,
    // and `lhH` (L419944) speckles only the changed words because the changed fraction is under `ohH = 0.4`.
    // All three `sum`→`acc` substitutions carry the WORD band — the two in the code and the one in the
    // comment; the untouched run around each keeps the row band.
    expect(rows[0]!.segments!.filter((s) => s.bg === wordRemove).map((s) => s.text)).toEqual(["sum", "sum", "sum"]);
    expect(rows[1]!.segments!.filter((s) => s.bg === wordAdd).map((s) => s.text)).toEqual(["acc", "acc", "acc"]);
    expect(rows[0]!.segments!.some((s) => s.bg === removed && s.text.includes("const subtotal"))).toBe(true);
    // …AND THE BAND SITS UNDER THE TOKEN (A9's third clause, `ZmH` L419733 / its literal L419757
    // `{ ...c, background: y ? o : n }`). hljs reads `acc, item` as ONE `params` token and the changed word
    // `acc` ends inside it, so the boundary CUTS the token: two spans, one foreground between them, and only
    // the background flipping from the word band back to the row band.
    const addSegments = rows[1]!.segments!, cut = addSegments.findIndex((s) => s.text === "acc");
    expect(addSegments[cut]!.bg).toBe(wordAdd);
    expect(addSegments[cut + 1]!.text).toBe(", item");
    expect(addSegments[cut + 1]!.bg).toBe(added);
    expect(addSegments[cut + 1]!.color).toBe(addSegments[cut]!.color);
    // The SAME clause where colour-identity is not vacuous. This row renders under the live
    // `selectPalette()`, which is `ansi256` unless COLORTERM says truecolor — and `jmH` has no `params`, so
    // the pair above is fg-vs-fg on a 256-colour terminal and an overlay that recoloured at the boundary
    // would sail through it. The trailing comment is the fix: `comment` IS in `jmH` (`Z3(8)`), so the
    // `// … acc …` cut carries a NON-default foreground in every palette, across the boundary, both sides.
    const tail = addSegments.findIndex((s) => s.text === " over the "), inComment = addSegments[tail - 1]!;
    expect(inComment.text).toBe("acc");
    expect(inComment.bg).toBe(wordAdd);
    expect(addSegments[tail]!.bg).toBe(added);                                 // …only the band moves…
    expect(addSegments[tail]!.color).toBe(inComment.color);                    // …the comment colour does not…
    expect(inComment.color).not.toBe(fg);                                      // …and it is a real token colour
    expect(inComment.color).toBe(DIFF_SCOPES[selectPalette()].get("comment"));
    // The two unpaired surplus adds have no partner, so they stay whole-line banded — no word colour at all.
    for (const line of rows.slice(2)) expect(line.segments!.some((s) => s.bg === wordAdd)).toBe(false);
  });

  it("rung 2 with a MISMATCHING disk read: snippet-relative numbers WITH the `~` marker, never a confident wrong number", () => {
    // The same edit, but the file moved on behind our back — so `anchorOffset` (diffSource.ts:53) cannot
    // prove where the snippet sits and refuses to guess.
    const patch = resolvePatch({ input: editInput(), readFile: () => "the file has changed entirely\n" })!;
    expect(patch.numbering).toBe("approximate");
    expect(patch.hunks.every((h) => h.oldStart === undefined)).toBe(true);

    const rows = renderDiff(patch, DIFF_WIDTH);
    // Snippet-relative 1-based numbers, each prefixed by the approximate marker (spec E4, the one recorded
    // invention in diffRender: upstream has no approximate mode, so there is no glyph to copy).
    expect(rows.map((l) => l.text.slice(0, 5))).toEqual(["~ 1 -", "~ 1 +", "~ 2 +", "~ 3 +"]);
    expect(rows.every((l) => l.text.startsWith("~"))).toBe(true);
    // THE POINT OF THE RUNG: it never prints the absolute number it could not prove.
    for (const line of rows) expect(line.text.slice(0, 5)).not.toContain(String(catN(OLD_STRING)));
    // …and the counts, which do not depend on position, are unchanged.
    expect(diffHeader(patch.added, patch.removed)!.text).toBe("Added 3 lines, removed 1 line");
  });

  it("rung 1 short-circuits the ladder: a recognized sidecar is absolute and NEVER reads disk", () => {
    // The rung above rung 2, pinned in the same place so the ladder reads as a ladder: a recognized
    // `structuredPatch` is taken verbatim and the disk is not consulted at all (a re-read would observe
    // state NEWER than the edit it is numbering).
    const sidecar = { filePath: "/work/total.ts", oldString: OLD_STRING, newString: NEW_STRING, originalFile: EDIT_FILE, structuredPatch: [{ oldStart: 4, oldLines: 1, newStart: 4, newLines: 3, lines: [`-${OLD_STRING}`, ...NEW_STRING.split("\n").map((l) => `+${l}`)] }] };
    const throwing = (): string => { throw new Error("rung 1 must never read disk"); };
    const patch = resolvePatch({ input: editInput(), sidecar, readFile: throwing })!;
    expect(patch.numbering).toBe("absolute");
    expect(renderDiff(patch, DIFF_WIDTH).map((l) => l.text.slice(0, 4))).toEqual([" 4 -", " 4 +", " 5 +", " 6 +"]);
  });
});

// ── ACCEPTANCE #4 ─────────────────────────────────────────────────────────────────────────────────────
// "Thinking invisible by default; detail reveals `∴` gutter + markdown + `Thought for 12s`."
//
// ONE READING RECORDED, because the criterion's clause list spans two surfaces and the shipped code splits
// them deliberately (F3 Task 3 built the clock, F4 Task 9 the body):
//   · the `∴` gutter + the dim markdown body are the DETAIL form (`zAr` L422947–422969, reachable only once
//     `Gha`'s `if (!isTranscriptMode && !verbose) return null` guard at L429455 passes);
//   · `Thought for 12s` is a FOLD-RUN clause on the compact group row — and the detail projections ungroup
//     (`bdf`), so there is no group row there to carry it. The clause therefore belongs to the default view,
//     which is exactly where a reader who never presses ctrl+o sees that thinking happened at all.
// Both halves are pinned below on the projection that actually owns them. Recorded in the parity doc.
const projectionContext = { cwd: "/work", home: "/home/me", platform: "linux" as NodeJS.Platform, columns: 80, now: 0 };
const THINKING = "weighing **both** options";
const thinkingDoc = (): TranscriptDocument => {
  const doc = new TranscriptDocument();
  doc.appendSdk("host", { type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [{ type: "thinking", thinking: THINKING, signature: "sig" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/work/a.ts" } }] } } as Record<string, unknown>);
  doc.appendSdk("host", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } } as Record<string, unknown>);
  doc.appendSdk("host", { type: "assistant", parent_tool_use_id: null, message: { id: "m2", content: [{ type: "text", text: "done" }] } } as Record<string, unknown>);
  return doc;
};
const THOUGHT_MS = new Map([["message:m1", 12_000]]);
const itemLines = (items: readonly RenderItem[]): RenderLine[] =>
  items.flatMap((i) => (i.kind === "line" ? [(i as { line: RenderLine }).line] : [...(i as { body: readonly RenderLine[] }).body]));

describe("F4 acceptance #4 — thinking is invisible by default and revealed by the detail projection", () => {
  it("hides the thinking BODY in the default view while reporting `Thought for 12s` on the fold run", () => {
    const lines = itemLines(projectCompact(thinkingDoc(), { ...projectionContext, thoughtMs: THOUGHT_MS }));
    const flat = lines.map((l) => l.text).join("\n");
    expect(flat).not.toContain("weighing");                        // the body is gone, not dimmed
    expect(lines.some((l) => l.gutter?.text === "∴ ")).toBe(false);  // and so is its gutter
    expect(flat).toContain("Thought for 12s");                     // …but the duration is reported
  });

  it("reveals the `∴` gutter, the dim markdown body and nothing fabricated once ctrl+o is pressed", () => {
    for (const projection of ["detail-all", "detail-collapsed"] as const) {
      const lines = itemLines(projectDetail(thinkingDoc(), { ...projectionContext, thoughtMs: THOUGHT_MS, projection }));
      const row = lines.find((l) => l.gutter?.text === "∴ ");
      expect(row, projection).toBeDefined();
      // `zAr`'s gutter is dim AND italic (L422963); the BODY is only dim (`<Markdown dimColor>` L422969).
      expect(row!.gutter).toEqual({ text: "∴ ", dim: true, italic: true });
      expect(row!.italic).toBeUndefined();
      // Real markdown, not escaped source: the `**both**` arrives as a dim+bold SEGMENT, byte-for-byte what
      // `renderMarkdown(text, { dim: true })` produces.
      expect(row!.segments).toEqual(renderMarkdown(THINKING, { dim: true, width: 80 })[0]!.segments);
      expect(row!.segments).toContainEqual({ text: "both", dim: true, bold: true });
      expect(row!.text).toBe("weighing both options");
    }
  });

  it("formats the clause from the measured duration — 12 000 ms is `12s`, and an unmeasured turn gets no clause", () => {
    const measured = itemLines(projectCompact(thinkingDoc(), { ...projectionContext, thoughtMs: THOUGHT_MS })).map((l) => l.text).join("\n");
    expect(measured).toContain("Thought for 12s");
    // No fabrication: with nothing measured there is no clause at all, rather than a `Thought for 0s`.
    const unmeasured = itemLines(projectCompact(thinkingDoc(), projectionContext)).map((l) => l.text).join("\n");
    expect(unmeasured).not.toContain("Thought for");
  });
});

// ── ACCEPTANCE #5 ─────────────────────────────────────────────────────────────────────────────────────
// "A 12 000-char prompt shows head, a titled `(N lines hidden)` rule, and tail" — driven through the LIVE
// path. `useChat.runTurn` mints the echo as a LOCAL entry (useChat.ts:1102) before the session ever sees the
// prompt, and local entries project verbatim; a direct `userEchoLines` call would prove the renderer and
// leave that minting unproven, which is the whole reason the spec words this criterion as it does.
//
// THE FIXTURE'S ARITHMETIC, so the expected `(119 lines hidden)` is derived rather than observed:
//   200 lines × 60 chars, joined by 199 newlines → 12 199 chars (> `tWp = 1e4`, so the fold fires).
//   head = `slice(0, Rqo = 2500)` = lines L000–L040 exactly (41 × 60 + 40 = 2500).
//   tail = `slice(-rWp = 2500)`   = lines L159–L199 exactly (same arithmetic from the other end).
//   hidden = newlines at/after char 2500 (199 − 40 = 159) minus the tail's own (40) = 119.
const PROMPT_LINES = Array.from({ length: 200 }, (_, k) => `L${String(k).padStart(3, "0")}-${"x".repeat(55)}`);
const LONG_PROMPT = PROMPT_LINES.join("\n");
const ECHO_COLUMNS = 80;

const flatten = (items: readonly RenderItem[]): string[] => itemLines(items).map((l) => l.text);
function EchoHost({ api }: { api: { run?: (p: string) => void; rows?: () => string[]; items?: () => RenderLine[] } }) {
  const chat = useChat(() => fakeRemote(), {}, { columns: () => ECHO_COLUMNS, platform: "linux", home: "/home/me" });
  api.run = chat.submit;
  // FSW T3: `finalizedItems`, not `staticItems` — the finalized projection is what this claim is about;
  // `staticItems` is now only the part of it already committed to <Static>.
  api.rows = () => [...flatten(chat.state.finalizedItems), ...flatten(chat.state.pendingItems)];
  api.items = () => [...itemLines(chat.state.finalizedItems), ...itemLines(chat.state.pendingItems)];
  return <Text>{chat.state.finalizedItems.length}</Text>;
}
async function waitFor(cond: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("F4 acceptance #5 — a 12 000-char prompt folds to head + titled rule + tail on the LIVE submit path", () => {
  it("mints the folded echo inside useChat, not just inside the renderer", async () => {
    expect(LONG_PROMPT.length).toBe(12_199);
    const api: { run?: (p: string) => void; rows?: () => string[]; items?: () => RenderLine[] } = {};
    render(<EchoHost api={api} />);
    await new Promise((r) => setTimeout(r, 10));    // let the mount effects subscribe before submitting
    api.run!(LONG_PROMPT);
    await waitFor(() => (api.rows?.() ?? []).some((t) => t.includes("hidden)")));
    const rows = api.rows!();

    // HEAD — the pointer cell (`Ge.pointer` L104968) on row 0 only, then the head's own lines.
    const first = rows.findIndex((t) => t.startsWith("❯ "));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(rows[first]!.startsWith(`❯ ${PROMPT_LINES[0]}`)).toBe(true);
    expect(rows[first + 40]!.trimEnd()).toBe(`  ${PROMPT_LINES[40]}`);          // last head line, two-column inset

    // THE TITLED RULE — `dEn` (L426084): `titleAlign: "start"` puts `Math.min(4, gap)` dashes ahead of the
    // title and the remainder behind it.
    const rule = rows[first + 41]!;
    expect(rule.trimEnd()).toMatch(/^ {2}──── \(119 lines hidden\) ─+$/);

    // TAIL — resumes at L159 and runs to the last line of the prompt. The echo entry is exactly 41 head
    // rows + the rule + 41 tail rows; anything after that belongs to the turn the submit started, not to
    // the echo, so the tail is read at its own offset rather than off the end of the transcript.
    expect(rows[first + 42]!.trimEnd()).toBe(`  ${PROMPT_LINES[159]}`);
    expect(rows[first + 82]!.trimEnd()).toBe(`  ${PROMPT_LINES[199]}`);

    // NOTHING FROM THE MIDDLE SURVIVES: the dropped span really is dropped, not merely scrolled past.
    const echoed = rows.slice(first, first + 83).join("\n");
    for (const k of [41, 100, 158]) expect(echoed).not.toContain(PROMPT_LINES[k]!);

    // The rule's TITLE span is dim inside a `subtle` rule (L183972 nested in L183981's `dimColor = !color`)
    // — the dashes are not. A structural pin, since both spans render the same characters otherwise.
    const ruleLine = api.items!().find((l) => l.text.includes("hidden)"))!;
    const subtle = resolveThemeColor(themeTokens().subtle);
    expect(ruleLine.segments).toContainEqual({ text: "(119 lines hidden)", color: subtle, dim: true, bg: resolveThemeColor(themeTokens().userMessageBackground) });
    expect(ruleLine.segments!.filter((s) => s.text.includes("─")).every((s) => s.dim === undefined)).toBe(true);
  });

  it("leaves a prompt under the 10 000-char threshold whole — the fold is a threshold, not a policy", () => {
    // `tWp = 1e4` (L426183). The boundary is pinned through the renderer the live path just exercised, so a
    // threshold drift cannot hide behind "the long case still folds".
    const short = PROMPT_LINES.slice(0, 100).join("\n");
    expect(short.length).toBeLessThan(10_000);
    const rows = userEchoLines(short, { width: ECHO_COLUMNS }).map((l) => l.text);
    expect(rows.some((t) => t.includes("hidden)"))).toBe(false);
    expect(rows).toHaveLength(100);
  });
});
