import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/markdown.js";

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
  it("bullet and numbered lists get a • / keep the number; inline markers stripped", () => {
    expect(renderMarkdown("- item")).toEqual([{ text: "• item" }]);
    expect(renderMarkdown("* item")).toEqual([{ text: "• item" }]);
    expect(renderMarkdown("1. first")).toEqual([{ text: "1. first" }]);
    expect(renderMarkdown("- use `foo`")).toEqual([{ text: "• use foo" }]);
  });
  it("blockquote → dim with a │ prefix", () => {
    expect(renderMarkdown("> quoted")).toEqual([{ text: "│ quoted", dim: true }]);
  });
  it("fenced code → fences dropped, body dim + indented", () => {
    expect(renderMarkdown("```\nconst x = 1;\n```")).toEqual([{ text: "  const x = 1;", dim: true }]);
  });
  it("a mixed-style line strips markers and applies NO per-span color (the accepted limitation)", () => {
    expect(renderMarkdown("**bold** and normal")).toEqual([{ text: "bold and normal" }]);
    expect(renderMarkdown("see `x` here")).toEqual([{ text: "see x here" }]);
  });
});
