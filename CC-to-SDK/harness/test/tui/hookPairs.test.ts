// tui/test/hookPairs.test.ts — bl7 T-HOOKBLOCK Task 1 + bl8 T-QY Task 1: the pair tracker, tested as pure
// state with an injected clock (P116's arrival-delta rule — no duration field on the wire, so the pairing IS
// the measurement). bl8 widens retention to every reachable event (P119: PreToolUse, PostToolUse, Stop,
// UserPromptSubmit, SessionStart) and adds the in-flight counter; the PreToolUse-only filter for cluster
// absorption moved OUT of this class and into `toolFold.ts`'s `resolveRunHooks` (spec D1). See hookPairs.ts
// for the wire contract this pins.
import { describe, expect, it } from "vitest";
import { HookPairTracker } from "../../src/tui/hookPairs.js";

describe("HookPairTracker", () => {
  it("pairs started+response on the same hook_id into one completed entry", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000);
    const completed = t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1200, 7);
    expect(completed).toBe(true);
    expect(t.entries()).toEqual([{ id: "h1", name: "PreToolUse:Read", event: "PreToolUse", durationMs: 200, afterSequence: 7 }]);
  });

  it("drops a response with no matching started()", () => {
    const t = new HookPairTracker();
    const completed = t.response({ hook_id: "ghost", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1200, 7);
    expect(completed).toBe(false);
    expect(t.entries()).toEqual([]);
  });

  it("(a) retains a PostToolUse pair with event: \"PostToolUse\" (bl8: the PreToolUse filter moved to consumers)", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PostToolUse" }, 1000);
    const completed = t.response({ hook_id: "h1", hook_name: "PostToolUse:Read", hook_event: "PostToolUse" }, 1100, 3);
    expect(completed).toBe(true);
    expect(t.entries()).toEqual([{ id: "h1", name: "PostToolUse:Read", event: "PostToolUse", durationMs: 100, afterSequence: 3 }]);
  });

  it("(b) a Stop response with exit_code:2, stderr:\"boom\" yields exitCode:2, stderr:\"boom\"", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "Stop" }, 1000);
    const completed = t.response({ hook_id: "h1", hook_name: "Stop", hook_event: "Stop", exit_code: 2, stderr: "boom" }, 1050, 5);
    expect(completed).toBe(true);
    expect(t.entries()).toEqual([{ id: "h1", name: "Stop", event: "Stop", durationMs: 50, afterSequence: 5, exitCode: 2, stderr: "boom" }]);
  });

  it("(d) response() returns true for a UserPromptSubmit pair", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "UserPromptSubmit" }, 1000);
    expect(t.response({ hook_id: "h1", hook_name: "UserPromptSubmit", hook_event: "UserPromptSubmit" }, 1025, 2)).toBe(true);
  });

  it("(c) inProgress() shows Map{\"Stop\"->1} after a Stop started() and empties after its response()", () => {
    const t = new HookPairTracker();
    expect(t.inProgress()).toEqual(new Map());
    t.started({ hook_id: "h1", hook_event: "Stop" }, 1000);
    expect(t.inProgress()).toEqual(new Map([["Stop", 1]]));
    t.response({ hook_id: "h1", hook_name: "Stop", hook_event: "Stop" }, 1050, 5);
    expect(t.inProgress()).toEqual(new Map());
  });

  it("started() returns true", () => {
    const t = new HookPairTracker();
    expect(t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000)).toBe(true);
  });

  it("progress() is a no-op — it neither mutates completed entries nor inProgress()", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000);
    t.progress({ hook_id: "h1" });
    expect(t.inProgress()).toEqual(new Map([["PreToolUse", 1]]));
    expect(t.entries()).toEqual([]);
  });

  it("(e) keeps two interleaved PreToolUse pairs in arrival order", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000);
    t.started({ hook_id: "h2", hook_event: "PreToolUse" }, 1050);
    // h2 responds first — arrival order is response order, not start order.
    t.response({ hook_id: "h2", hook_name: "PreToolUse:Write", hook_event: "PreToolUse" }, 1120, 5);
    t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1300, 6);
    expect(t.entries()).toEqual([
      { id: "h2", name: "PreToolUse:Write", event: "PreToolUse", durationMs: 70, afterSequence: 5 },
      { id: "h1", name: "PreToolUse:Read", event: "PreToolUse", durationMs: 300, afterSequence: 6 },
    ]);
  });

  it("(e) clear() empties the started map, the completed entries, AND the in-progress counter", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000);
    t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1100, 1);
    t.started({ hook_id: "h2", hook_event: "Stop" }, 1200);
    expect(t.entries()).toHaveLength(1);
    t.clear();
    expect(t.entries()).toEqual([]);
    expect(t.inProgress()).toEqual(new Map());
    // The started stamp was dropped too — a response for the same id after clear() finds nothing to pair.
    expect(t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1200, 2)).toBe(false);
  });
});
