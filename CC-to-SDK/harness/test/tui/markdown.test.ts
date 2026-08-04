import { describe, expect, it } from "vitest";
import { renderMarkdown, type MarkdownOptions } from "../../src/tui/markdown.js";
import { inlineSegments, strikethroughSupported } from "../../src/tui/markdownInline.js";
import type { Segment } from "../../src/tui/render.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const lines = (s: string, o?: MarkdownOptions) => renderMarkdown(s, o);
const texts = (s: string, o?: MarkdownOptions) => lines(s, o).map((l) => l.text);
const tok = (name: "permission" | "suggestion" | "warning" | "inactive") => resolveThemeColor(themeTokens()[name]);

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
    expect(texts("* item")[0]).toBe("- item");
  });
  it("ordered honours start and depth numbering 1./a./i.", () => {
    expect(texts("3. third\n4. fourth")).toEqual(["3. third", "4. fourth"]);
    // The marker depth is the CHILD depth, offset ONE from the indent depth: bundle L420647 (`case "list"`
    // passes its own n to its items) → L420650 (`list_item` renders children at n + 1) → L420653 (indent uses
    // n) → L420665 (`JhH(n, o)` is computed inside the text CHILD, whose n is already incremented). So the
    // 2-col indent level k carries the marker style of level k+1: arabic, letters, roman, arabic (default).
    const nested = texts("1. a\n   1. b\n      1. c\n         1. d");
    expect(nested[0]).toBe("1. a");                      // indent 0 → JhH(1) → arabic
    expect(nested[1]).toBe("  a. b");                    // indent 1 → JhH(2) → letters
    expect(nested[2]).toBe("    i. c");                  // indent 2 → JhH(3) → roman
    expect(nested[3]).toBe("      1. d");                // indent 3 → JhH(4) → arabic (the `default`)
  });
  it("task list renders literal checkbox text", () => {
    expect(texts("- [x] done\n- [ ] open")).toEqual(["- [x] done", "- [ ] open"]);
  });
  it("a LOOSE task list boxes each item exactly once (marked 18 nests `checkbox` in the paragraph too)", () => {
    // No blank line between the two items: marked emits NO `space` token inside a loose list (the loose-ness
    // shows only as `paragraph` item children), and upstream's paragraph case is content + ONE `aW`
    // (pack §1.1 L420655) — so the loose list renders exactly like the tight one, boxed once per line.
    const t = texts("- [x] a\n\n- [ ] b");
    expect(t).toEqual(["- [x] a", "- [ ] b"]);
    for (const l of t) expect(l.match(/\[[x ]\]/g)!.length).toBe(1);
  });
  it("hr is the literal ---", () => { expect(texts("above\n\n---\n\nbelow")).toContain("---"); });
  it("blockquote: dim ▎ rail, italic content", () => {
    const q = lines("> quoted");
    const first = q[0];
    expect(first.text.startsWith("▎ ")).toBe(true);
    const content = first.segments ? first.segments[first.segments.length - 1] : first;
    expect(content.italic).toBe(true);
    expect(first.segments![0]).toEqual({ text: "▎ ", dim: true });
  });
  it("a heading INSIDE a blockquote drops its post-heading `space` too — exactly one blank", () => {
    // the bundle's heading regex (L161565) swallows the trailing newlines, so no `space` token exists there
    // at ANY nesting level; the drop must therefore apply to nested walks, not only the top-level token list.
    expect(texts("> # H\n>\n> body")).toEqual(["▎ H", "", "▎ body"]);
  });
  it("a `space` token becomes exactly one blank line between paragraphs (f2, NOT gap:1)", () => {
    expect(texts("para one\n\npara two")).toEqual(["para one", "", "para two"]);
  });
  it("gap:1 fires only at prose-run/table/blockquote chunk boundaries — one blank line, never two", () => {
    const t = texts("before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter");
    // prose chunk, ONE blank, table lines, ONE blank, prose chunk — no doubled blanks anywhere
    expect(t.filter((x, i) => x === "" && t[i + 1] === "")).toEqual([]);
    expect(t[0]).toBe("before"); expect(t[1]).toBe(""); expect(t[t.length - 1]).toBe("after");
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
    expect(texts("hello\nworld")).toEqual(["hello", "world"]);
  });
  it("dim option dims every SEGMENT (Line.tsx ignores line-level dim when segments exist)", () => {
    for (const l of lines("**b** and plain", { dim: true }))
      expect((l.segments ?? [l as unknown as Segment]).every((s) => s.dim)).toBe(true);
  });

  it("a codespan takes the `permission` theme token", () => {
    const l = lines("see `x` here")[0];
    expect(l.segments).toEqual([{ text: "see " }, { text: "x", color: tok("permission") }, { text: " here" }]);
  });
  it("a whole-line single style folds into the line (no segments array)", () => {
    expect(lines("**bold**")).toEqual([{ text: "bold", bold: true }]);
    expect(lines("*it*")).toEqual([{ text: "it", italic: true }]);
  });
  it("a list marker rides as a plain leading segment when the item has inline styling", () => {
    expect(lines("- use `foo`")).toEqual([
      { text: "- use foo", segments: [{ text: "- " }, { text: "use " }, { text: "foo", color: tok("permission") }] },
    ]);
  });
  it("a nested list keeps its parent item line and indents children", () => {
    expect(texts("- outer\n  - inner")).toEqual(["- outer", "  - inner"]);
  });
  it("a blockquote is its own chunk: one blank line either side of surrounding prose", () => {
    expect(texts("before\n\n> quoted\n\nafter")).toEqual(["before", "", "▎ quoted", "", "after"]);
  });
  it("fenced code: known language highlights, unknown stays dim `inactive` (Task 3 moves it flush-left)", () => {
    expect(lines("```ts\nconst x = 1;\n```")).toEqual([
      { text: "  const x = 1;", segments: [{ text: "  " }, { text: "const", color: tok("suggestion") }, { text: " x = " }, { text: "1", color: tok("warning") }, { text: ";" }] },
    ]);
    expect(lines("```\nplain text\n```")).toEqual([{ text: "  plain text", color: tok("inactive"), dim: true }]);
    expect(lines("```rust\nfn main() {}\n```")).toEqual([{ text: "  fn main() {}", color: tok("inactive"), dim: true }]);
  });
  it("a table falls through to raw pipe lines until Task 4's renderTable", () => {
    expect(texts("| a | b |\n|---|---|\n| 1 | 2 |")).toEqual(["| a | b |", "|---|---|", "| 1 | 2 |"]);
  });
  it("a lone `|`-containing prose line is NOT a table", () => {
    expect(texts("just a | pipe")).toEqual(["just a | pipe"]);
  });
});

describe("F4 markdown — inline walker", () => {
  it("strikethroughSupported is exported (Task 3 fills the dHn allowlist)", () => {
    expect(typeof strikethroughSupported()).toBe("boolean");
  });
  it("del applies strikethrough to its children", () => {
    const l = lines("~~gone~~")[0];
    expect(l).toMatchObject({ text: "gone", strikethrough: true });
  });
  it("inlineSegments accumulates the incoming style down the tree", () => {
    const segs = inlineSegments([{ type: "strong", raw: "**a**", text: "a", tokens: [{ type: "text", raw: "a", text: "a" }] } as never], { dim: true });
    expect(segs).toEqual([{ dim: true, bold: true, text: "a" }]);
  });
});
