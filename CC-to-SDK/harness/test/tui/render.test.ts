import { describe, it, expect } from "vitest";
import { renderMessage, trunc, toolTarget } from "../../src/tui/render.js";
import { ACCENT } from "../../src/tui/theme.js";

const asst = (content: unknown[]) => ({ type: "assistant", message: { content } });
const BULLET = { text: "● ", color: ACCENT };

describe("renderMessage", () => {
  it("renders assistant text with the ● bullet gutter + indented continuation", () => {
    expect(renderMessage(asst([{ type: "text", text: "hello\nworld" }]))).toEqual([
      { text: "hello", gutter: BULLET }, { text: "  world" },
    ]);
  });
  it("renders thinking dimmed", () => {
    expect(renderMessage(asst([{ type: "thinking", thinking: "hmm" }]))).toEqual([{ text: "hmm", dim: true }]);
  });
  it("renders Edit as a numbered hunk diff", () => {
    const out = renderMessage(asst([{ type: "tool_use", name: "Edit", input: { file_path: "f.ts", old_string: "a", new_string: "b" } }]));
    expect(out[0]).toEqual({ text: "Edit f.ts", gutter: { text: "● " } });
    expect(out).toContainEqual({ text: "  1 - a", color: "red" });
    expect(out).toContainEqual({ text: "  1 + b", color: "green" });
  });
  it("renders Bash with the ● bullet in CC's Bash(<cmd>) form", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Bash", input: { command: "echo hi" } }]))).toEqual([
      { text: "Bash(echo hi)", gutter: { text: "● " } },
    ]);
  });
  it("renders Read with the ● bullet in CC's Read(<path>) form", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Read", input: { file_path: "x.ts" } }]))).toEqual([
      { text: "Read(x.ts)", gutter: { text: "● " } },
    ]);
  });
  it("renders an unknown tool with the generic fallback, still ● bulleted", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Grep", input: { pattern: "foo" } }]))).toEqual([
      { text: "Grep(foo)", gutter: { text: "● " } },
    ]);
  });
  it("renders a tool_result as a dimmed ⎿ result tree", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: "line1\nline2" }] } };
    expect(renderMessage(m)).toEqual([{ text: "  ⎿ line1", dim: true }, { text: "  ⎿ line2", dim: true }]);
  });
  it("renders an is_error tool_result red, with ✗ prefixed on its first line only", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: "boom\nsecond line", is_error: true }] } };
    expect(renderMessage(m)).toEqual([
      { text: "  ⎿ ✗ boom", color: "red" },
      { text: "  ⎿ second line", color: "red" },
    ]);
  });
  it("ignores result/system messages", () => {
    expect(renderMessage({ type: "result", result: "ok" })).toEqual([]);
  });
});

describe("toolTarget", () => {
  it("Edit/Write/Read → the file path", () => {
    expect(toolTarget("Edit", { file_path: "f.ts" })).toBe("f.ts");
    expect(toolTarget("Read", { file_path: "x.ts" })).toBe("x.ts");
    expect(toolTarget("Write", { path: "y.ts" })).toBe("y.ts");
  });
  it("Bash → the command", () => { expect(toolTarget("Bash", { command: "echo hi" })).toBe("echo hi"); });
  it("unknown tool → its first arg", () => { expect(toolTarget("Grep", { pattern: "foo" })).toBe("foo"); });
});
describe("trunc", () => { it("truncates with an ellipsis", () => { expect(trunc("abcdef", 4)).toBe("abc…"); }); });

import { toolDiffLines } from "../../src/tui/render.js";
describe("toolDiffLines", () => {
  it("renders a single-line Edit as a numbered - / + hunk with a ● header (head stays index 0)", () => {
    expect(toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" })).toEqual([
      { text: "Edit f.ts", gutter: { text: "● " } },
      { text: "  1 - a", color: "red" }, { text: "  1 + b", color: "green" },
    ]);
  });
  it("renders a multi-line Edit hunk: dim numbered context (≤3 lines each side) around numbered - / + change rows", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb\nc\nd\ne", new_string: "a\nb\nX\nd\ne" });
    expect(out[0]).toEqual({ text: "Edit f.ts", gutter: { text: "● " } });
    expect(out.slice(1)).toEqual([
      { text: "  1  a", dim: true },
      { text: "  2  b", dim: true },
      { text: "  3 - c", color: "red" },
      { text: "  3 + X", color: "green" },
      { text: "  4  d", dim: true },
      { text: "  5  e", dim: true },
    ]);
  });
  it("produces no negative-length ranges when old_string === new_string (identical → context only, no change rows)", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb\nc\nd\ne", new_string: "a\nb\nc\nd\ne" });
    // EXACT rows, not just "no red/green + all dim": those negative assertions also hold for a regression
    // that duplicates or mis-numbers context rows (e.g. an unbounded suffix scan), so they pinned nothing.
    expect(out).toEqual([
      { text: "Edit f.ts", gutter: { text: "● " } },
      { text: "  3  c", dim: true }, { text: "  4  d", dim: true }, { text: "  5  e", dim: true },
    ]);
  });
  it("produces no negative-length ranges when new_string is a strict prefix of old_string (trailing removal only)", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb\nc", new_string: "a\nb" });
    expect(out[0]).toEqual({ text: "Edit f.ts", gutter: { text: "● " } });
    expect(out.slice(1)).toEqual([
      { text: "  1  a", dim: true },
      { text: "  2  b", dim: true },
      { text: "  3 - c", color: "red" },
    ]);
  });
  it("produces no negative-length ranges when old_string is a strict prefix of new_string (trailing addition only)", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb", new_string: "a\nb\nc" });
    expect(out[0]).toEqual({ text: "Edit f.ts", gutter: { text: "● " } });
    expect(out.slice(1)).toEqual([
      { text: "  1  a", dim: true },
      { text: "  2  b", dim: true },
      { text: "  3 + c", color: "green" },
    ]);
  });
  it("keeps the all-+ behavior for Write (content only, no old_string)", () => {
    expect(toolDiffLines("Write", { file_path: "f.ts", content: "a\nb" })).toEqual([
      { text: "Write f.ts", gutter: { text: "● " } },
      { text: "  + a", color: "green" }, { text: "  + b", color: "green" },
    ]);
  });
  it("renders a removal-only Edit (old_string, no new_string) as an all-red body, never an empty one", () => {
    expect(toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb" })).toEqual([
      { text: "Edit f.ts", gutter: { text: "● " } },
      { text: "  - a", color: "red" }, { text: "  - b", color: "red" },
    ]);
  });
  it("caps long diffs and notes the remainder (Write, all-+ body)", () => {
    const new_string = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    const out = toolDiffLines("Write", { file_path: "big.ts", content: new_string }, 24);
    expect(out[0]).toEqual({ text: "Write big.ts", gutter: { text: "● " } });
    expect(out.filter((l) => l.text.startsWith("  +")).length).toBe(24);
    expect(out.at(-1)).toEqual({ text: "  … 16 more lines", dim: true });
  });
  it("caps a 40-line hunk body (all-changed, no shared prefix/suffix) and notes the correct remainder", () => {
    // No shared prefix or suffix at all → pure hunk body = 20 red - rows + 20 green + rows = 40 lines.
    const oldLines = Array.from({ length: 20 }, (_, i) => `old${i}`);
    const newLines = Array.from({ length: 20 }, (_, i) => `new${i}`);
    const out = toolDiffLines("Edit", { file_path: "big.ts", old_string: oldLines.join("\n"), new_string: newLines.join("\n") }, 24);
    expect(out[0]).toEqual({ text: "Edit big.ts", gutter: { text: "● " } });
    expect(out.filter((l) => l.color === "red").length + out.filter((l) => l.color === "green").length).toBe(24); // capped at 24
    expect(out.at(-1)).toEqual({ text: "  … 16 more lines", dim: true }); // 40 body lines − cap 24 = 16
  });
});

describe("renderMessage (markdown wiring)", () => {
  it("renders assistant text as markdown (whole-line bold) and leaves thinking plain", () => {
    const lines = renderMessage({ type: "assistant", message: { content: [
      { type: "text", text: "**hi**" },
      { type: "thinking", thinking: "**not parsed**" },
    ] } });
    expect(lines).toContainEqual({ text: "hi", bold: true, gutter: BULLET }); // text → markdown + ● bullet
    expect(lines).toContainEqual({ text: "**not parsed**", dim: true });      // thinking → raw dim (NOT parsed, no bullet)
  });
});

describe("renderMessage (replay additions)", () => {
  it("renders a user-text prompt as a dim '› ' line", () => {
    const m = { type: "user", message: { role: "user", content: [{ type: "text", text: "fix the parser" }] } };
    expect(renderMessage(m)).toEqual([{ text: "› fix the parser", dim: true }]);
  });
  it("renders a multi-line Write via toolDiffLines (capped at 24)", () => {
    const content = Array.from({ length: 30 }, (_, i) => `L${i}`).join("\n");
    const out = renderMessage({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "b.ts", content } }] } });
    expect(out[0]).toEqual({ text: "Write b.ts", gutter: { text: "● " } });
    expect(out.at(-1)).toEqual({ text: "  … 6 more lines", dim: true });   // 30 added − cap 24 = 6
  });
});
