// tui/test/replay.test.ts — pure replay-rendering units. Fixtures mirror probe-23's persisted message shape.
import { describe, it, expect } from "vitest";
import { replayLines } from "../src/replay.js";

const TS = "2026-06-19T15:58:00.000Z";
const userText = (text: string, timestamp = "2026-06-19T15:56:00.000Z") => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, timestamp });
const asstText = (text: string, timestamp = TS) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, timestamp });
const asstTool = (name: string, input: any, timestamp = TS) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] }, timestamp });
const toolResult = (text: string, timestamp = TS) => ({ type: "user", message: { content: [{ type: "tool_result", content: text }] }, timestamp });

describe("replayLines", () => {
  it("frames the replay with a derived header (label · turns · hh:mm) and a live divider", () => {
    const out = replayLines([userText("fix the parser"), asstText("done")]);
    expect(out[0]).toEqual({ text: "─── resumed: fix the parser · 1 turn · 15:58 ───", dim: true });
    expect(out.at(-1)).toEqual({ text: "─── resumed here · live ───", dim: true });
  });
  it("renders prompts and assistant text/tools, skipping tool_result bodies", () => {
    const out = replayLines([userText("add a flag"), asstTool("Read", { file_path: "cli.ts" }), toolResult("FILE BODY HERE"), asstText("added")]);
    const texts = out.map((l) => l.text);
    expect(texts).toContain("› add a flag");
    expect(texts).toContain("⚙ Read cli.ts");
    expect(texts).toContain("added");
    expect(texts.some((t) => t.includes("FILE BODY HERE"))).toBe(false);   // tool_result body skipped
  });
  it("indents nested (subagent) messages by parent_tool_use_id", () => {
    const nested = { ...asstText("inner work"), parent_tool_use_id: "tu_1" };
    const out = replayLines([userText("go"), nested]);
    expect(out).toContainEqual({ text: "  inner work", dim: true });
  });
  it("caps to the last N messages with an elision marker", () => {
    const msgs = Array.from({ length: 250 }, (_, i) => asstText(`m${i}`, "2026-06-19T16:00:00.000Z"));
    const out = replayLines(msgs, { cap: 200 });
    expect(out[1]).toEqual({ text: "… 50 earlier messages elided", dim: true });
  });
});
