import { describe, expect, it } from "vitest";
import { TurnBuffer } from "../../src/host/follow.js";

describe("TurnBuffer", () => {
  it("replays in arrival order", () => {
    const b = new TurnBuffer({ maxMessages: 10, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 }); b.push({ n: 3 });
    expect(b.snapshot()).toEqual({ messages: [{ n: 1 }, { n: 2 }, { n: 3 }], truncated: false });
  });

  it("drops the OLDEST past maxMessages and says it truncated", () => {
    const b = new TurnBuffer({ maxMessages: 2, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 }); b.push({ n: 3 });
    const s = b.snapshot();
    expect(s.messages).toEqual([{ n: 2 }, { n: 3 }]);
    expect(s.truncated).toBe(true);      // a follower must know it joined a partial view
  });

  it("drops past maxBytes as well, so one huge message cannot pin the heap", () => {
    const b = new TurnBuffer({ maxMessages: 100, maxBytes: 120 });
    b.push({ pad: "x".repeat(100) });
    b.push({ pad: "y".repeat(100) });
    const s = b.snapshot();
    expect(s.messages).toHaveLength(1);
    expect(JSON.stringify(s.messages[0])).toContain("y");
    expect(s.truncated).toBe(true);
  });

  it("a single message larger than maxBytes is kept, not dropped into nothing", () => {
    const b = new TurnBuffer({ maxMessages: 10, maxBytes: 10 });
    b.push({ pad: "z".repeat(500) });
    expect(b.snapshot().messages).toHaveLength(1);   // an empty replay is worse than an oversized one
  });

  it("reset clears the record and the truncation flag for the next turn", () => {
    const b = new TurnBuffer({ maxMessages: 1, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 });
    expect(b.snapshot().truncated).toBe(true);
    b.reset();
    expect(b.snapshot()).toEqual({ messages: [], truncated: false });
  });
});
