import { describe, it, expect } from "vitest";
import { renderMessage, trunc, toolTarget } from "../src/render.js";

const asst = (content: unknown[]) => ({ type: "assistant", message: { content } });

describe("renderMessage", () => {
  it("renders assistant text verbatim, one line per newline", () => {
    expect(renderMessage(asst([{ type: "text", text: "hello\nworld" }]))).toEqual([{ text: "hello" }, { text: "world" }]);
  });
  it("renders thinking dimmed", () => {
    expect(renderMessage(asst([{ type: "thinking", thinking: "hmm" }]))).toEqual([{ text: "hmm", dim: true }]);
  });
  it("renders Edit as a colored diff", () => {
    const out = renderMessage(asst([{ type: "tool_use", name: "Edit", input: { file_path: "f.ts", old_string: "a", new_string: "b" } }]));
    expect(out[0]).toEqual({ text: "⚙ Edit f.ts" });
    expect(out).toContainEqual({ text: "  - a", color: "red" });
    expect(out).toContainEqual({ text: "  + b", color: "green" });
  });
  it("renders Bash as a command marker", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Bash", input: { command: "echo hi" } }]))).toEqual([{ text: "⚙ Bash echo hi" }]);
  });
  it("renders Read as a file ref", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Read", input: { file_path: "x.ts" } }]))).toEqual([{ text: "⚙ Read x.ts" }]);
  });
  it("renders an unknown tool with the generic fallback", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Grep", input: { pattern: "foo" } }]))).toEqual([{ text: "⚙ Grep(foo)" }]);
  });
  it("renders a tool_result as dimmed indented output", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: "line1\nline2" }] } };
    expect(renderMessage(m)).toEqual([{ text: "  │ line1", dim: true }, { text: "  │ line2", dim: true }]);
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

import { toolDiffLines } from "../src/render.js";
describe("toolDiffLines", () => {
  it("renders Edit + / - lines with a header", () => {
    expect(toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" })).toEqual([
      { text: "⚙ Edit f.ts" }, { text: "  - a", color: "red" }, { text: "  + b", color: "green" },
    ]);
  });
  it("caps long diffs and notes the remainder", () => {
    const new_string = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    const out = toolDiffLines("Write", { file_path: "big.ts", content: new_string }, 24);
    expect(out[0]).toEqual({ text: "⚙ Write big.ts" });
    expect(out.filter((l) => l.text.startsWith("  +")).length).toBe(24);
    expect(out.at(-1)).toEqual({ text: "  … 16 more lines", dim: true });
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
    expect(out[0]).toEqual({ text: "⚙ Write b.ts" });
    expect(out.at(-1)).toEqual({ text: "  … 6 more lines", dim: true });   // 30 added − cap 24 = 6
  });
});
