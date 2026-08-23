import { describe, it, expect } from "vitest";
import { TurnMapper } from "../../../../src/appserver/items/mapper.js";
import { itemsFromTranscript } from "../../../../src/appserver/items/replay.js";
import { flattenForDisplay, type UserTurnInput } from "../../../../src/session/turnInput.js";
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
  it("...including a NESTED (subagent) row, which the live mapper omits and replay must omit too", () => {
    // A persisted `user` row carrying parent_tool_use_id is a subagent's own prompt. TurnMapper.ingest
    // discards every nested frame BEFORE its type routing, so the live stream never itemizes one — but the
    // replay path took its direct userItem shortcut first, surfacing a subagent prompt as an ordinary
    // top-level user message. That breaks the live/replay equivalence the cold-vs-live id stitch rests on.
    const nested = [
      frames[0],
      { type: "user", uuid: "u-nested", parent_tool_use_id: "toolu_agent", message: { content: "do the subtask" } },
      frames[1], frames[2],
    ];
    const live = new TurnMapper(); const liveItems: Item[] = [];
    for (const f of nested) for (const e of live.ingest(f)) if (e.kind === "completed") liveItems.push(e.item);
    for (const e of live.finalize(false)) if (e.kind === "completed") liveItems.push(e.item);
    const replayed = itemsFromTranscript(nested);
    expect(replayed).toEqual([{ type: "userMessage", id: "u-p", text: "run ls" }, ...liveItems]);
    expect(replayed.some((i) => i.id === "u-nested")).toBe(false);
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
  it("Task 9: filters phantom persisted rows (command echo, local-command output/caveat, compaction summary) — real transcripts carry CLI bookkeeping rows that must never surface as ordinary user messages", () => {
    const withPhantoms = [
      { type: "user", uuid: "u-echo", message: { content: "<command-name>/compact</command-name>" } },
      { type: "user", uuid: "u-out", message: { content: "<local-command-stdout>ok</local-command-stdout>" } },
      { type: "user", uuid: "u-caveat", message: { content: "<local-command-caveat>careful</local-command-caveat>" } },
      { type: "user", uuid: "u-compact", message: { content: "This session is being continued from a previous conversation summary." } },
      { type: "user", uuid: "u-p", message: { content: "run ls" } },
      { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
      { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
    ];
    expect(itemsFromTranscript(withPhantoms)).toEqual(itemsFromTranscript(frames)); // identical to the phantom-free fixture
  });

  // I3e (Task 11): the persisted content array for an image turn is exactly `UserContentBlock[]` —
  // `session.ts`'s `userTurn` builds the SDKUserMessage from `normalizeTurnInput(input)`, the SAME wire
  // shape `turns.ts`'s `submitRunner` flattens live via `flattenForDisplay(input)` — so proving replay.ts
  // now calls the identical function on the identical block shape IS the "replayed equals live" claim:
  // both sides are one function's output, never two flatteners that happen to agree today.
  it("I3e: an image-turn frame flattens through flattenForDisplay — replayed text is byte-identical to the live path's, [Image #N] label included", () => {
    const blocks: UserTurnInput = [
      { type: "text", text: "hi " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ];
    const liveText = flattenForDisplay(blocks); // exactly what turns.ts's submitRunner emits live
    const frame = { type: "user", uuid: "u-img", message: { content: blocks } };
    expect(itemsFromTranscript([frame])).toEqual([{ type: "userMessage", id: "u-img", text: liveText }]);
    expect(liveText).toBe("hi [Image #1]");
  });

  it("I3e: an image-only frame (no text block) still labels the image — the I1 stranding label survives replay too", () => {
    const blocks: UserTurnInput = [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }];
    const frame = { type: "user", uuid: "u-img2", message: { content: blocks } };
    expect(itemsFromTranscript([frame])).toEqual([{ type: "userMessage", id: "u-img2", text: flattenForDisplay(blocks) }]);
  });
});
