import { describe, expect, it } from "vitest";
import { Session } from "../../src/session/session.js";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";

function fakeQuery() {
  const frames = new AsyncQueue<unknown>();
  const query = (() => ({ [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator]() })) as any;
  return { frames, query };
}

describe("Session.onFrame", () => {
  it("fires for BETWEEN-TURN system frames (no waiter — the old path dropped them)", async () => {
    const { frames, query } = fakeQuery();
    const s = new Session({ query }, {});
    const seen: unknown[] = [];
    s.onFrame((m) => seen.push(m));
    frames.push({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "sleep" }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    expect(s.backgroundTasks).toEqual([{ task_id: "t1", task_type: "bash", description: "sleep" }]);
    frames.close(); await s.done;
  });

  it("unsubscribe stops delivery; a throwing subscriber does not break the loop", async () => {
    const { frames, query } = fakeQuery();
    const s = new Session({ query }, {});
    const seen: unknown[] = [];
    s.onFrame(() => { throw new Error("boom"); });
    const off = s.onFrame((m) => seen.push(m));
    frames.push({ type: "system", subtype: "status", permissionMode: "default" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    off();
    frames.push({ type: "system", subtype: "status", permissionMode: "plan" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    frames.close(); await s.done;
  });
});
