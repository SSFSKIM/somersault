// test/tui/diffRender.test.ts — F4 Task 7: the diff renderer. Every constant asserted here is quoted from the
// F4 constants pack §6 (bundle `~/claude-code-bundle/2.1.220/cli.pretty.js`): the header JSX `fbn` (L423885–902),
// the hunk separator `K3e` (L420118), the numbering `chH` (L420004) INCLUDING its remove-run rewind, the band/
// gutter/wrap block `H2p` (L419987), the remove/add pairing `shH` (L419906) and the word diff `lhH` (L419944)
// with its `ohH = 0.4` bail (L420030). The pack corrects two census readings this file pins directly: only a
// context row's NUMBER GUTTER is dimmed (its content is not), and the word-diff path wraps ONE COLUMN WIDER
// than the plain path. There is NO line cap anywhere — the 24-row cap died with `toolDiffLines`.
import { afterEach, describe, expect, it } from "vitest";
import hljsReal from "highlight.js";
import { diffHeader, renderDiff } from "../../src/tui/diffRender.js";
import { DIFF_SCOPES, setHljsLoaderForTest, type DiffPalette } from "../../src/tui/diffHighlight.js";
import type { DiffLineRow, ResolvedPatch } from "../../src/tui/diffSource.js";
import type { RenderLine, Segment } from "../../src/tui/render.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const TEXT = () => resolveThemeColor(themeTokens().text);
const ADDED = () => resolveThemeColor(themeTokens().diffAdded);
const REMOVED = () => resolveThemeColor(themeTokens().diffRemoved);
const ADDED_WORD = () => resolveThemeColor(themeTokens().diffAddedWord);
const REMOVED_WORD = () => resolveThemeColor(themeTokens().diffRemovedWord);

const r = (kind: DiffLineRow["kind"], text: string): DiffLineRow => ({ kind, text });
const patchOf = (hunks: { oldStart: number | undefined; rows: DiffLineRow[] }[], numbering: ResolvedPatch["numbering"] = "absolute"): ResolvedPatch => {
  const rows = hunks.flatMap((h) => h.rows);
  return { hunks, numbering, added: rows.filter((x) => x.kind === "add").length, removed: rows.filter((x) => x.kind === "remove").length };
};

describe("diffHeader — upstream `fbn` (L423885–423902)", () => {
  const textOf = (added: number, removed: number) => diffHeader(added, removed)?.text;
  const boldOf = (added: number, removed: number) => (diffHeader(added, removed)?.segments ?? []).filter((s) => s.bold === true).map((s) => s.text);
  it("joins both clauses with the literal `, ` and pluralizes with `> 1`", () => {
    expect(textOf(1, 3)).toBe("Added 1 line, removed 3 lines");
    expect(textOf(2, 2)).toBe("Added 2 lines, removed 2 lines");
    expect(textOf(1, 1)).toBe("Added 1 line, removed 1 line");
  });
  it("capitalizes `Removed` POSITIONALLY — only when the added count is zero (L423894 `gXe === 0 ? \"R\" : \"r\"`)", () => {
    expect(textOf(0, 2)).toBe("Removed 2 lines");
    expect(textOf(0, 1)).toBe("Removed 1 line");
    expect(textOf(4, 0)).toBe("Added 4 lines");
  });
  it("bolds the COUNTS as segments, nothing else, and renders no row at all for a zero-change patch", () => {
    expect(boldOf(1, 3)).toEqual(["1", "3"]);
    expect(boldOf(0, 2)).toEqual(["2"]);
    expect(diffHeader(0, 0)).toBeUndefined();
  });
});

describe("renderDiff — numbering (`chH`, L420004)", () => {
  it("REWINDS after a remove run so a paired remove/add block carries the SAME numbers on both sides", () => {
    const out = renderDiff(patchOf([{ oldStart: 40, rows: [r("remove", "aaa"), r("remove", "bbb"), r("add", "ccc"), r("add", "ddd")] }]), 20);
    expect(out.map((l) => l.text)).toEqual([
      " 40 -aaa            ",
      " 41 -bbb            ",
      " 40 +ccc            ",
      " 41 +ddd            ",
    ]);
  });
  it("advances one number per context and per add row, seeded at the hunk's oldStart", () => {
    const out = renderDiff(patchOf([{ oldStart: 7, rows: [r("context", "a"), r("add", "b"), r("context", "c")] }]), 20);
    expect(out.map((l) => l.text.slice(0, 4))).toEqual([" 7  ", " 8 +", " 9  "]);
  });
  it("sizes the gutter as `String(maxLineNumber).length + 1`, right-aligned, then one space then the marker", () => {
    const out = renderDiff(patchOf([{ oldStart: 998, rows: [r("context", "a"), r("add", "b"), r("context", "c")] }]), 24);
    // max number 1000 → 4 digits + 1 = a 5-wide number cell, then one space, then the marker, then the
    // content with NO space between marker and content. The gutter is sized PER HUNK, as `H2p` is.
    expect(out.map((l) => l.text.slice(0, 8))).toEqual(["  998  a", "  999 +b", " 1000  c"]);
  });
});

// THE RIGHT FILL IS ITS OWN SPAN (Wave R Task 11). It always was upstream — `a2p` L419718 pushes it as a
// separate style/text pair, `s.push([i, Pm(" ", t - a)])`, carrying the ROW foreground and the band — and it
// had to become one here the moment the content stopped being a single string: a tokenized row ends on
// whatever colour its last token had, and letting the padding inherit that would hand 40 columns of the row
// to `string`-yellow. Nothing on screen moves: the fill is spaces, and its band and width are unchanged.
describe("renderDiff — bands and dimming (`H2p`, L419987–420003)", () => {
  it("paints add/remove rows with the theme's diff bands, right-padded to the FULL width — every span carrying the FORCED `text` foreground (L420000: the `is()[0]` term is always truthy, so a band never inherits ink's default)", () => {
    const out = renderDiff(patchOf([{ oldStart: 1, rows: [r("add", "hi")] }]), 20);
    expect(out).toEqual([{
      text: " 1 +hi              ",
      segments: [{ text: " 1 +", color: TEXT(), bg: ADDED() }, { text: "hi", color: TEXT(), bg: ADDED() }, { text: "              ", color: TEXT(), bg: ADDED() }],
    }]);
    expect(out[0]!.text).toHaveLength(20);
  });
  it("dims a context row's NUMBER GUTTER ONLY — its content is plain, and it carries no band (pack §6.7 correction)", () => {
    const out = renderDiff(patchOf([{ oldStart: 5, rows: [r("context", "ctx")] }]), 20);
    expect(out).toEqual([{
      text: " 5  ctx             ",
      segments: [{ text: " 5  ", color: TEXT(), dim: true }, { text: "ctx", color: TEXT() }, { text: "             ", color: TEXT() }],
    }]);
  });
});

describe("renderDiff — wrapping (`H2p` `width - gutter - 3`)", () => {
  it("wraps content and gives every continuation row a BLANK number gutter with the band repeated", () => {
    const out = renderDiff(patchOf([{ oldStart: 1, rows: [r("add", "aaaa bbbb cccc dddd")] }]), 20);
    expect(out.map((l) => l.text)).toEqual([
      " 1 +aaaa bbbb cccc  ",
      "   +dddd            ",
    ]);
    for (const line of out) for (const segment of line.segments!) expect(segment.bg).toBe(ADDED());
  });
});

describe("renderDiff — word diff (`shH` L419906 / `lhH` L419944, bail `ohH = 0.4` L420030)", () => {
  const pair = patchOf([{ oldStart: 3, rows: [r("remove", "const a = 1;"), r("add", "const a = 2;")] }]);
  it("paints only the CHANGED words with the word tokens, leaving the rest on the whole-line band", () => {
    const out = renderDiff(pair, 40);
    const removedRow = out[0]!, addedRow = out[1]!;
    expect(removedRow.segments!.filter((s) => s.bg === REMOVED_WORD()).map((s) => s.text)).toEqual(["1"]);
    expect(addedRow.segments!.filter((s) => s.bg === ADDED_WORD()).map((s) => s.text)).toEqual(["2"]);
    expect(removedRow.text).toBe(" 3 -const a = 1;".padEnd(40));
    expect(addedRow.text).toBe(" 3 +const a = 2;".padEnd(40));
    // Everything that is NOT a changed word still sits on the ordinary band, so the row reads as one strip.
    expect(new Set(removedRow.segments!.map((s) => s.bg))).toEqual(new Set([REMOVED(), REMOVED_WORD()]));
  });
  // The threshold is pinned from BOTH sides, straddling `ohH = 0.4` — a one-sided test (a full rewrite, which
  // scores 1.0) would go green with the constant moved anywhere below 1, and the bail is the whole reason a
  // rewritten line reads as one strip instead of confetti.
  const wordBgs = (out: readonly { segments?: { bg?: string }[] }[]) => new Set(out.flatMap((l) => l.segments!.map((s) => s.bg)));
  it("BAILS to whole-line banding just ABOVE the 0.4 changed fraction", () => {
    // "aaaa bbbb" → "aaaa cccc": 8 changed characters over 18 = 0.444.
    expect(wordBgs(renderDiff(patchOf([{ oldStart: 1, rows: [r("remove", "aaaa bbbb"), r("add", "aaaa cccc")] }]), 30))).toEqual(new Set([REMOVED(), ADDED()]));
    expect(wordBgs(renderDiff(patchOf([{ oldStart: 1, rows: [r("remove", "aaaa"), r("add", "bbbb")] }]), 30))).toEqual(new Set([REMOVED(), ADDED()]));
  });
  it("keeps the word diff just BELOW it", () => {
    // "aaaa bbbb cccc" → "aaaa bbbb dddd": 8 changed characters over 28 = 0.286.
    expect(wordBgs(renderDiff(patchOf([{ oldStart: 1, rows: [r("remove", "aaaa bbbb cccc"), r("add", "aaaa bbbb dddd")] }]), 30)))
      .toEqual(new Set([REMOVED(), ADDED(), REMOVED_WORD(), ADDED_WORD()]));
  });
  it("wraps the word-diff path ONE COLUMN WIDER than the plain path (pack §6.9 census correction)", () => {
    // Same 20-column budget, same 2-wide number cell, same 16-character content. `H2p` wraps at
    // width−gutter−3 = 15 and `lhH` at width−gutter−2 = 16, so this line is ONE row when it is word-diffed
    // and TWO when it is not — which is the whole visible consequence of the off-by-one the census missed.
    const changed = renderDiff(patchOf([{ oldStart: 3, rows: [r("remove", "aa bb cc dd ee P"), r("add", "aa bb cc dd ee Q")] }]), 20);
    expect(changed.map((l) => l.text)).toEqual([" 3 -aa bb cc dd ee P", " 3 +aa bb cc dd ee Q"]);
    const plain = renderDiff(patchOf([{ oldStart: 3, rows: [r("add", "aa bb cc dd ee Q")] }]), 20);
    expect(plain.map((l) => l.text.trimEnd())).toEqual([" 3 +aa bb cc dd ee", "   +Q"]);
  });
});

// Same discipline (and same reason) as `resolvePatch`'s own memo, which `diffSource.test.ts` pins with a
// read-count assertion: tool rows are uncached and `useChat` re-projects on a 600 ms blink, so an unmemoized
// renderer would re-run `diffWords` over every paired line of every Edit on screen about twice a second.
describe("renderDiff — memoized per patch, not per repaint", () => {
  const patch = patchOf([{ oldStart: 1, rows: [r("remove", "aaaa bbbb cccc"), r("add", "aaaa bbbb dddd")] }]);
  it("returns the SAME rows for a repeated call, and recomputes when the width moves", () => {
    expect(renderDiff(patch, 40)).toBe(renderDiff(patch, 40));
    expect(renderDiff(patch, 30)).not.toBe(renderDiff(patch, 40));
    expect(renderDiff(patch, 30)[0]!.text).toHaveLength(30);
  });
});

// ── EP-R5 (Wave R Task 11): the tokens inside the row ─────────────────────────────────────────────────
// L419813, verbatim: `E = y === "-" ? [[cWo(o), _]] : i2p(s, _, o)`. A REMOVED row is one flat style/text
// pair; every other row goes through the highlighter. THE PALETTE IS PASSED EXPLICITLY in every test here:
// `selectPalette()` reads `COLORTERM` off the real environment, so a default-argument assertion would pin
// Monokai on a truecolor developer terminal and the palette-index map in CI.
const scope = (palette: DiffPalette, name: string) => DIFF_SCOPES[palette].get(name)!;
const tsPatch = (kind: DiffLineRow["kind"], text: string): ResolvedPatch => ({ ...patchOf([{ oldStart: 1, rows: [r(kind, text)] }]), filePath: "/w/a.ts" });
const contentOf = (line: RenderLine): Segment[] => line.segments!.slice(1);

describe("renderDiff — syntax highlighting (`i2p` L419592, selected at L419813)", () => {
  it("tokenizes an ADDED row: many spans, differing foregrounds, ONE constant band, still full width", () => {
    const out = renderDiff(tsPatch("add", 'const x = "hi";'), 60, "dark");
    expect(out).toHaveLength(1);
    const line = out[0]!, content = contentOf(line);
    expect(line.segments![0]!.text).toBe(" 1 +");
    expect(content.map((s) => s.text).join("")).toBe('const x = "hi";'.padEnd(56));   // the row still reads as the row
    expect(line.text).toHaveLength(60);
    // `const` is `GmH`'s re-scope to `_storage`, the string keeps `string`, and the punctuation between them
    // falls through to the row foreground — three different colours where t10 painted one.
    expect(content.find((s) => s.text === "const")!.color).toBe(scope("dark", "_storage"));
    expect(content.find((s) => s.text === '"hi"')!.color).toBe(scope("dark", "string"));
    expect(content.find((s) => s.text === ";")!.color).toBe(TEXT());
    expect(new Set(content.map((s) => s.color)).size).toBeGreaterThan(1);
    expect(new Set(line.segments!.map((s) => s.bg))).toEqual(new Set([ADDED()]));      // the band is one strip
  });
  it("leaves a REMOVED row FLAT — one content span plus the fill, never a token (the `-` arm of L419813)", () => {
    const out = renderDiff(tsPatch("remove", 'const x = "hi";'), 60, "dark");
    expect(out[0]!.segments).toEqual([
      { text: " 1 -", color: TEXT(), bg: REMOVED() },
      { text: 'const x = "hi";', color: TEXT(), bg: REMOVED() },
      { text: " ".repeat(41), color: TEXT(), bg: REMOVED() },
    ]);
    expect(contentOf(out[0]!).filter((s) => s.text.trim() !== "")).toHaveLength(1);
  });
  it("tokenizes a CONTEXT row while keeping the gutter/content dim asymmetry — the number cell is dim, the tokens are not", () => {
    const out = renderDiff(tsPatch("context", "  return total + 1;"), 60, "dark");
    const line = out[0]!, content = contentOf(line);
    expect(line.segments![0]).toEqual({ text: " 1  ", color: TEXT(), dim: true });
    expect(content.find((s) => s.text === "return")!.color).toBe(scope("dark", "keyword"));
    expect(content.find((s) => s.text === "1")!.color).toBe(scope("dark", "number"));
    expect(content.every((s) => s.dim === undefined)).toBe(true);
    expect(content.every((s) => s.bg === undefined)).toBe(true);                       // a context row has no band
  });
  // A11. Task 10 threaded `patch.filePath` and left it unread; this is the assertion that it is now read —
  // a bare `Dockerfile` has no extension, so it can only be highlighted through `X$p`'s filename map.
  it("detects the language from a BARE FILENAME: an edit to `Dockerfile` is highlighted as dockerfile (`X$p` L419856)", () => {
    const patch: ResolvedPatch = { ...patchOf([{ oldStart: 1, rows: [r("add", "FROM node:20-alpine")] }]), filePath: "/srv/Dockerfile" };
    const content = contentOf(renderDiff(patch, 60, "dark")[0]!);
    expect(content.find((s) => s.text === "FROM")!.color).toBe(scope("dark", "keyword"));
    expect(content.find((s) => s.text === "20")!.color).toBe(scope("dark", "number"));
  });
  it("paints nothing but the row foreground when the path names no language, and when there is no path at all", () => {
    const unknown: ResolvedPatch = { ...patchOf([{ oldStart: 1, rows: [r("add", "FROM node:20-alpine")] }]), filePath: "/srv/notes.qqqq" };
    expect(contentOf(renderDiff(unknown, 60, "dark")[0]!).every((s) => s.color === TEXT())).toBe(true);
    const pathless = patchOf([{ oldStart: 1, rows: [r("add", 'const x = "hi";')] }]);
    expect(contentOf(renderDiff(pathless, 60, "dark")[0]!).every((s) => s.color === TEXT())).toBe(true);
  });
  // A10. The three maps are pinned wholesale in `diff-highlight.test.ts`; what this pins is that the palette
  // reaches the ROW — that a light theme repaints the same token and a non-truecolor terminal degrades to a
  // palette INDEX rather than to no colour at all.
  it("carries the palette all the way to the row: dark, light and the 256-colour fallback each paint the same token differently (`K$p`/`Y$p`/`jmH`, L419855)", () => {
    const keywordOf = (palette: DiffPalette) => contentOf(renderDiff(tsPatch("add", 'const x = "hi";'), 60, palette)[0]!).find((s) => s.text === "const")!.color;
    expect(keywordOf("dark")).toBe(scope("dark", "_storage"));
    expect(keywordOf("light")).toBe(scope("light", "_storage"));
    expect(keywordOf("dark")).not.toBe(keywordOf("light"));
    expect(keywordOf("ansi256")).toMatch(/^ansi256\(\d+\)$/);                          // an index, not a quantised hex
  });
  it("carries tokens across a WRAP, keeps every wrapped row banded to the full width, and loses no text", () => {
    const source = 'const alpha = "one"; const beta = "two";';
    const out = renderDiff({ ...patchOf([{ oldStart: 1, rows: [r("add", source)] }]), filePath: "/w/a.ts" }, 26, "dark");
    expect(out.length).toBeGreaterThan(1);
    for (const line of out) { expect(line.text).toHaveLength(26); for (const s of line.segments!) expect(s.bg).toBe(ADDED()); }
    // Both keywords survive the re-slice, on whichever rows they landed…
    expect(out.flatMap((l) => contentOf(l)).filter((s) => s.color === scope("dark", "_storage")).map((s) => s.text)).toEqual(["const", "const"]);
    // …and the rows still rejoin to the source: wrapping may only move the break whitespace, never eat a token.
    expect(out.map((l) => l.text.slice(4).trimEnd()).join(" ")).toBe(source);
  });
});

// Tokenizing is by far the most expensive thing on this path — hljs parses every added and context line —
// and `useChat` re-projects the whole transient region on a 600 ms cursor blink. The patch-identity memo is
// what keeps that off the frame budget, so this pins that the memo actually covers the tokenizer, not just
// the row arithmetic. (Counting the loader's own `highlight` calls, not row identity: identity alone would
// stay green if a future refactor tokenized eagerly and then cached.)
describe("renderDiff — the highlighter runs once per patch, not once per frame", () => {
  afterEach(() => setHljsLoaderForTest());
  it("does not re-tokenize a repeat render, and does re-tokenize when the width moves", () => {
    let calls = 0;
    setHljsLoaderForTest(() => ({ ...hljsReal, highlight: ((...args: Parameters<typeof hljsReal.highlight>) => { calls++; return hljsReal.highlight(...args); }) as typeof hljsReal.highlight }));
    const patch: ResolvedPatch = { ...patchOf([{ oldStart: 1, rows: [r("add", "const x = 1;"), r("context", "const y = 2;")] }]), filePath: "/w/a.ts" };
    renderDiff(patch, 40, "dark");
    expect(calls).toBe(2);                                                             // one per non-`-` row
    renderDiff(patch, 40, "dark");
    expect(calls).toBe(2);                                                             // the frame after: nothing
    renderDiff(patch, 30, "dark");
    expect(calls).toBe(4);                                                             // a resize is a real recompute
  });
});

describe("renderDiff — hunks, approximation and the death of the cap", () => {
  it("joins hunks with a DIM `...` line and emits no `@@` header anywhere (`K3e`, L420118)", () => {
    const out = renderDiff(patchOf([
      { oldStart: 1, rows: [r("context", "a")] },
      { oldStart: 90, rows: [r("context", "b")] },
    ]), 20);
    expect(out.map((l) => l.text.trimEnd())).toEqual([" 1  a", "...", " 90  b"]);
    expect(out[1]).toEqual({ text: "...", dim: true });
    expect(out.some((l) => l.text.includes("@@"))).toBe(false);
  });
  it("marks APPROXIMATE numbering with a visible `~` in the number gutter, seeded 1-based per hunk", () => {
    const out = renderDiff(patchOf([{ oldStart: undefined, rows: [r("context", "a"), r("remove", "b"), r("add", "c")] }], "approximate"), 20);
    expect(out.map((l) => l.text.trimEnd())).toEqual(["~ 1  a", "~ 2 -b", "~ 2 +c"]);
  });
  it("renders EVERY row of a 60-row patch — there is no cap and no `… N more lines` marker", () => {
    const rows = Array.from({ length: 60 }, (_, i) => r(i % 2 === 0 ? "add" : "context", `line ${i}`));
    const out = renderDiff(patchOf([{ oldStart: 1, rows }]), 60);
    expect(out).toHaveLength(60);
    expect(out.some((l) => l.text.includes("more lines") || l.text.includes("ctrl+o"))).toBe(false);
  });
});
