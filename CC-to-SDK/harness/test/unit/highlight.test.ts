// test/unit/highlight.test.ts — F9 T-SYNTAX Task 2. Replaces the zero-dep ten-language lexer's pins with
// the real hljs singleton's: the full 36-scope canon table (`jsw` L523111, spec §T-SYNTAX/S2), the
// suffix-trimming lookup (`zsw` L523068), whole-block highlighting (multi-line comments colour correctly —
// a line-at-a-time lexer cannot even represent that), and the one `supportsLanguage` predicate that now
// answers both "can we colour this" and "does upstream label this" (`KNOWN_LANGS`/`UPSTREAM_LANGS` both
// gone). Keyless: real hljs, no network, no mocked loader — the same discipline `diff-highlight.test.ts`
// already uses for the sibling scope maps.
import { describe, it, expect } from "vitest";
import { highlightBlock, supportsLanguage, scopeStyle, SCOPE_STYLES } from "../../src/tui/highlight.js";

describe("scope map (canon jsw, 36 scopes)", () => {
  it("pins the COMPLETE map: exactly 36 entries, every key from the spec table", () => {
    const CANON_KEYS = [
      "keyword", "literal", "class", "title.class", "name",
      "built_in", "attr",
      "type",
      "number", "comment", "doctag", "addition",
      "regexp", "string", "deletion",
      "function", "title.function",
      "meta", "tag",
      "emphasis", "strong", "link",
      "subst", "symbol", "title", "params", "meta-keyword", "meta-string", "meta.keyword", "meta.string",
      "section", "attribute", "variable", "bullet", "code", "quote",
    ];
    expect(CANON_KEYS).toHaveLength(36);
    expect(Object.keys(SCOPE_STYLES).sort()).toEqual([...CANON_KEYS].sort());
  });

  it("highlightBlock itself resolves through suffix-trim + inheritance (not only scopeStyle)", () => {
    // `title.function` reached through a real ts grammar — the yellow has to land on the emitted node's
    // OWN text through walkEmitter's tree walk, not merely through a direct scopeStyle() call.
    const fn = highlightBlock("function foo() { return 1; }", "ts").flat();
    expect(fn.some((s) => s.color === "yellow" && s.text === "foo")).toBe(true);
    // markdown's own inline scopes exercise the non-colour axes: `strong`/`emphasis` carry bold/italic
    // THROUGH the walk, proving the resolver sets those fields rather than only ever setting `color`.
    const md = highlightBlock("**bold** and _italic_", "markdown").flat();
    expect(md.some((s) => s.bold === true && s.text.includes("bold"))).toBe(true);
    expect(md.some((s) => s.italic === true && s.text.includes("italic"))).toBe(true);
  });

  it("maps the exact canon table", () => {
    expect(scopeStyle("keyword")).toEqual({ color: "blue" });
    expect(scopeStyle("built_in")).toEqual({ color: "cyan" });
    expect(scopeStyle("type")).toEqual({ color: "cyan", dim: true });
    expect(scopeStyle("comment")).toEqual({ color: "green" });
    expect(scopeStyle("string")).toEqual({ color: "red" });
    expect(scopeStyle("function")).toEqual({ color: "yellow" });
    expect(scopeStyle("meta")).toEqual({ color: "grey" });
    expect(scopeStyle("emphasis")).toEqual({ italic: true });
    expect(scopeStyle("strong")).toEqual({ bold: true });
    expect(scopeStyle("link")).toEqual({ underline: true });
    expect(scopeStyle("subst")).toEqual({}); // reset row
  });

  it("suffix-trims after the LAST dot, repeatedly (canon zsw)", () => {
    // title.class is its own entry (blue); title.class.inherited must fall back to it, not to `title`
    expect(scopeStyle("title.class.inherited")).toEqual(scopeStyle("title.class"));
    // title.function.x -> title.function (yellow)
    expect(scopeStyle("title.function.x")).toEqual({ color: "yellow" });
    // hljs- prefix stripped first
    expect(scopeStyle("hljs-keyword")).toEqual({ color: "blue" });
    expect(scopeStyle("nonsense")).toBeUndefined();
  });
});

describe("highlightBlock", () => {
  it("colours rust (previously outside the 10)", () => {
    const lines = highlightBlock('fn main() { let x = "s"; }', "rust");
    const flat = lines.flat();
    expect(flat.some((s) => s.color === "blue" && s.text.includes("fn"))).toBe(true);
    expect(flat.some((s) => s.color === "red" && s.text.includes('"s"'))).toBe(true);
  });
  it("colours a block comment across lines (whole-block proof)", () => {
    const lines = highlightBlock("/*a\nb\nc*/", "c");
    expect(lines).toHaveLength(3);
    for (const line of lines) for (const seg of line) expect(seg.color).toBe("green");
  });
  it("unknown language returns plain lines", () => {
    const lines = highlightBlock("x y", "notalang");
    expect(lines).toEqual([[{ text: "x y" }]]);
  });
  it("segments rejoin to the input per line", () => {
    const src = 'const a = `t${x}` // hi';
    expect(highlightBlock(src, "ts")[0]!.map((s) => s.text).join("")).toBe(src);
  });
});

describe("one language set", () => {
  it("supportsLanguage replaces KNOWN_LANGS and UPSTREAM_LANGS", () => {
    for (const t of ["rust", "go", "yml", "shellsession", "php8"]) expect(supportsLanguage(t)).toBe(true);
    expect(supportsLanguage("notalang")).toBe(false);
  });
});
