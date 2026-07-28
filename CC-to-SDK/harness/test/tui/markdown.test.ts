import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/tui/markdown.js";

describe("renderMarkdown", () => {
  it("plain text passes through unchanged, one line each", () => {
    expect(renderMarkdown("hello\nworld")).toEqual([{ text: "hello" }, { text: "world" }]);
  });
  it("whole-line bold / italic / inline-code take that style", () => {
    expect(renderMarkdown("**bold**")).toEqual([{ text: "bold", bold: true }]);
    expect(renderMarkdown("__bold__")).toEqual([{ text: "bold", bold: true }]);
    expect(renderMarkdown("*it*")).toEqual([{ text: "it", italic: true }]);
    expect(renderMarkdown("`code`")).toEqual([{ text: "code", color: "cyan" }]);
  });
  it("headers become bold with the # stripped", () => {
    expect(renderMarkdown("# Title")).toEqual([{ text: "Title", bold: true }]);
    expect(renderMarkdown("### Sub")).toEqual([{ text: "Sub", bold: true }]);
  });
  it("plain bullet / numbered get a • / keep the number (no inline markup → bare line)", () => {
    expect(renderMarkdown("- item")).toEqual([{ text: "• item" }]);
    expect(renderMarkdown("* item")).toEqual([{ text: "• item" }]);
    expect(renderMarkdown("1. first")).toEqual([{ text: "1. first" }]);
  });
  it("blockquote → dim with a │ prefix", () => {
    expect(renderMarkdown("> quoted")).toEqual([{ text: "│ quoted", dim: true }]);
  });
  it("fenced code → fences dropped, body dim + indented", () => {
    expect(renderMarkdown("```\nconst x = 1;\n```")).toEqual([{ text: "  const x = 1;", dim: true }]);
  });
  it("a mixed-style line carries per-span segments (text is the plain fallback)", () => {
    expect(renderMarkdown("**bold** and normal")).toEqual([
      { text: "bold and normal", segments: [{ text: "bold", bold: true }, { text: " and normal" }] },
    ]);
    expect(renderMarkdown("see `x` here")).toEqual([
      { text: "see x here", segments: [{ text: "see " }, { text: "x", color: "cyan" }, { text: " here" }] },
    ]);
  });
  it("a bullet with an inline span keeps the • marker as a plain leading segment", () => {
    expect(renderMarkdown("- use `foo`")).toEqual([
      { text: "• use foo", segments: [{ text: "• " }, { text: "use " }, { text: "foo", color: "cyan" }] },
    ]);
  });
  it("inline italic + bold mix in one line", () => {
    const out = renderMarkdown("run *fast* and **safe**");
    expect(out[0].segments).toEqual([{ text: "run " }, { text: "fast", italic: true }, { text: " and " }, { text: "safe", bold: true }]);
  });

  it("a 2-col table renders padded columns, bold header, a dim rule sized to the header, plain data row", () => {
    const out = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toEqual([
      { text: "a │ b", bold: true },
      { text: "─".repeat("a │ b".length), dim: true },
      { text: "1 │ 2" },
    ]);
  });
  it("column widths pad to the widest cell in each column", () => {
    const out = renderMarkdown("| name | val |\n|---|---|\n| x | 100 |\n| yy | 2 |");
    expect(out[0]).toEqual({ text: "name │ val", bold: true });   // "name"(4) / "val"(3) already widest
    expect(out[2]).toEqual({ text: "x    │ 100" });               // "x" padded to 4, "100" fits in 3
    expect(out[3]).toEqual({ text: "yy   │ 2  " });                // "yy" padded to 4, "2" padded to 3
  });
  it("a lone `|`-containing prose line is NOT a table (needs the |---| separator as line 2)", () => {
    expect(renderMarkdown("just a | pipe")).toEqual([{ text: "just a | pipe" }]);
  });
  it("two consecutive `|` lines where line 2 isn't a separator are left as ordinary prose, not a table", () => {
    expect(renderMarkdown("a | b\nc | d")).toEqual([{ text: "a | b" }, { text: "c | d" }]);
  });
  it("a fenced ts block gets segment-styled lines (indentation + highlight)", () => {
    const out = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(out).toEqual([
      { text: "  const x = 1;", segments: [{ text: "  " }, { text: "const", color: "cyan" }, { text: " x = " }, { text: "1", color: "yellow" }, { text: ";" }] },
    ]);
  });
  it("a fence with no language stays the current plain dim line (not segment-styled)", () => {
    expect(renderMarkdown("```\nplain text\n```")).toEqual([{ text: "  plain text", dim: true }]);
  });
  it("a fence with an unrecognized language falls back to the plain dim line", () => {
    expect(renderMarkdown("```rust\nfn main() {}\n```")).toEqual([{ text: "  fn main() {}", dim: true }]);
  });
});
