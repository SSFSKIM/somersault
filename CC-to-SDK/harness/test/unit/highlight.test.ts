// test/unit/highlight.test.ts — zero-dep syntax highlighter (Task 9 brief): keywords/strings/comments/
// numbers styled, unknown lang → single dim segment, indentation preserved, no double-styling of an
// overlapping construct (keyword inside a string, // inside a string).
import { describe, it, expect } from "vitest";
import { highlightCode } from "../../src/tui/highlight.js";

// F4 Task 3 re-pinned the scope colours to upstream's hljs map `DhH` (constants pack §1.10, bundle
// L420495): keyword `vt.blue`, string `vt.red`, number `vt.green`, comment `vt.green`. That map is built
// from CHALK CONSTANTS, so it is theme-INDEPENDENT — these are bare ANSI names, not theme tokens, and they
// do not move when /theme does (a recorded divergence, see the parity doc). The fix round finished the job:
// `comment` is FLAT green (no `dim`, which `DhH` never had), and the last theme-token role — the dim
// `inactive` unknown-language fallback — is gone, so this module imports no theme at all.
const KEYWORD = "blue", STRING = "red", NUMBER = "green", COMMENT = "green";

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
  it("a line comment is FLAT `green` (DhH `comment: vt.green` carries no dim) for its whole rest", () => {
    expect(highlightCode("// note", "ts")).toEqual([{ text: "// note", color: COMMENT }]);
  });
  it("a python comment (# marker) takes the same flat `green` for its whole rest", () => {
    expect(highlightCode("# note", "py")).toEqual([{ text: "# note", color: COMMENT }]);
  });
  it("unknown lang → one PLAIN segment (hljs's unscoped `plaintext`), no theme token anywhere", () => {
    // The old dim `inactive` fallback was dead code: both call sites (markdown's `codeRuns`, toolSummaries'
    // `previewRows`) gate on KNOWN_LANGS before calling. Dropping it sheds the `theme.js` import, so this
    // module is now literally theme-independent, not merely theme-independent in its four scope colours.
    expect(highlightCode("fn main() {}", "rust")).toEqual([{ text: "fn main() {}" }]);
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
    // No comment segment anywhere. `dim` no longer marks one (the fix round dropped it), so the pin is on
    // the comment COLOUR — safe here because the line holds no number, `green`'s only other source.
    expect(out.some((s) => s.color === COMMENT)).toBe(false);
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
