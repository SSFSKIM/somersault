import { describe, it, expect } from "vitest";
import { TurnMapper } from "../../../../src/appserver/items/mapper.js";
import { itemsFromTranscript } from "../../../../src/appserver/items/replay.js";
import type { Item } from "../../../../src/appserver/items/types.js";
const frames = [
  { type: "user", uuid: "u-p", message: { content: "run ls" } },
  { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
  { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
];
describe("itemsFromTranscript", () => {
  it("persisted path yields the same item ids as the live path (D10)", () => {
    const live = new TurnMapper(); const liveIds: string[] = [];
    for (const f of frames) for (const e of live.ingest(f)) if (e.kind === "completed") liveIds.push(e.item.id);
    const replayIds = itemsFromTranscript(frames).map((i) => i.id);
    expect(replayIds).toEqual(["u-p", ...liveIds]); // userMessage first, then identical assistant/tool ids
  });
  it("persisted items are DEEPLY identical to the live items, not just id-matched", () => {
    const live = new TurnMapper(); const liveItems: Item[] = [];
    for (const f of frames) for (const e of live.ingest(f)) if (e.kind === "completed") liveItems.push(e.item);
    for (const e of live.finalize(false)) if (e.kind === "completed") liveItems.push(e.item);
    const replayed = itemsFromTranscript(frames);
    expect(replayed).toEqual([{ type: "userMessage", id: "u-p", text: "run ls" }, ...liveItems]);
  });
  it("a tool_use with no matching tool_result closes only via finalize, never auto-completes on arrival", () => {
    const openFrames = [
      { type: "assistant", uuid: "u-a2", message: { id: "msg_B", content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "pwd" } }] } },
    ];
    const items = itemsFromTranscript(openFrames);
    expect(items).toEqual([{ type: "toolCall", id: "toolu_2", tool: "Bash", view: "command", arguments: { command: "pwd" }, status: "completed" }]);
  });
  it("skips tool_result-bearing user frames as userMessages (they complete tools instead)", () => {
    const items = itemsFromTranscript(frames);
    expect(items.some((i) => i.type === "userMessage" && i.id === "u-r")).toBe(false);
  });
});
