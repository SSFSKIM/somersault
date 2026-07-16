// W3.3 — the SessionStore conformance suite: executable form of the sdk.d.ts SessionStore contract.
// Adapter authors run it as `sessionStoreConformance("my adapter", () => makeStore())` inside vitest.
// Core checks hold for ANY store (the SDK's own InMemorySessionStore passes); `uuidDedup: true` adds
// the SHOULD-level idempotency checks that real external adapters are expected to implement (the
// in-memory store deliberately does not).
import type { SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

// vitest globals are injected by the caller's test context; typed loosely so this module has no
// hard vitest dependency when imported from application code.
type SuiteFns = {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void> | void) => void;
  expect: (v: unknown) => any;
};

export interface ConformanceOpts {
  /** Also assert uuid-idempotent append (SHOULD-level; real adapters). Default false. */
  uuidDedup?: boolean;
}

const e = (uuid: string, n: number): SessionStoreEntry => ({ type: "user", uuid, timestamp: `2026-07-17T00:00:0${n}Z`, message: { role: "user", content: `m${n}` } });

export function sessionStoreConformance(name: string, makeStore: () => SessionStore | Promise<SessionStore>, fns: SuiteFns, opts: ConformanceOpts = {}): void {
  const { describe, it, expect } = fns;
  describe(`SessionStore conformance: ${name}`, () => {
    it("load() returns null for a never-written key", async () => {
      const s = await makeStore();
      expect(await s.load({ projectKey: "p", sessionId: "nope" })).toBeNull();
    });

    it("append() preserves call order and load() round-trips deep-equal", async () => {
      const s = await makeStore();
      const key = { projectKey: "p", sessionId: "s1" };
      await s.append(key, [e("a", 1), e("b", 2)]);
      await s.append(key, [e("c", 3)]);
      const loaded = await s.load(key);
      expect(loaded).toEqual([e("a", 1), e("b", 2), e("c", 3)]);
    });

    it("entries without a uuid append as-is (titles/tags/markers)", async () => {
      const s = await makeStore();
      const key = { projectKey: "p", sessionId: "s2" };
      await s.append(key, [{ type: "title", title: "x" }, { type: "title", title: "x" }]);
      expect((await s.load(key))!.length).toBe(2);
    });

    it("keys are isolated across sessionId, projectKey and subpath", async () => {
      const s = await makeStore();
      await s.append({ projectKey: "p", sessionId: "s3" }, [e("a", 1)]);
      await s.append({ projectKey: "p", sessionId: "s3", subpath: "subagents/x.jsonl" }, [e("b", 2)]);
      await s.append({ projectKey: "q", sessionId: "s3" }, [e("c", 3)]);
      expect((await s.load({ projectKey: "p", sessionId: "s3" }))!.map((x) => x.uuid)).toEqual(["a"]);
      expect((await s.load({ projectKey: "p", sessionId: "s3", subpath: "subagents/x.jsonl" }))!.map((x) => x.uuid)).toEqual(["b"]);
      expect((await s.load({ projectKey: "q", sessionId: "s3" }))!.map((x) => x.uuid)).toEqual(["c"]);
    });

    it("listSessions() reports each session once with a numeric mtime", async () => {
      const s = await makeStore();
      if (!s.listSessions) return; // optional per contract
      await s.append({ projectKey: "p", sessionId: "s4" }, [e("a", 1)]);
      await s.append({ projectKey: "p", sessionId: "s5" }, [e("b", 2)]);
      await s.append({ projectKey: "p", sessionId: "s4" }, [e("c", 3)]);
      const list = await s.listSessions("p");
      expect(list.map((r) => r.sessionId).sort()).toEqual(["s4", "s5"]);
      for (const r of list) expect(typeof r.mtime).toBe("number");
    });

    it("listSessionSummaries() folds set-once + last-wins fields per session", async () => {
      const s = await makeStore();
      if (!s.listSessionSummaries) return; // optional per contract
      const key = { projectKey: "p", sessionId: "s6" };
      await s.append(key, [e("a", 1)]);
      await s.append(key, [e("b", 2)]);
      const [sum] = await s.listSessionSummaries("p");
      expect(sum.sessionId).toBe("s6");
      expect(typeof sum.mtime).toBe("number");
      expect(sum.data.firstPrompt).toBe("m1"); // set-once froze on first sight
    });

    it("subagent transcripts surface through listSubkeys()", async () => {
      const s = await makeStore();
      if (!s.listSubkeys) return; // optional per contract
      const main = { projectKey: "p", sessionId: "s7" };
      await s.append(main, [e("a", 1)]);
      await s.append({ ...main, subpath: "subagents/t1.jsonl" }, [e("b", 2)]);
      await s.append({ ...main, subpath: "subagents/t2.jsonl" }, [e("c", 3)]);
      expect((await s.listSubkeys(main)).sort()).toEqual(["subagents/t1.jsonl", "subagents/t2.jsonl"]);
    });

    it("delete() removes the session (subsequent load → null-or-empty; gone from listSessions)", async () => {
      const s = await makeStore();
      if (!s.delete) return; // optional per contract (WORM stores)
      const key = { projectKey: "p", sessionId: "s8" };
      await s.append(key, [e("a", 1)]);
      await s.delete(key);
      const after = await s.load(key);
      expect(after === null || after.length === 0).toBe(true);
      if (s.listSessions) expect((await s.listSessions("p")).map((r) => r.sessionId)).not.toContain("s8");
    });

    if (opts.uuidDedup) {
      it("re-appending an already-seen uuid is idempotent (retry/replay safety)", async () => {
        const s = await makeStore();
        const key = { projectKey: "p", sessionId: "s9" };
        await s.append(key, [e("a", 1), e("b", 2)]);
        await s.append(key, [e("a", 1)]); // SDK retry replays the batch
        await s.append(key, [e("b", 9), e("c", 3)]); // same uuid, drifted payload — uuid wins
        const rows = await s.load(key);
        expect(rows!.map((x) => x.uuid)).toEqual(["a", "b", "c"]);
        expect((rows![1] as any).message.content).toBe("m2"); // the FIRST-seen payload survived
      });

      it("concurrent appends to one session serialize (summary sidecar stays consistent)", async () => {
        const s = await makeStore();
        const key = { projectKey: "p", sessionId: "s10" };
        await Promise.all(Array.from({ length: 8 }, (_, i) => s.append(key, [e(`u${i}`, i)])));
        expect((await s.load(key))!.length).toBe(8);
        if (s.listSessionSummaries) {
          const sums = await s.listSessionSummaries("p");
          expect(sums.filter((x) => x.sessionId === "s10").length).toBe(1);
        }
      });
    }
  });
}
