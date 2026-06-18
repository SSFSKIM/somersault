import { describe, it, expect } from "vitest";
import { streamLine, streamLines } from "../src/format.js";

describe("streamLine (operator-grade)", () => {
  it("extracts assistant text blocks", () => {
    expect(streamLine({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } })).toEqual(["hello"]);
  });
  it("renders tool_use blocks as ⚙ Name(arg) markers, truncating long args", () => {
    const long = "x".repeat(100);
    const [line] = streamLine({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: long } }] } });
    expect(line.startsWith("⚙ Bash(")).toBe(true);
    expect(line.length).toBeLessThan(70);
  });
  it("ignores result/system messages (no diffs/results in operator mode)", () => {
    expect(streamLine({ type: "result", result: "done" })).toEqual([]);
    expect(streamLine({ type: "system", subtype: "init" })).toEqual([]);
  });
  it("streamLines flattens a message sequence in order", () => {
    const msgs = [
      { type: "assistant", message: { content: [{ type: "text", text: "a" }, { type: "tool_use", name: "Read", input: { file: "x" } }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "b" }] } },
    ];
    expect(streamLines(msgs)).toEqual(["a", `⚙ Read({"file":"x"})`, "b"]);
  });
});
