// test/tui/diffRender.test.ts — F4 Task 7: the diff renderer. Every constant asserted here is quoted from the
// F4 constants pack §6 (bundle `~/claude-code-bundle/2.1.220/cli.pretty.js`): the header JSX `fbn` (L423885–902),
// the hunk separator `K3e` (L420118), the numbering `chH` (L420004) INCLUDING its remove-run rewind, the band/
// gutter/wrap block `H2p` (L419987), the remove/add pairing `shH` (L419906) and the word diff `lhH` (L419944)
// with its `ohH = 0.4` bail (L420030). The pack corrects two census readings this file pins directly: only a
// context row's NUMBER GUTTER is dimmed (its content is not), and the word-diff path wraps ONE COLUMN WIDER
// than the plain path. There is NO line cap anywhere — the 24-row cap died with `toolDiffLines`.
import { describe, expect, it } from "vitest";
import { diffHeader, renderDiff } from "../../src/tui/diffRender.js";
import type { DiffLineRow, ResolvedPatch } from "../../src/tui/diffSource.js";
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

describe("renderDiff — bands and dimming (`H2p`, L419987–420003)", () => {
  it("paints add/remove rows with the theme's diff bands, right-padded to the FULL width — every span carrying the FORCED `text` foreground (L420000: the `is()[0]` term is always truthy, so a band never inherits ink's default)", () => {
    const out = renderDiff(patchOf([{ oldStart: 1, rows: [r("add", "hi")] }]), 20);
    expect(out).toEqual([{
      text: " 1 +hi              ",
      segments: [{ text: " 1 +", color: TEXT(), bg: ADDED() }, { text: "hi              ", color: TEXT(), bg: ADDED() }],
    }]);
    expect(out[0]!.text).toHaveLength(20);
  });
  it("dims a context row's NUMBER GUTTER ONLY — its content is plain, and it carries no band (pack §6.7 correction)", () => {
    const out = renderDiff(patchOf([{ oldStart: 5, rows: [r("context", "ctx")] }]), 20);
    expect(out).toEqual([{
      text: " 5  ctx             ",
      segments: [{ text: " 5  ", color: TEXT(), dim: true }, { text: "ctx             ", color: TEXT() }],
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
