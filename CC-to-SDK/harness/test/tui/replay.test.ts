// tui/test/replay.test.ts — pure replay-rendering units. Fixtures mirror probe-23's persisted message shape.
import { describe, it, expect } from "vitest";
import { replayLines } from "../../src/tui/replay.js";

const TS = "2026-06-19T15:58:00.000Z";
// `uuid` matters: rowKind() only classifies a plain (non-echo/non-summary) user row as "prompt" when it
// carries one (real transcript rows always do — see sessions/rows.ts) — omitting it here would silently
// make every fixture "other", not "prompt", under the Minor-3 fix (turns counted via rowKind).
const userText = (text: string, timestamp = "2026-06-19T15:56:00.000Z", uuid = "u-test") => ({ type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] }, timestamp });
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
    expect(texts).toContain("Read(cli.ts)");
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
  it("hides command stdout/caveat rows, renders command echoes as dim slash lines, and marks compact summaries", () => {
    const msgs = [
      { type: "user", uuid: "u1", timestamp: "2026-07-28T08:00:00Z", message: { role: "user", content: "hi" } },
      { type: "user", uuid: "u2", message: { role: "user", content: "<command-name>/compact</command-name> <command-message>compact</command-message>" } },
      { type: "user", uuid: "u3", message: { role: "user", content: "<local-command-stdout>Compacted</local-command-stdout>" } },
      { type: "user", uuid: "u4", message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context. Summary…" } },
    ];
    const text = replayLines(msgs).map((l) => l.text).join("\n");
    expect(text).toContain("› /compact");
    expect(text).not.toContain("local-command-stdout");
    expect(text).not.toContain("Summary…");
    expect(text).toContain("─── context compacted earlier ───");
  });
  it("counts only real prompts as turns — a command echo and a compaction summary are not turns (Minor 3)", () => {
    const msgs = [
      { type: "user", uuid: "u1", timestamp: "2026-07-28T08:00:00Z", message: { role: "user", content: "hi" } },
      { type: "user", uuid: "u2", message: { role: "user", content: "<command-name>/compact</command-name> <command-message>compact</command-message>" } },
      { type: "user", uuid: "u3", message: { role: "user", content: "<local-command-stdout>Compacted</local-command-stdout>" } },
      { type: "user", uuid: "u4", message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context. Summary…" } },
    ];
    // Only u1 is rowKind()==="prompt": u2 is a command_echo, u3 a command_output (already excluded from
    // `shown`), u4 a compact_summary. The old `type==="user"` count would have read 3 (u1+u2+u4).
    expect(replayLines(msgs)[0].text).toBe("─── resumed: session · 1 turn ───");
  });
});
