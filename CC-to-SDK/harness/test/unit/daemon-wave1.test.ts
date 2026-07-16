import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonError, daemonOp } from "../../src/daemon/types.js";

const dir = () => mkdtempSync(join(tmpdir(), "cc-daemon-w1-"));

// captures every session-open's options AND emits init (sessionId capture) per turn
function captureInitQuery(sink: any[], sid: string) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () {
    for await (const t of prompt) { yield { type: "system", subtype: "init", session_id: sid }; yield { type: "result", result: "did:" + t.message.content }; }
  })(); };
}
// like captureInitQuery but each turn's result text comes from `results` in order
function limitQuery(results: string[], sid = "sdk-lim") {
  let i = 0;
  return ({ prompt }: any) => (async function* () {
    for await (const _t of prompt) {
      yield { type: "system", subtype: "init", session_id: sid };
      yield { type: "result", subtype: "success", result: results[Math.min(i++, results.length - 1)] };
    }
  })();
}

describe("supervisor rewind (W1.1)", () => {
  it("in-place: swaps the pool entry onto resume+resumeSessionAt, SAME daemon id, and clears the anchor after the next submit", async () => {
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureInitQuery(sink, "sdk-1") }, { dir: dir(), idleTimeoutMs: 0 });
    const id = sup.spawn({ model: "m" });
    await sup.submit(id, "turn 1", () => {});                    // captures sdk-1
    const r = await sup.rewind(id, "uuid-anchor");
    expect(r.id).toBe(id);                                       // same daemon session id
    expect(sink).toHaveLength(2);                                // spawn + rewound re-open
    expect(sink[1].resume).toBe("sdk-1");
    expect(sink[1].resumeSessionAt).toBe("uuid-anchor");
    expect(sink[1].forkSession).toBeUndefined();
    // the rewound session is submittable, and the anchor is CLEARED after its first submit —
    // a crash-restart later must not re-truncate the new turns
    await sup.submit(id, "turn 2", () => {});
    await sup.stop(id);                                          // dispose → if rewind leaked into cfg, a restart would re-anchor
    expect(sink).toHaveLength(2);
    await sup.shutdown();
  });
  it("fork: spawns a NEW daemon session anchored on the branch; the original stays live", async () => {
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureInitQuery(sink, "sdk-1") }, { dir: dir(), idleTimeoutMs: 0 });
    const id = sup.spawn({ model: "m" });
    await sup.submit(id, "turn 1", () => {});
    const r = await sup.rewind(id, "uuid-anchor", { fork: true });
    expect(r.id).not.toBe(id);
    expect(sink[1].resume).toBe("sdk-1");
    expect(sink[1].resumeSessionAt).toBe("uuid-anchor");
    expect(sink[1].forkSession).toBe(true);
    await sup.submit(id, "original still works", () => {});      // untouched original
    await sup.shutdown();
  });
  it("throws before the first turn (no sdk session id yet) and for unknown ids", async () => {
    const sup = new DaemonSupervisor({ query: captureInitQuery([], "sdk-1") }, { dir: dir(), idleTimeoutMs: 0 });
    const id = sup.spawn({});
    await expect(sup.rewind(id, "u")).rejects.toThrow(/no session_id yet/);
    await expect(sup.rewind("sess-99", "u")).rejects.toThrow(DaemonError);
    await sup.shutdown();
  });
  it("rewind op parses (messageId required, fork optional)", () => {
    expect(daemonOp.safeParse({ op: "rewind", id: "s", messageId: "u" }).success).toBe(true);
    expect(daemonOp.safeParse({ op: "rewind", id: "s", messageId: "u", fork: true }).success).toBe(true);
    expect(daemonOp.safeParse({ op: "rewind", id: "s" }).success).toBe(false);
  });
});

describe("supervisor limit write-back (W1.3)", () => {
  it("copies the session's limitState into the registry record after each submit, clearing when healthy", async () => {
    const sup = new DaemonSupervisor({ query: limitQuery(["You've hit your usage limit", "all good"]) }, { dir: dir(), idleTimeoutMs: 0 });
    const id = sup.spawn({});
    await sup.submit(id, "one", () => {});
    expect(sup.list().find((r) => r.id === id)?.limit).toMatchObject({ kind: "usage-limit" });
    await sup.submit(id, "two", () => {});
    expect(sup.list().find((r) => r.id === id)?.limit).toBeUndefined();
    await sup.shutdown();
  });
});
