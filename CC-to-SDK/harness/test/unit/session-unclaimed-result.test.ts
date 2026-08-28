// test/unit/session-unclaimed-result.test.ts — the seam an adopted turn's OUTCOME arrives on. The hook
// returns whether it CLAIMED the result, and that boolean is the whole point: without it the design could
// not tell a consumed result from a leaked one, which is the only thing `unmatchedResults` has ever
// measured.
import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";

/** A query stand-in that yields exactly the frames a test hands it, then ends. */
function fakeQuery(frames: unknown[]) {
  return () => ({
    async *[Symbol.asyncIterator]() { for (const f of frames) yield f; },
  }) as any;
}

describe("onUnclaimedResult", () => {
  it("fires for a result no waiter owns, and a claim suppresses the counter", async () => {
    const seen: unknown[] = [];
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success", result: "hi" }]) }, {});
    s.onUnclaimedResult((r) => { seen.push(r); return true; });
    await s.done;
    expect(seen).toHaveLength(1);
    expect(s.unmatchedResults).toBe(0);
  });

  it("still counts a result the hook declines to claim", async () => {
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success", result: "hi" }]) }, {});
    s.onUnclaimedResult(() => false);
    await s.done;
    expect(s.unmatchedResults).toBe(1);
  });

  it("counts as before when no hook is installed", async () => {
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success", result: "hi" }]) }, {});
    await s.done;
    expect(s.unmatchedResults).toBe(1);
  });

  it("stops firing once unsubscribed", async () => {
    let calls = 0;
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success" }, { type: "result", subtype: "success" }]) }, {});
    const off = s.onUnclaimedResult(() => { calls++; off(); return true; });
    await s.done;
    expect(calls).toBe(1);
    expect(s.unmatchedResults).toBe(1);
  });

  it("one hook's throw does not stop the loop or the counter", async () => {
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success" }]) }, {});
    s.onUnclaimedResult(() => { throw new Error("boom"); });
    await s.done;
    expect(s.unmatchedResults).toBe(1);
  });
});
