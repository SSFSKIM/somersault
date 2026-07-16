import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "@anthropic-ai/claude-agent-sdk";
import { createRedisSessionStore } from "../../src/store/redisSessionStore.js";
import { sessionStoreConformance } from "../../src/store/conformance.js";
import { createFakeRedis } from "./helpers/fakeRedis.js";
import { Session } from "../../src/session/session.js";
import { resolveOptions } from "../../src/config/resolveOptions.js";

// The suite is the executable contract; the SDK's own store must pass the core checks (it defines
// the reference semantics), and our Redis adapter must ALSO pass the SHOULD-level dedup checks.
sessionStoreConformance("InMemorySessionStore (SDK reference)", () => new InMemorySessionStore(), { describe, it, expect });
sessionStoreConformance("RedisSessionStore (fake client)", () => createRedisSessionStore(createFakeRedis()), { describe, it, expect }, { uuidDedup: true });

describe("RedisSessionStore specifics", () => {
  it("namespaces by prefix and encodes hostile key components", async () => {
    const client = createFakeRedis();
    const store = createRedisSessionStore(client, { prefix: "x" });
    await store.append({ projectKey: "/Users/a b:c", sessionId: "s:1" }, [{ type: "user", uuid: "u1" }]);
    const keys = Object.keys((client as any).dump().lists);
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith("x:t:")).toBe(true);
    expect(keys[0].split(":").length).toBe(4); // prefix:t:proj:sess — encoding kept ":" out of components
  });

  it("stamps mtime with the injected clock (shared by index and summary)", async () => {
    const client = createFakeRedis();
    let t = 1000;
    const store = createRedisSessionStore(client, { now: () => t });
    await store.append({ projectKey: "p", sessionId: "s" }, [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } }]);
    t = 2000;
    await store.append({ projectKey: "p", sessionId: "s" }, [{ type: "user", uuid: "u2" }]);
    expect(await store.listSessions!("p")).toEqual([{ sessionId: "s", mtime: 2000 }]);
    expect((await store.listSessionSummaries!("p"))[0].mtime).toBe(2000);
  });

  it("load() distinguishes never-written from an all-duplicate (emptied) key", async () => {
    const store = createRedisSessionStore(createFakeRedis());
    const key = { projectKey: "p", sessionId: "s" };
    expect(await store.load(key)).toBeNull();
    await store.append(key, [{ type: "user", uuid: "u1" }]);
    await store.append(key, [{ type: "user", uuid: "u1" }]); // pure replay
    expect((await store.load(key))!.length).toBe(1);
  });

  it("a rejecting client call fails that append but the chain keeps serving later batches", async () => {
    const client = createFakeRedis();
    let failFirst = true;
    const flaky = { ...client, rpush: async (k: string, ...v: string[]) => { if (failFirst) { failFirst = false; throw new Error("redis down"); } return client.rpush(k, ...v); } };
    const store = createRedisSessionStore(flaky);
    const key = { projectKey: "p", sessionId: "s" };
    await expect(store.append(key, [{ type: "user", uuid: "u1" }])).rejects.toThrow("redis down");
    await store.append(key, [{ type: "user", uuid: "u2" }]); // chain survives the rejection
    expect((await store.load(key))!.map((e) => e.uuid)).toEqual(["u2"]);
  });

  it("a failed write does NOT mark uuids seen — the SDK's retry recovers the batch", async () => {
    const client = createFakeRedis();
    let failFirst = true;
    const flaky = { ...client, rpush: async (k: string, ...v: string[]) => { if (failFirst) { failFirst = false; throw new Error("redis down"); } return client.rpush(k, ...v); } };
    const store = createRedisSessionStore(flaky);
    const key = { projectKey: "p", sessionId: "s" };
    await expect(store.append(key, [{ type: "user", uuid: "u1" }])).rejects.toThrow("redis down");
    await store.append(key, [{ type: "user", uuid: "u1" }]); // the retry replays the same batch
    expect((await store.load(key))!.map((e) => e.uuid)).toEqual(["u1"]); // recovered, not skipped-as-dup
  });

  it("delete() sweeps subagent transcripts and both index rows", async () => {
    const client = createFakeRedis();
    const store = createRedisSessionStore(client);
    const main = { projectKey: "p", sessionId: "s" };
    await store.append(main, [{ type: "user", uuid: "u1" }]);
    await store.append({ ...main, subpath: "subagents/a.jsonl" }, [{ type: "user", uuid: "u2" }]);
    await store.delete!(main);
    expect(await store.load(main)).toBeNull();
    expect(await store.load({ ...main, subpath: "subagents/a.jsonl" })).toBeNull();
    expect(await store.listSessions!("p")).toEqual([]);
    expect(await store.listSessionSummaries!("p")).toEqual([]);
    expect(await store.listSubkeys!(main)).toEqual([]);
  });
});

describe("mirror_error surfacing (Session)", () => {
  function framesQuery(extra: (turn: number) => any[]) {
    return ({ prompt }: any) => (async function* () {
      let i = 0;
      for await (const t of prompt) {
        for (const f of extra(i)) yield f;
        i++;
        yield { type: "result", subtype: "success", result: "did:" + t.message.content };
      }
    })();
  }

  it("captures system/mirror_error frames into the bounded ring", async () => {
    const frame = { type: "system", subtype: "mirror_error", error: "redis down", key: { projectKey: "p", sessionId: "s" }, uuid: "x", session_id: "s" };
    const s = new Session({ query: framesQuery(() => [frame, frame]) }, {}, { now: () => 123 });
    expect(s.mirrorErrors).toEqual([]);
    await s.submit("one");
    expect(s.mirrorErrors).toEqual([
      { error: "redis down", key: { projectKey: "p", sessionId: "s" }, at: 123 },
      { error: "redis down", key: { projectKey: "p", sessionId: "s" }, at: 123 },
    ]);
    await s.dispose();
  });

  it("ring is bounded to the last 50", async () => {
    const frame = { type: "system", subtype: "mirror_error", error: "e", key: { projectKey: "p", sessionId: "s" } };
    const s = new Session({ query: framesQuery(() => Array.from({ length: 60 }, () => frame)) }, {});
    await s.submit("one");
    expect(s.mirrorErrors.length).toBe(50);
    await s.dispose();
  });
});

describe("sessionStore config knobs (resolveOptions)", () => {
  it("passes flush cadence and load timeout through under the SDK names", () => {
    const store = new InMemorySessionStore();
    const o = resolveOptions({ sessionStore: store, sessionStoreFlush: "eager", sessionStoreLoadTimeoutMs: 5000 }) as any;
    expect(o.sessionStore).toBe(store);
    expect(o.sessionStoreFlush).toBe("eager");
    expect(o.loadTimeoutMs).toBe(5000);
  });
  it("a sessionStore flips the enableFileCheckpointing default off (SDK rejects the pair)", () => {
    const store = new InMemorySessionStore();
    expect((resolveOptions({ sessionStore: store }) as any).enableFileCheckpointing).toBe(false);
    expect((resolveOptions({}) as any).enableFileCheckpointing).toBe(true);
    // explicit true passes through — the SDK's own intake error is the caller's feedback
    expect((resolveOptions({ sessionStore: store, enableFileCheckpointing: true }) as any).enableFileCheckpointing).toBe(true);
  });
  it("omits them when unset", () => {
    const o = resolveOptions({}) as any;
    expect(o).not.toHaveProperty("sessionStoreFlush");
    expect(o).not.toHaveProperty("loadTimeoutMs");
  });
});
