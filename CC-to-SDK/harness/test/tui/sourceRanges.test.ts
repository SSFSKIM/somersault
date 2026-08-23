// test/tui/sourceRanges.test.ts — F10 T-SELECT S4a: wrap-time SOURCE-character ranges, minted where the
// split points are known (`wrapItems.ts`'s `sourceRowRanges`) and BEFORE any cosmetic padding is added.
// Newline ownership is per HARD LINE (plan review): the `\n` terminating a hard line rides that line's own
// LAST painted row, which a cursor walking the flat painted-row list gets wrong around blank lines.
import { describe, it, expect } from "vitest";
import stringWidth from "string-width";
import { sourceRowRanges, wrapRows, wrapLine, wrapItem } from "../../src/tui/wrapItems.js";

describe("F10 S4 — sourceRowRanges: the ranges are contiguous, half-open, and cover the whole source", () => {
  const cover = (text: string, width: number) => {
    const rows = wrapRows(text, width);
    const ranges = sourceRowRanges(text, width);
    expect(ranges.length).toBe(rows.length);
    expect(ranges[0]!.start).toBe(0);
    expect(ranges[ranges.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.start).toBe(ranges[i - 1]!.end);
    return { rows, ranges };
  };
  it("an unbroken token split hard keeps every character", () => {
    const { rows, ranges } = cover("x".repeat(25), 10);
    expect(rows.length).toBe(3);
    expect(ranges.map((r) => [r.start, r.end])).toEqual([[0, 10], [10, 20], [20, 25]]);
  });
  it("a word break leaves no character unaddressed", () => {
    // `trim: false` keeps the break space on the PRECEDING row today; the contract asserted here is the
    // contiguity, which holds either way and is what the upper-endpoint containment rule relies on.
    const { ranges } = cover("alpha beta gamma", 11);
    expect(ranges[0]!.end).toBe(ranges[1]!.start);
    expect("alpha beta gamma".slice(ranges[1]!.start, ranges[1]!.end)).toContain("gamma");
  });
  it("a hard newline in the source is a row boundary and the \\n rides the preceding row", () => {
    const { rows, ranges } = cover("one\ntwo", 40);
    expect(rows).toEqual(["one", "two"]);
    expect(ranges).toEqual([{ start: 0, end: 4 }, { start: 4, end: 7 }]);
  });
});

describe("F10 S4 — blank hard lines: each \\n rides ITS OWN line's last row (plan review)", () => {
  it("consecutive empty lines do not collect their neighbours' separators", () => {
    // "one\n\ntwo" paints ["one", "", "two"]. The cursor-only walk charged BOTH newlines to the blank row
    // and left `one` owning none, which mis-remaps every endpoint at the boundary.
    expect(sourceRowRanges("one\n\ntwo", 40)).toEqual([{ start: 0, end: 4 }, { start: 4, end: 5 }, { start: 5, end: 8 }]);
  });
  it("a trailing newline rides the line it terminates, and the trailing blank row is empty", () => {
    expect(sourceRowRanges("one\n", 40)).toEqual([{ start: 0, end: 4 }, { start: 4, end: 4 }]);
  });
  it("three empty lines in a row each own exactly one separator", () => {
    expect(sourceRowRanges("\n\n\n", 40)).toEqual([
      { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 3 },
    ]);
  });
  it("a WRAPPED hard line followed by a blank one still charges the \\n to the wrapped line's LAST row", () => {
    const text = "x".repeat(25) + "\n\nend";
    const ranges = sourceRowRanges(text, 10);
    expect(ranges.slice(0, 3)).toEqual([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 20, end: 26 }]);
    expect(ranges[3]).toEqual({ start: 26, end: 27 });
    expect(ranges[ranges.length - 1]!.end).toBe(text.length);
  });
});

describe("F10 S4 — wrapLine attaches the source range, pad included", () => {
  it("a gutter-carrying line indents its continuations and records the pad", () => {
    // `wrapItems.ts:66` states it outright: `"⏺ "` is THREE columns and two characters, and `pad` is
    // `" ".repeat(stringWidth(gutter))`. Pin the measurement rather than hardcoding a count — a hand-typed
    // 2 here would be a test that can only pass by breaking the existing width contract (plan review).
    const gutterCols = stringWidth("⏺ ");
    expect(gutterCols).toBe(3);
    const rows = wrapLine({ text: "x".repeat(25), gutter: { text: "⏺ " } }, 13);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]!.source).toEqual({ start: 0, end: expect.any(Number), pad: 0 });
    expect(rows[1]!.source!.pad).toBe(gutterCols);
    expect(rows[1]!.source!.start).toBe(rows[0]!.source!.end);
  });
});

describe("F10 S4 — a gutter block's ranges are absolute within its canonical text (\\n between hard rows)", () => {
  it("the second body line starts one past the first line's length", () => {
    const item = { kind: "gutter-block" as const, id: "b1", gutter: "  ⎿  ",
      body: [{ text: "x".repeat(20) }, { text: "second" }] };
    const [wrapped] = wrapItem(item as never, 14) as never[];
    const body = (wrapped as { body: { source?: { start: number; end: number } }[] }).body;
    const last = body[body.length - 1]!;
    expect(last.source!.start).toBe(20 + 1);                   // 20 chars + the \n separator
    expect(last.source!.end).toBe(20 + 1 + "second".length);
  });
});
