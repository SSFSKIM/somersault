// test/unit/highlight.test.ts — zero-dep syntax highlighter (Task 9 brief): keywords/strings/comments/
// numbers styled, unknown lang → single dim segment, indentation preserved, no double-styling of an
// overlapping construct (keyword inside a string, // inside a string).
import { describe, it, expect } from "vitest";
import { highlightCode } from "../../src/tui/highlight.js";

describe("highlightCode", () => {
  it("colors a keyword", () => {
    const out = highlightCode("const x = 1", "ts");
    const kw = out.find((s) => s.text === "const");
    expect(kw).toBeDefined();
    expect(kw!.color).toBeTruthy();
  });
  it("colors a number distinctly from a keyword", () => {
    const out = highlightCode("const x = 1", "ts");
    const num = out.find((s) => s.text === "1");
    expect(num).toBeDefined();
    expect(num!.color).toBeTruthy();
    expect(num!.color).not.toBe(out.find((s) => s.text === "const")!.color);
  });
  it("strings are colored green, whole literal in one segment", () => {
    expect(highlightCode('"hi"', "ts")).toEqual([{ text: '"hi"', color: "green" }]);
  });
  it("a line comment is dim for its whole rest", () => {
    expect(highlightCode("// note", "ts")).toEqual([{ text: "// note", dim: true }]);
  });
  it("a python comment (# marker) is dim for its whole rest", () => {
    expect(highlightCode("# note", "py")).toEqual([{ text: "# note", dim: true }]);
  });
  it("unknown lang → a single dim segment carrying the whole line", () => {
    expect(highlightCode("fn main() {}", "rust")).toEqual([{ text: "fn main() {}", dim: true }]);
  });
  it("leading indentation survives intact in the first segment", () => {
    const out = highlightCode("  const x = 1;", "ts");
    expect(out[0].text.startsWith("  ")).toBe(true);
    expect(out.map((s) => s.text).join("")).toBe("  const x = 1;");
  });
  it("a keyword inside a string is NOT separately colored (outermost construct — the string — wins)", () => {
    const out = highlightCode('const s = "return true"', "ts");
    const str = out.find((s) => s.text === '"return true"');
    expect(str).toBeDefined();
    expect(str!.color).toBe("green");
    // the whole string is ONE segment: no separate "return"/"true" keyword segment inside it
    expect(out.some((s) => s.text === "return")).toBe(false);
    expect(out.some((s) => s.text === "true")).toBe(false);
  });
  it("a // sequence inside a string is NOT treated as a comment", () => {
    const out = highlightCode('const url = "http://example.com"', "ts");
    const str = out.find((s) => s.text === '"http://example.com"');
    expect(str).toBeDefined();
    expect(str!.color).toBe("green");
    expect(out.some((s) => s.dim)).toBe(false);   // no comment segment anywhere
  });
  it("segments always reconstruct the original line exactly (no dropped/duplicated characters)", () => {
    const cases: [string, string][] = [
      ["const x = 1", "ts"],
      ['const s = "a // b" // real comment', "ts"],
      ["  def foo(x):", "py"],
      ["# just a comment", "py"],
    ];
    for (const [l, lang] of cases) expect(highlightCode(l, lang).map((s) => s.text).join("")).toBe(l);
  });
});
