// test/unit/highlight.test.ts — zero-dep syntax highlighter (Task 9 brief): keywords/strings/comments/
// numbers styled, unknown lang → single dim segment, indentation preserved, no double-styling of an
// overlapping construct (keyword inside a string, // inside a string).
import { describe, it, expect } from "vitest";
import { highlightCode } from "../../src/tui/highlight.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

// F4 Task 3 re-pinned the scope colours to upstream's hljs map `DhH` (constants pack §1.10, bundle
// L420495): keyword `vt.blue`, string `vt.red`, number `vt.green`, comment `vt.green`. That map is built
// from CHALK CONSTANTS, so it is theme-INDEPENDENT — these are bare ANSI names, not theme tokens, and they
// do not move when /theme does (a recorded divergence, see the parity doc). `inactive` remains a theme
// token for the one role with no upstream counterpart: the unknown-language fallback.
const KEYWORD = "blue", STRING = "red", NUMBER = "green", COMMENT = "green";
const tok = (name: "inactive") => resolveThemeColor(themeTokens()[name]);

describe("highlightCode", () => {
  it("colors a keyword `blue` (DhH `keyword: vt.blue`)", () => {
    const out = highlightCode("const x = 1", "ts");
    const kw = out.find((s) => s.text === "const");
    expect(kw).toBeDefined();
    expect(kw!.color).toBe(KEYWORD);
  });
  it("colors a number `green` (DhH `number: vt.green`), distinctly from a keyword", () => {
    const out = highlightCode("const x = 1", "ts");
    const num = out.find((s) => s.text === "1");
    expect(num).toBeDefined();
    expect(num!.color).toBe(NUMBER);
    expect(num!.color).not.toBe(out.find((s) => s.text === "const")!.color);
  });
  it("string literals are `red` (DhH `string: vt.red`), whole literal in one segment", () => {
    expect(highlightCode('"hi"', "ts")).toEqual([{ text: '"hi"', color: STRING }]);
  });
  it("a line comment is `green` (DhH `comment: vt.green`) for its whole rest", () => {
    expect(highlightCode("// note", "ts")).toEqual([{ text: "// note", color: COMMENT, dim: true }]);
  });
  it("a python comment (# marker) takes the same `green` for its whole rest", () => {
    expect(highlightCode("# note", "py")).toEqual([{ text: "# note", color: COMMENT, dim: true }]);
  });
  it("unknown lang → a single dim `inactive` segment carrying the whole line", () => {
    expect(highlightCode("fn main() {}", "rust")).toEqual([{ text: "fn main() {}", color: tok("inactive"), dim: true }]);
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
    expect(str!.color).toBe(STRING);
    // the whole string is ONE segment: no separate "return"/"true" keyword segment inside it
    expect(out.some((s) => s.text === "return")).toBe(false);
    expect(out.some((s) => s.text === "true")).toBe(false);
  });
  it("a // sequence inside a string is NOT treated as a comment", () => {
    const out = highlightCode('const url = "http://example.com"', "ts");
    const str = out.find((s) => s.text === '"http://example.com"');
    expect(str).toBeDefined();
    expect(str!.color).toBe(STRING);
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
