import { randomUUID } from "node:crypto";
import type { SDKMessageOrigin } from "@anthropic-ai/claude-agent-sdk";
import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";

function successFor(turn: any, result: string, origin?: SDKMessageOrigin) {
  return {
    type: "result", subtype: "success", duration_ms: 0, duration_api_ms: 0,
    user_message_uuid: turn.uuid, is_error: false, num_turns: 1, result, stop_reason: null,
    total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [],
    ...(origin ? { origin } : {}), uuid: randomUUID(), session_id: "sid",
  };
}
function errorFor(origin?: SDKMessageOrigin) {
  return {
    type: "result", subtype: "error_during_execution", duration_ms: 0, duration_api_ms: 0,
    is_error: true, num_turns: 1, stop_reason: null, total_cost_usd: 0, usage: {},
    modelUsage: {}, permission_denials: [], errors: ["failed"],
    ...(origin ? { origin } : {}), uuid: randomUUID(), session_id: "sid",
  };
}

function fakeQuery({ prompt }: any) {
  return (async function* () {
    for await (const turn of prompt) {
      const text = turn.message.content;
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack:" + text }] } };
      yield successFor(turn, "did:" + text, { kind: "human" });
    }
  })();
}
function captureQuery(sink: any[]) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const t of prompt) yield successFor(t, "ok:" + t.message.content, { kind: "human" }); })(); };
}
function compactQuery(seen: string[]) {
  return ({ prompt }: any) => (async function* () {
    for await (const t of prompt) {
      const text = t.message.content; seen.push(text);
      if (text === "/compact") {
        yield { type: "system", subtype: "status", status: "compacting" };
        yield { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 1000, post_tokens: 200 } };
        yield { type: "system", subtype: "status", status: null, compact_result: "success" };
        yield successFor(t, "compacted", { kind: "human" });
      } else yield successFor(t, "did:" + text, { kind: "human" });
    }
  })();
}
// emits a system/init carrying session_id before each turn's result
function initQuery(ids: string[]) {
  return ({ prompt }: any) => (async function* () {
    let i = 0;
    for await (const t of prompt) {
      yield { type: "system", subtype: "init", session_id: ids[Math.min(i, ids.length - 1)] }; i++;
      yield successFor(t, "did:" + t.message.content, { kind: "human" });
    }
  })();
}

function framedQuery() {
  const frames = new AsyncQueue<unknown>(), prompts: string[] = [], turns: any[] = [];
  const query = ({ prompt }: any) => {
    void (async () => { for await (const turn of prompt) { turns.push(turn); prompts.push(turn.message.content); } })();
    return { [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator]() };
  };
  return { frames, prompts, turns, query };
}
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

// returns a generator-object carrying the introspection control methods
function methodQuery(rec: any) {
  return ({ prompt }: any) => {
    const it: any = (async function* () { for await (const t of prompt) yield successFor(t, "did:" + t.message.content, { kind: "human" }); })();
    it.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () => ({ session: { total_cost_usd: 2 } });
    it.initializationResult = async () => ({ models: ["m"], account: {} });
    it.applyFlagSettings = async (s: any) => { rec.applied = s; };
    it.request = async (payload: any) => { rec.requested = payload; return { response: { effective: {}, sources: [], applied: [] } }; };
    return it;
  };
}

describe("Session", () => {
  it("submit streams non-result messages then resolves with the turn result", async () => {
    const chunks: any[] = [];
    const s = new Session({ query: fakeQuery }, {});
    const r = await s.submit("hello", (m) => chunks.push(m));
    expect(r.result).toBe("did:hello");
    expect(chunks.map((c: any) => c.type)).toEqual(["assistant"]);
    await s.dispose();
  });
  it("submit defaults onMessage to a no-op (callable with just a prompt)", async () => {
    const s = new Session({ query: fakeQuery }, {});
    expect((await s.submit("x")).result).toBe("did:x");
    await s.dispose();
  });
  it("advances lastActiveAt off an injected clock", async () => {
    let t = 100;
    const s = new Session({ query: fakeQuery }, {}, { now: () => t });
    expect(s.lastActiveAt).toBe(100);
    t = 250;
    await s.submit("x");
    expect(s.lastActiveAt).toBe(250);
    await s.dispose();
  });
  it("handles two sequential submits in FIFO order", async () => {
    const s = new Session({ query: fakeQuery }, {});
    expect((await s.submit("a")).result).toBe("did:a");
    expect((await s.submit("b")).result).toBe("did:b");
    await s.dispose();
  });
  it("rejects submit once ended, using the label in the message", async () => {
    const s = new Session({ query: fakeQuery }, {}, { label: "lib-sess" });
    await s.submit("a");
    await s.dispose();
    await expect(s.submit("b")).rejects.toThrow(/lib-sess is not running/);
  });
  it("rejects an in-flight submit when disposed mid-turn", async () => {
    const fq = ({ prompt }: any) => (async function* () { for await (const t of prompt) { void t; } })();
    const s = new Session({ query: fq }, {});
    const p = s.submit("x");
    await s.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });
  it("exposes a done promise that resolves when the query ends", async () => {
    const s = new Session({ query: fakeQuery }, {});
    let ended = false;
    s.done.then(() => { ended = true; });
    await s.dispose();
    await Promise.resolve();
    expect(ended).toBe(true);
  });
  it("submit resolves with structuredOutput alongside result when the SDK result carries structured_output (probe 36, additive)", async () => {
    const q = ({ prompt }: any) => (async function* () {
      for await (const t of prompt) yield { ...successFor(t, "did:" + t.message.content, { kind: "human" }), structured_output: { verdict: "approve" } };
    })();
    const s = new Session({ query: q }, {});
    const r: any = await s.submit("hi");
    expect(r.result).toBe("did:hi");
    expect(r.structuredOutput).toEqual({ verdict: "approve" });
    await s.dispose();
  });
  it("submit resolves with structuredOutput undefined when the SDK result carries none (existing callers destructuring {result} unaffected)", async () => {
    const s = new Session({ query: fakeQuery }, {});
    const r: any = await s.submit("hello");
    expect(r.result).toBe("did:hello");
    expect(r.structuredOutput).toBeUndefined();
    await s.dispose();
  });
  it("captures session_id from the first init frame; undefined before the first turn", async () => {
    const s = new Session({ query: initQuery(["sid-A"]) }, {});
    expect(s.sessionId).toBeUndefined();
    await s.submit("hi");
    expect(s.sessionId).toBe("sid-A");
    await s.dispose();
  });
  it("captures session_id ONCE and keeps the first id across turns", async () => {
    const s = new Session({ query: initQuery(["sid-1", "sid-2"]) }, {});
    await s.submit("a");
    await s.submit("b");
    expect(s.sessionId).toBe("sid-1");
    await s.dispose();
  });
  it("contextTool wires cc-context into the query options", async () => {
    const sink: any[] = [];
    const s = new Session({ query: captureQuery(sink) }, {}, { contextTool: true });
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect(sink[0].allowedTools).toContain("mcp__cc-context__GetContextUsage");
    await s.dispose();
  });
  it("no tools → options reach the query untouched", async () => {
    const sink: any[] = [];
    const s = new Session({ query: captureQuery(sink) }, {});
    expect(sink[0].mcpServers).toBeUndefined();
    await s.dispose();
  });
  it("contextTool + compactTool both merge their servers", async () => {
    const sink: any[] = [];
    const s = new Session({ query: captureQuery(sink) }, {}, { contextTool: true, compactTool: true });
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect((sink[0].mcpServers as any)["cc-compact"]).toBeTruthy();
    expect(sink[0].allowedTools).toEqual(expect.arrayContaining(["mcp__cc-context__GetContextUsage", "mcp__cc-compact__RequestCompaction"]));
    await s.dispose();
  });
  it("compact() injects /compact and returns the parsed outcome", async () => {
    const seen: string[] = [];
    const s = new Session({ query: compactQuery(seen) }, {});
    expect(await s.compact()).toEqual({ ok: true, result: "success", error: undefined, preTokens: 1000, postTokens: 200 });
    expect(seen).toEqual(["/compact"]);
    await s.dispose();
  });
  it("requestCompaction fires exactly one /compact at the turn boundary; FIFO intact", async () => {
    const seen: string[] = [];
    const s = new Session({ query: compactQuery(seen) }, {});
    s.requestCompaction();
    expect((await s.submit("hello")).result).toBe("did:hello");
    expect((await s.submit("world")).result).toBe("did:world");
    await s.dispose();
    expect(seen).toEqual(["hello", "/compact", "world"]);
  });
  it("keeps a human submit pending for a task result with its UUID while onFrame still sees it", async () => {
    const { frames, query, turns } = framedQuery();
    const s = new Session({ query }, {});
    const frameSeen: unknown[] = [], messages: unknown[] = [];
    s.onFrame((m) => frameSeen.push(m));
    let settled = false;
    const turn = s.submit("human", (m) => messages.push(m)).then((r) => { settled = true; return r; });
    await nextTick();
    expect(turns[0]).toMatchObject({ uuid: expect.any(String), origin: { kind: "human" } });
    const taskResult = successFor(turns[0], "background", { kind: "task-notification" });
    frames.push(taskResult);
    await nextTick();
    expect(frameSeen).toEqual([taskResult]);
    expect(messages).toEqual([]);
    expect(settled).toBe(false);
    frames.push(successFor(turns[0], "human", { kind: "human" }));
    expect((await turn).result).toBe("human");
    frames.close(); await s.dispose();
  });
  it("settles only the second waiter when its success arrives first", async () => {
    const { frames, query, turns } = framedQuery();
    const s = new Session({ query }, {});
    let firstSettled = false, secondSettled = false;
    const first = s.submit("one").then((r) => { firstSettled = true; return r; });
    const second = s.submit("two").then((r) => { secondSettled = true; return r; });
    await nextTick();
    expect(turns[0].uuid).not.toBe(turns[1].uuid);
    frames.push(successFor(turns[1], "second", { kind: "human" }));
    await nextTick();
    expect(secondSettled).toBe(true);
    expect(firstSettled).toBe(false);
    frames.push(successFor(turns[0], "first"));
    expect((await first).result).toBe("first");
    expect((await second).result).toBe("second");
    frames.close(); await s.dispose();
  });
  it("keeps an origin-absent success without a UUID pending", async () => {
    const { frames, query, turns } = framedQuery();
    const s = new Session({ query }, {});
    let settled = false;
    const turn = s.submit("legacy").then((r) => { settled = true; return r; });
    await nextTick();
    frames.push({ ...successFor(turns[0], "legacy-result"), user_message_uuid: undefined });
    await nextTick();
    expect(settled).toBe(false);
    frames.push(successFor(turns[0], "legacy-result"));
    expect((await turn).result).toBe("legacy-result");
    frames.close(); await s.dispose();
  });
  it("keeps a human success with an unseen UUID pending and does not update limits", async () => {
    const { frames, query, turns } = framedQuery();
    const s = new Session({ query }, {});
    let settled = false;
    const turn = s.submit("human").then((r) => { settled = true; return r; });
    await nextTick();
    frames.push({ ...successFor(turns[0], "Credit balance is too low", { kind: "human" }), user_message_uuid: randomUUID() });
    await nextTick();
    expect(settled).toBe(false);
    expect(s.limitState).toBeUndefined();
    frames.push(successFor(turns[0], "human", { kind: "human" }));
    expect((await turn).result).toBe("human");
    frames.close(); await s.dispose();
  });
  it("keeps an origin-absent error pending", async () => {
    const { frames, query, turns } = framedQuery();
    const s = new Session({ query }, {});
    let settled = false;
    const turn = s.submit("human").then((r) => { settled = true; return r; });
    await nextTick();
    frames.push(errorFor());
    await nextTick();
    expect(settled).toBe(false);
    frames.push(successFor(turns[0], "human", { kind: "human" }));
    expect((await turn).result).toBe("human");
    frames.close(); await s.dispose();
  });
  it("allows an explicit-human error to settle the FIFO waiter", async () => {
    const { frames, query } = framedQuery();
    const s = new Session({ query }, {});
    const turn = s.submit("human");
    await nextTick();
    frames.push(errorFor({ kind: "human" }));
    expect((await turn).result).toBeUndefined();
    frames.close(); await s.dispose();
  });
  it("does not consume requested compaction on an unassociated success", async () => {
    const { frames, prompts, query, turns } = framedQuery();
    const s = new Session({ query }, {});
    s.requestCompaction();
    const turn = s.submit("work");
    await nextTick();
    expect(prompts).toEqual(["work"]);
    frames.push({ ...successFor(turns[0], "background"), user_message_uuid: randomUUID() });
    await nextTick();
    expect(prompts).toEqual(["work"]);
    frames.push(successFor(turns[0], "work-done", { kind: "human" }));
    expect((await turn).result).toBe("work-done");
    await nextTick();
    expect(prompts).toEqual(["work", "/compact"]);
    frames.push(successFor(turns[1], "compacted", { kind: "human" }));
    frames.close(); await s.dispose();
  });
  it("stream yields the turn's messages then a terminal result frame", async () => {
    const s = new Session({ query: fakeQuery }, {});
    const seen: any[] = [];
    for await (const m of s.stream("hi")) seen.push(m);
    expect(seen.map((m: any) => m.type)).toEqual(["assistant", "result"]);
    expect(seen[seen.length - 1]).toEqual({ type: "result", result: "did:hi" });
    await s.dispose();
  });
  it("stream yields a terminal error frame when the turn rejects (session ended)", async () => {
    const s = new Session({ query: fakeQuery }, {}, { label: "x" });
    await s.dispose();
    const seen: any[] = [];
    for await (const m of s.stream("hi")) seen.push(m);
    expect(seen).toEqual([{ type: "error", error: "x is not running" }]);
  });
  it("usage()/initializationResult() delegate; applyFlagSettings forwards its arg", async () => {
    const rec: any = {};
    const s = new Session({ query: methodQuery(rec) }, {});
    expect(await s.usage()).toEqual({ session: { total_cost_usd: 2 } });
    expect(await s.initializationResult()).toEqual({ models: ["m"], account: {} });
    await s.applyFlagSettings({ outputStyle: "explanatory" });
    expect(rec.applied).toEqual({ outputStyle: "explanatory" });
    await s.dispose();
  });
  it("getSettings rides the untyped request door with subtype:get_settings and unwraps .response", async () => {
    const rec: any = {};
    const s = new Session({ query: methodQuery(rec) }, {});
    expect(await s.getSettings()).toEqual({ effective: {}, sources: [], applied: [] });
    expect(rec.requested).toEqual({ subtype: "get_settings" });
    await s.dispose();
  });
  it("getSettings falls back to the raw response when there is no .response wrapper", async () => {
    const s = new Session({ query: ({ prompt }: any) => {
      const it: any = (async function* () { for await (const t of prompt) yield successFor(t, "did:" + t.message.content, { kind: "human" }); })();
      it.request = async () => ({ effective: { x: 1 } });   // no .response key
      return it;
    } }, {});
    expect(await s.getSettings()).toEqual({ effective: { x: 1 } });
    await s.dispose();
  });
  it("usage() rejects once the session has ended", async () => {
    const s = new Session({ query: methodQuery({}) }, {}, { label: "lib-sess" });
    await s.dispose();
    await expect(s.usage()).rejects.toThrow(/lib-sess is not running/);
  });
});
