// W3.3 live: external sessionStore mirror → cross-host resume. The resume leg runs with a FRESH
// CLAUDE_CONFIG_DIR (no local transcript), so recall can only come from sessionStore.load() —
// the cross-host scenario, simulated on one machine.
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionStore } from "@anthropic-ai/claude-agent-sdk";
import { openSession, resumeSession } from "../../src/session/index.js";
import { createRedisSessionStore } from "../../src/store/redisSessionStore.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("sessionStore mirror + cross-host resume (live)", () => {
  it("mirrors turn 1 into the store and resumes from the store alone", async () => {
    const store = new InMemorySessionStore();
    const cwd = mkdtempSync(join(tmpdir(), "store-live-"));
    const configA = mkdtempSync(join(tmpdir(), "cfg-a-"));
    const configB = mkdtempSync(join(tmpdir(), "cfg-b-")); // "other host": no local transcripts

    const s1 = openSession({
      cwd, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 2,
      sessionStore: store, sessionStoreFlush: "eager",
      env: { CLAUDE_CONFIG_DIR: configA },
    });
    let sessionId: string | undefined;
    try {
      await s1.submit("Remember the codeword: PLUM-42. Reply with exactly: SAVED");
      sessionId = s1.sessionId;
    } finally { await s1.dispose(); }
    expect(sessionId).toBeTruthy();
    expect(store.size).toBeGreaterThan(0); // the mirror actually received entries

    const s2 = resumeSession(sessionId!, {
      cwd, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 2,
      sessionStore: store,
      env: { CLAUDE_CONFIG_DIR: configB },
    });
    try {
      const { result } = await s2.submit("What is the codeword I asked you to remember? Reply with just the codeword.");
      expect(String(result)).toContain("PLUM-42");
    } finally { await s2.dispose(); }
  }, 180_000);
});

// Gated integration: a REAL Redis (set REDIS_URL and have ioredis importable — e.g. npm i -D ioredis).
const redisLive = process.env.REDIS_URL ? describe : describe.skip;
redisLive("RedisSessionStore against a real Redis", () => {
  it("append/load/listSessions/dedup round-trip", async () => {
    const { default: Redis } = await import("ioredis" as string);
    const client = new Redis(process.env.REDIS_URL!);
    try {
      const store = createRedisSessionStore(client, { prefix: `ccs-test-${Date.now()}` });
      const key = { projectKey: "itest", sessionId: "s1" };
      await store.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } }]);
      await store.append(key, [{ type: "user", uuid: "u1" }, { type: "user", uuid: "u2" }]);
      expect((await store.load(key))!.map((e) => e.uuid)).toEqual(["u1", "u2"]);
      expect((await store.listSessions!("itest")).map((r) => r.sessionId)).toEqual(["s1"]);
      await store.delete!(key);
      expect(await store.load(key)).toBeNull();
    } finally { client.disconnect(); }
  }, 30_000);
});
