// test/unit/appserver/introspect.test.ts — Task 10: the five introspection reads (capabilities/
// contextUsage/usage/init/account). Copies Task 9's mkSink/send/parsed/init/tick helpers
// (test/unit/appserver/settings.test.ts) so this file reads standalone.
//
// Engine-faithful fakes (spec Testing, verbatim): a fake missing an optional method entirely (to prove
// -32601, not a crash) and a fake whose read rejects are both required — the real Session's reads are
// async RPC round-trips to the CLI child (session.ts), not synchronous getters.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

/** A bare-minimum fake engine session — the five introspection reads are the ONLY optional methods this
 *  fixture may add per-test, so a missing one genuinely means "this engine doesn't implement it" rather
 *  than an oversight. `ended` toggles isEnded() for the dead-engine guard test. */
function fakeSession(opts: { ended?: boolean } = {}) {
  let ended = opts.ended ?? false;
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: () => () => {},
    sessionId: "sess-1",
    isEnded: () => ended,
    end: () => { ended = true; },
  };
}

async function bootOneThread(sessionFactory: () => any, config?: Record<string, unknown>) {
  const srv = new AppServer({}, { sessionFactory });
  const a = mkSink(); const connA = srv.connect(a.sink);
  init(connA, 1, "A");
  send(connA, { id: 2, method: "thread/start", params: config ? { config } : {} });
  await tick();
  const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
  a.lines.length = 0;
  return { srv, a, connA, threadId };
}

describe("appserver introspection reads (Task 10)", () => {
  it("thread/capabilities/read replies { capabilities } from the engine's value", async () => {
    const capabilities = { models: ["opus"], commands: ["/compact"], mcpServers: [] };
    const session = Object.assign(fakeSession(), { capabilities: async () => capabilities });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/capabilities/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ capabilities });
  });

  it("thread/capabilities/read carries the engine's `agents` catalog through to the wire — the projection is verbatim, so a fourth catalog must not be dropped on the way out", async () => {
    const capabilities = { models: ["opus"], commands: ["/compact"], mcpServers: [], agents: [{ name: "Explore" }] };
    const session = Object.assign(fakeSession(), { capabilities: async () => capabilities });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/capabilities/read", params: { threadId } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).result.capabilities.agents).toEqual([{ name: "Explore" }]);
  });

  it("thread/contextUsage/read replies { contextUsage } from the engine's value", async () => {
    const contextUsage = { usedTokens: 1000, maxTokens: 200000 };
    const session = Object.assign(fakeSession(), { getContextUsage: async () => contextUsage });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/contextUsage/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ contextUsage });
  });

  it("thread/usage/read replies { usage } from the engine's value", async () => {
    const usage = { inputTokens: 42 };
    const session = Object.assign(fakeSession(), { usage: async () => usage });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/usage/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ usage });
  });

  it("thread/init/read replies { init } from the engine's value", async () => {
    const initResult = { commands: [], agents: [] };
    const session = Object.assign(fakeSession(), { initializationResult: async () => initResult });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/init/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ init: initResult });
  });

  it("account/read replies { account } from the engine's value, keyed by threadId (server-scoped read through a thread's engine)", async () => {
    const account = { email: "user@example.com" };
    const session = Object.assign(fakeSession(), { accountInfo: async () => account });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "account/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ account });
  });

  it("a dead engine (isEnded true) answers -33005 via the dispatch guard (Task 3) — proves the guard covers these new methods too", async () => {
    const session = fakeSession({ ended: true });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/capabilities/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
    expect(reply.error.code).toBe(ERR.ENGINE_GONE);
  });

  it("a fake missing an optional method entirely (no usage()) answers -32601 method-not-found, not a crash", async () => {
    const session = fakeSession(); // no usage() at all
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/usage/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
    expect(reply.error.code).toBe(ERR.METHOD_NOT_FOUND);
    expect(reply.error.message).toBe("unsupported by this engine");
  });

  it("a read that rejects replies an error, not a hang", async () => {
    const session = Object.assign(fakeSession(), { getContextUsage: async () => { throw new Error("boom"); } });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/contextUsage/read", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
    expect(reply.error.code).toBe(ERR.INTERNAL);
  });

  it("thread/capabilities/read for an unknown threadId answers THREAD_NOT_FOUND", async () => {
    const { a, connA } = await bootOneThread(() => fakeSession());

    send(connA, { id: 3, method: "thread/capabilities/read", params: { threadId: "thr_nope" } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error).toBeTruthy();
    expect(reply.error.code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("a read does not queue behind record.chain (un-chained): fired while a slow chained setter is still pending, it replies before that setter does", async () => {
    // thread/model/set holds record.chain open for a REAL 15ms (settings.ts's engine-faithful "delay"
    // shape, mirrored from settings.test.ts) — if the read were queued through the same chain (as the
    // Task 9 setters are) it would be stuck behind it too and NOT reply within the first tick.
    const session = Object.assign(fakeSession(), {
      setModel: () => new Promise((r) => setTimeout(r, 15)),
      capabilities: async () => ({ models: [], commands: [], mcpServers: [] }),
    });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "thread/model/set", params: { threadId, model: "claude-a" } });
    send(connA, { id: 4, method: "thread/capabilities/read", params: { threadId } });
    await tick();

    // The read has already replied; the chained setter — still 15ms out — has not.
    expect(parsed(a.lines).find((f) => f.id === 4)?.result).toEqual({ capabilities: { models: [], commands: [], mcpServers: [] } });
    expect(parsed(a.lines).find((f) => f.id === 3)).toBeUndefined();

    await new Promise((r) => setTimeout(r, 25)); // past the 15ms delay
    expect(parsed(a.lines).find((f) => f.id === 3)?.result).toEqual({ ok: true });
  });
});
