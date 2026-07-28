import { describe, it, expect } from "vitest";
import { TurnMapper } from "../../../../src/appserver/items/mapper.js";
import { toolView } from "../../../../src/appserver/items/types.js";
const asst = (msgId: string, content: unknown[]) => ({ type: "assistant", uuid: "u-" + msgId, message: { id: msgId, model: "m", content } });
const toolResult = (toolUseId: string, content: string) => ({ type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] } });
describe("TurnMapper", () => {
  it("maps text + thinking blocks with msgId#index ids", () => {
    const m = new TurnMapper();
    const evs = m.ingest(asst("msg_1", [{ type: "thinking", thinking: "hm" }, { type: "text", text: "hi" }]));
    expect(evs.map((e) => e.kind)).toEqual(["started", "completed", "started", "completed"]);
    expect(evs[1]).toMatchObject({ item: { type: "reasoning", id: "msg_1#0", text: "hm" } });
    expect(evs[3]).toMatchObject({ item: { type: "agentMessage", id: "msg_1#1", text: "hi" } });
  });
  it("tool_use starts inProgress; tool_result completes by toolu id", () => {
    const m = new TurnMapper();
    const [started] = m.ingest(asst("msg_2", [{ type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "ls" } }]));
    expect(started).toMatchObject({ kind: "started", item: { type: "toolCall", id: "toolu_9", view: "command", status: "inProgress" } });
    const [done] = m.ingest(toolResult("toolu_9", "ok"));
    expect(done).toMatchObject({ kind: "completed", item: { id: "toolu_9", status: "completed", result: "ok" } });
  });
  it("stream deltas key to the same msgId#index; the later full frame does not re-emit", () => {
    const m = new TurnMapper();
    m.ingest({ type: "stream_event", event: { type: "message_start", message: { id: "msg_3" } } });
    const s = m.ingest({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
    expect(s[0]).toMatchObject({ kind: "started", item: { id: "msg_3#0" } });
    const d = m.ingest({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "he" } } });
    expect(d[0]).toEqual({ kind: "delta", itemId: "msg_3#0", channel: "text", delta: "he" });
    const c = m.ingest({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
    expect(c[0]).toMatchObject({ kind: "completed", item: { id: "msg_3#0", text: "he" } });
    expect(m.ingest(asst("msg_3", [{ type: "text", text: "he" }]))).toEqual([]); // reconcile, no dup
  });
  it("finalize(interrupted) stamps aborted on open items", () => {
    const m = new TurnMapper();
    m.ingest({ type: "stream_event", event: { type: "message_start", message: { id: "msg_4" } } });
    m.ingest({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
    const evs = m.finalize(true);
    expect(evs[0]).toMatchObject({ kind: "completed", item: { id: "msg_4#0", aborted: true } });
  });
  it("nested subagent frames attach to the parent tool, not the top stream", () => {
    const m = new TurnMapper();
    m.ingest(asst("msg_5", [{ type: "tool_use", id: "toolu_t", name: "Task", input: {} }]));
    const evs = m.ingest({ type: "assistant", parent_tool_use_id: "toolu_t", uuid: "u-n", message: { id: "msg_6", content: [{ type: "text", text: "inner" }] } });
    expect(evs).toEqual([]); // M1: nested activity is not itemized; attribution only
  });
  it("duplicate tool_result for an already-completed tool is ignored", () => {
    const m = new TurnMapper();
    m.ingest(asst("msg_7", [{ type: "tool_use", id: "toolu_d", name: "Bash", input: { command: "ls" } }]));
    const [done] = m.ingest(toolResult("toolu_d", "ok"));
    expect(done).toMatchObject({ kind: "completed", item: { id: "toolu_d", status: "completed", result: "ok" } });
    const again = m.ingest(toolResult("toolu_d", "different"));
    expect(again).toEqual([]);
    expect(done).toMatchObject({ item: { id: "toolu_d", status: "completed", result: "ok" } }); // stored result unchanged
  });
  it("finalize(true) closes a still-open tool_use as failed", () => {
    const m = new TurnMapper();
    m.ingest(asst("msg_8", [{ type: "tool_use", id: "toolu_i", name: "Bash", input: { command: "ls" } }]));
    const evs = m.finalize(true);
    expect(evs).toEqual([{ kind: "completed", item: { type: "toolCall", id: "toolu_i", tool: "Bash", view: "command", arguments: { command: "ls" }, status: "failed" } }]);
  });
  it("finalize(false) closes a still-open tool_use as completed", () => {
    const m = new TurnMapper();
    m.ingest(asst("msg_9", [{ type: "tool_use", id: "toolu_j", name: "Bash", input: { command: "ls" } }]));
    const evs = m.finalize(false);
    expect(evs).toEqual([{ kind: "completed", item: { type: "toolCall", id: "toolu_j", tool: "Bash", view: "command", arguments: { command: "ls" }, status: "completed" } }]);
  });
  it("toolView classifies", () => {
    expect(toolView("Bash")).toBe("command"); expect(toolView("Edit")).toBe("fileChange");
    expect(toolView("Read")).toBe("fileRead"); expect(toolView("Grep")).toBe("search");
    expect(toolView("Task")).toBe("subagentTask"); expect(toolView("mcp__x__y")).toBe("mcp");
    expect(toolView("SendFeedback")).toBe("other");
  });
});
