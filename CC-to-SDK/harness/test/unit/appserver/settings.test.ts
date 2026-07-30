// test/unit/appserver/settings.test.ts — Task 9: the four settings setters (model/permissionMode with
// auto self-heal/thinking/settings-apply). Copies Task 6's mkSink/send/parsed/init helpers
// (test/unit/appserver/server.test.ts) so this file reads standalone. Exercises the handlers through the
// full AppServer RPC surface (as turns.test.ts/subscribe.test.ts do), not in isolation, so the
// chain-scoping, mirror write-back, and broadcast fan-out are all proven together against real dispatch.
//
// Engine-faithful fakes (spec Testing, verbatim): a setter fake that resolves after a delay, and one that
// rejects, are both required — the real Session's setters are async RPC round-trips to the CLI child, not
// synchronous flag flips. Default-mode fakes below settle via a bare microtask (Promise.resolve/.reject —
// no timer), which is enough async-ness to prove the handlers correctly `await` rather than assume
// synchronicity, and fully drains within ONE `tick()`; the one dedicated "delay" test below uses a REAL
// setTimeout to prove record.chain serializes two setters end-to-end, not just across a microtask queue.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

type Mode = "ok" | "reject" | "delay";
type Calls = { setModel: unknown[]; setPermissionMode: unknown[]; setMaxThinkingTokens: unknown[]; applyFlagSettings: unknown[] };
function mkCalls(): Calls { return { setModel: [], setPermissionMode: [], setMaxThinkingTokens: [], applyFlagSettings: [] }; }

/** A fully-instrumented fake engine session: every optional Task-9 setter records its arg and can be
 *  independently configured "ok" (default, resolves via a bare microtask), "reject", or "delay" (a real
 *  15ms setTimeout — the engine-faithful async-round-trip shape). */
function fakeSession(calls: Calls, modes: Partial<Record<keyof Calls, Mode>> = {}) {
  const settle = (mode: Mode = "ok"): Promise<void> => {
    if (mode === "reject") return Promise.reject(new Error("setter rejected"));
    if (mode === "delay") return new Promise((r) => setTimeout(r, 15));
    return Promise.resolve();
  };
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: () => () => {},
    sessionId: "sess-1",
    setModel: async (model?: string) => { calls.setModel.push(model); return settle(modes.setModel); },
    setPermissionMode: async (mode: string) => { calls.setPermissionMode.push(mode); return settle(modes.setPermissionMode); },
    setMaxThinkingTokens: async (maxTokens: number | null) => { calls.setMaxThinkingTokens.push(maxTokens); return settle(modes.setMaxThinkingTokens); },
    applyFlagSettings: async (settings: Record<string, unknown>) => { calls.applyFlagSettings.push(settings); return settle(modes.applyFlagSettings); },
  };
}

/** Boots a server, initializes TWO connections (A the actor, B a second subscriber — spec acceptance 5's
 *  unit-level shadow: "second client sees the first client's change"), starts one thread with an optional
 *  seed config, and subscribes both. Returns { srv, a, b, connA, connB, threadId }; both sinks are
 *  cleared after boot so callers' assertions start clean. */
async function bootTwoSubscribers(sessionFactory: () => any, config?: Record<string, unknown>) {
  // listSessions IS DI'd (Task 12): several callers below assert on a thread/list mirror row, and the real
  // store wrapper would otherwise hit this machine's actual ~/.claude/projects (thousands of real sessions).
  const srv = new AppServer({}, { sessionFactory, listSessions: async () => [] });
  const a = mkSink(); const connA = srv.connect(a.sink);
  const b = mkSink(); const connB = srv.connect(b.sink);
  init(connA, 1, "A"); init(connB, 1, "B");
  send(connA, { id: 2, method: "thread/start", params: config ? { config } : {} });
  await tick();
  const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
  send(connA, { id: 90, method: "thread/subscribe", params: { threadId } });
  send(connB, { id: 91, method: "thread/subscribe", params: { threadId } });
  await tick();
  a.lines.length = 0; b.lines.length = 0;
  return { srv, a, b, connA, connB, threadId };
}

describe("appserver settings setters (Task 9)", () => {
  it("thread/model/set: engine called with the model, mirror updated, both subscribers see thread/settings/changed with source:'client'", async () => {
    const calls = mkCalls();
    const { a, b, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls));

    send(connA, { id: 3, method: "thread/model/set", params: { threadId, model: "claude-opus-4-8" } });
    await tick();

    expect(calls.setModel).toEqual(["claude-opus-4-8"]);
    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ ok: true });

    for (const lines of [a.lines, b.lines]) {
      const evt = parsed(lines).find((f) => f.method === "thread/settings/changed");
      expect(evt.params).toEqual({ threadId, source: "client", model: "claude-opus-4-8", permissionMode: undefined, thinkingTokens: undefined });
    }
  });

  it("thread/model/set with model:null resets to default: session.setModel(undefined), mirror stores undefined", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls), { model: "claude-opus-4-8" });

    send(connA, { id: 3, method: "thread/model/set", params: { threadId, model: null } });
    await tick();

    expect(calls.setModel).toEqual([undefined]);
    const evt = parsed(a.lines).find((f) => f.method === "thread/settings/changed");
    expect(evt.params.model).toBeUndefined();
  });

  it("thread/permissionMode/set: engine called with the mode, mirror updated, both subscribers see thread/settings/changed with source:'client'", async () => {
    const calls = mkCalls();
    const { a, b, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls));

    send(connA, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "plan" } });
    await tick();

    expect(calls.setPermissionMode).toEqual(["plan"]);
    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ ok: true });
    for (const lines of [a.lines, b.lines]) {
      const evt = parsed(lines).find((f) => f.method === "thread/settings/changed");
      expect(evt.params).toMatchObject({ threadId, source: "client", permissionMode: "plan" });
    }
  });

  it("thread/thinking/set with a level resolves through thinkBudget (src/tui/thinkLevels.ts) and mirrors the resolved number", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls));

    send(connA, { id: 3, method: "thread/thinking/set", params: { threadId, level: "high" } });
    await tick();

    expect(calls.setMaxThinkingTokens).toEqual([16000]); // thinkBudget("high")
    const evt = parsed(a.lines).find((f) => f.method === "thread/settings/changed");
    expect(evt.params.thinkingTokens).toBe(16000);
  });

  it("thread/thinking/set with maxTokens passes it raw to the engine and mirrors it", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls));

    send(connA, { id: 3, method: "thread/thinking/set", params: { threadId, maxTokens: 12345 } });
    await tick();

    expect(calls.setMaxThinkingTokens).toEqual([12345]);
    const evt = parsed(a.lines).find((f) => f.method === "thread/settings/changed");
    expect(evt.params.thinkingTokens).toBe(12345);
  });

  it("thread/thinking/set with level:'off' resolves to setMaxThinkingTokens(0)", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls));

    send(connA, { id: 3, method: "thread/thinking/set", params: { threadId, level: "off" } });
    await tick();

    expect(calls.setMaxThinkingTokens).toEqual([0]);
    const evt = parsed(a.lines).find((f) => f.method === "thread/settings/changed");
    expect(evt.params.thinkingTokens).toBe(0);
  });

  it("thread/thinking/set with maxTokens:null passes null raw to the engine (its own reset-to-default signal) but mirrors it as undefined (matching seedSettings's 'no thinking config' convention, not a bare number)", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls));

    send(connA, { id: 3, method: "thread/thinking/set", params: { threadId, maxTokens: null } });
    await tick();

    expect(calls.setMaxThinkingTokens).toEqual([null]);
    const evt = parsed(a.lines).find((f) => f.method === "thread/settings/changed");
    expect(evt.params.thinkingTokens).toBeUndefined();
  });

  it("thread/settings/apply: applyFlagSettings called with the settings, no mirror field, no thread/settings/changed broadcast, reply ok", async () => {
    const calls = mkCalls();
    const { a, b, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls));

    send(connA, { id: 3, method: "thread/settings/apply", params: { threadId, settings: { verbose: true } } });
    await tick();

    expect(calls.applyFlagSettings).toEqual([{ verbose: true }]);
    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ ok: true });
    expect(parsed(a.lines).find((f) => f.method === "thread/settings/changed")).toBeUndefined();
    expect(parsed(b.lines).find((f) => f.method === "thread/settings/changed")).toBeUndefined();
  });

  it("a rejecting setModel: error reply, mirror unchanged, no broadcast", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls, { setModel: "reject" }), { model: "claude-a" });

    send(connA, { id: 3, method: "thread/model/set", params: { threadId, model: "claude-b" } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
    expect(reply.error.code).toBe(ERR.INTERNAL);
    expect(parsed(a.lines).find((f) => f.method === "thread/settings/changed")).toBeUndefined();

    // mirror unchanged — a follow-up thread/list must still see claude-a
    send(connA, { id: 4, method: "thread/list", params: {} });
    await tick();
    const list = parsed(a.lines).find((f) => f.id === 4);
    expect(list.result.data.find((t: any) => t.id === threadId).model).toBe("claude-a");
  });

  it("a rejecting setPermissionMode: error reply, mirror unchanged, no broadcast", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls, { setPermissionMode: "reject" }), { permissionMode: "default" });

    send(connA, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "plan" } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
    expect(parsed(a.lines).find((f) => f.method === "thread/settings/changed")).toBeUndefined();

    send(connA, { id: 4, method: "thread/list", params: {} });
    await tick();
    const list = parsed(a.lines).find((f) => f.id === 4);
    expect(list.result.data.find((t: any) => t.id === threadId).permissionMode).toBe("default");
  });

  it("permissionMode/set 'auto' whose heal succeeds but whose setPermissionMode then rejects still announces the genuine model change: mirror model is the healed value, mirror permissionMode is unchanged, a subscriber gets thread/settings/changed{source:'client', model:healed} even though the reply is an error (the heal's setModel really did land on the engine — the write-back-is-the-only-source invariant means that must not go unannounced just because the OVERALL request failed)", async () => {
    const calls = mkCalls();
    const { a, b, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls, { setPermissionMode: "reject" }), { model: "claude-haiku-4-5-20251001", permissionMode: "default" });

    send(connA, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "auto" } });
    await tick();

    expect(calls.setModel).toEqual(["claude-sonnet-4-6"]); // the heal's setModel ran and succeeded
    expect(calls.setPermissionMode).toEqual(["auto"]); // then setPermissionMode ran and rejected

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy(); // the request as a whole still fails

    for (const lines of [a.lines, b.lines]) {
      const evt = parsed(lines).find((f) => f.method === "thread/settings/changed");
      expect(evt).toBeTruthy(); // the genuine model change was NOT silently dropped
      expect(evt.params).toMatchObject({ threadId, source: "client", model: "claude-sonnet-4-6" });
    }

    send(connA, { id: 4, method: "thread/list", params: {} });
    await tick();
    const view = parsed(a.lines).find((f) => f.id === 4).result.data.find((t: any) => t.id === threadId);
    expect(view.model).toBe("claude-sonnet-4-6"); // mirror reflects the real (healed) engine model
    expect(view.permissionMode).toBe("default"); // mirror does NOT reflect the rejected permissionMode change
  });

  it("a rejecting setMaxThinkingTokens: error reply, mirror unchanged, no broadcast", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls, { setMaxThinkingTokens: "reject" }));

    send(connA, { id: 3, method: "thread/thinking/set", params: { threadId, level: "high" } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
    expect(parsed(a.lines).find((f) => f.method === "thread/settings/changed")).toBeUndefined();

    send(connA, { id: 4, method: "thread/list", params: {} });
    await tick();
    const list = parsed(a.lines).find((f) => f.id === 4);
    expect(list.result.data.find((t: any) => t.id === threadId).thinking.maxTokens).toBeUndefined();
  });

  it("a rejecting applyFlagSettings: error reply", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls, { applyFlagSettings: "reject" }));

    send(connA, { id: 3, method: "thread/settings/apply", params: { threadId, settings: { x: 1 } } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
  });

  it("permissionMode/set 'auto' with an unsupported mirrored model self-heals: setModel is called with the healed model BEFORE setPermissionMode, and the resulting thread/settings/changed carries the healed model with source:'client' (never 'engine') — spec Wave 1, unit-pinned per the brief since only a live run would otherwise catch a regression here", async () => {
    const calls = mkCalls();
    const order: string[] = [];
    const sessionFactory = () => {
      const s = fakeSession(calls);
      const origSetModel = s.setModel;
      const origSetPermissionMode = s.setPermissionMode;
      s.setModel = async (m?: string) => { order.push(`setModel:${m}`); return origSetModel(m); };
      s.setPermissionMode = async (m: string) => { order.push(`setPermissionMode:${m}`); return origSetPermissionMode(m); };
      return s;
    };
    const { a, connA, threadId } = await bootTwoSubscribers(sessionFactory, { model: "claude-haiku-4-5-20251001" });

    send(connA, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "auto" } });
    await tick();

    expect(order).toEqual(["setModel:claude-sonnet-4-6", "setPermissionMode:auto"]); // healed model first
    expect(calls.setModel).toEqual(["claude-sonnet-4-6"]);
    expect(calls.setPermissionMode).toEqual(["auto"]);

    const evt = parsed(a.lines).find((f) => f.method === "thread/settings/changed");
    expect(evt.params).toEqual({ threadId, source: "client", model: "claude-sonnet-4-6", permissionMode: "auto", thinkingTokens: undefined });
    expect(evt.params.source).not.toBe("engine");
  });

  it("permissionMode/set 'auto' with an already-supported mirrored model does NOT call setModel (self-heal is a no-op)", async () => {
    const calls = mkCalls();
    const { connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls), { model: "claude-opus-4-8" });

    send(connA, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "auto" } });
    await tick();

    expect(calls.setModel).toEqual([]);
    expect(calls.setPermissionMode).toEqual(["auto"]);
  });

  it("a setter resolving after a REAL delay still serializes through record.chain: a second setter's engine call only fires once the first's has genuinely settled (engine-faithful async round trip, not just a microtask)", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootTwoSubscribers(() => fakeSession(calls, { setModel: "delay" }));

    send(connA, { id: 3, method: "thread/model/set", params: { threadId, model: "claude-a" } });
    send(connA, { id: 4, method: "thread/model/set", params: { threadId, model: "claude-b" } });
    // right after the delayed first call is dispatched, the second must NOT have fired yet
    await tick();
    expect(calls.setModel).toEqual(["claude-a"]);

    await wait(40); // past both 15ms delays
    expect(calls.setModel).toEqual(["claude-a", "claude-b"]); // ordered, not interleaved
    const list = parsed(a.lines);
    expect(list.find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(list.find((f) => f.id === 4).result).toEqual({ ok: true });
  });
});
