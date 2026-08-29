// tui/test/hookPairs.test.ts — bl7 T-HOOKBLOCK Task 1: the pair tracker, tested as pure state with an
// injected clock (P116's arrival-delta rule — no duration field on the wire, so the pairing IS the
// measurement). See hookPairs.ts for the wire contract this pins.
import { describe, expect, it } from "vitest";
import { HookPairTracker } from "../../src/tui/hookPairs.js";

describe("HookPairTracker", () => {
  it("pairs started+response on the same hook_id into one completed entry", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000);
    const completed = t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1200, 7);
    expect(completed).toBe(true);
    expect(t.entries()).toEqual([{ name: "PreToolUse:Read", durationMs: 200, afterSequence: 7 }]);
  });

  it("drops a response with no matching started()", () => {
    const t = new HookPairTracker();
    const completed = t.response({ hook_id: "ghost", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1200, 7);
    expect(completed).toBe(false);
    expect(t.entries()).toEqual([]);
  });

  it("drops a PostToolUse pair (PreToolUse-only, canon jar)", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PostToolUse" }, 1000);
    const completed = t.response({ hook_id: "h1", hook_name: "PostToolUse:Read", hook_event: "PostToolUse" }, 1100, 3);
    expect(completed).toBe(false);
    expect(t.entries()).toEqual([]);
  });

  it("keeps two interleaved pairs in arrival order", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000);
    t.started({ hook_id: "h2", hook_event: "PreToolUse" }, 1050);
    // h2 responds first — arrival order is response order, not start order.
    t.response({ hook_id: "h2", hook_name: "PreToolUse:Write", hook_event: "PreToolUse" }, 1120, 5);
    t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1300, 6);
    expect(t.entries()).toEqual([
      { name: "PreToolUse:Write", durationMs: 70, afterSequence: 5 },
      { name: "PreToolUse:Read", durationMs: 300, afterSequence: 6 },
    ]);
  });

  it("clear() empties both the started map and the completed entries", () => {
    const t = new HookPairTracker();
    t.started({ hook_id: "h1", hook_event: "PreToolUse" }, 1000);
    t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1100, 1);
    expect(t.entries()).toHaveLength(1);
    t.clear();
    expect(t.entries()).toEqual([]);
    // The started stamp was dropped too — a response for the same id after clear() finds nothing to pair.
    expect(t.response({ hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse" }, 1200, 2)).toBe(false);
  });
});
