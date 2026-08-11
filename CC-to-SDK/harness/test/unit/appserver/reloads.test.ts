// test/unit/appserver/reloads.test.ts — M2b Task 5: `plugin/reload` and `skill/reload`, promoted from
// probe 105 (both ALIVE). Driven through the full AppServer RPC surface like the rest of the M2b cluster
// tests. The two handlers are the same shape twice over, so every case below runs as a table.
//
// Probe 105's receipt is what makes these more than acks: each SDK call answers with a FRESH CATALOG
// (commands+agents+plugins+mcpServers for plugins, skills for skills) rather than a bare ok — a reload IS
// a capabilities refresh — so each handler pings `thread/capabilities/changed` after its reply, exactly as
// lifecycle.ts's reinitialize and mcp.ts's three topology mutations do. The reply itself stays the fixed
// `{ok:true}` the promotion criteria named: the catalog is re-read through
// `thread/capabilities/read`, never mirrored into two payload shapes.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });
const replyTo = (s: { lines: string[] }, id: number) => parsed(s.lines).find((f) => f.id === id);

type Calls = { plugins: number; skills: number };
const mkCalls = (): Calls => ({ plugins: 0, skills: 0 });

function fakeSession(calls: Calls, opts: { throwWith?: string; dieOnCall?: boolean; hang?: boolean } = {}) {
  let ended = false;
  const run = (which: "plugins" | "skills") => {
    calls[which]++;
    if (opts.hang) return new Promise<unknown>(() => {});
    if (opts.dieOnCall) { ended = true; throw new Error("Session is not running"); }
    if (opts.throwWith) throw new Error(opts.throwWith);
    return Promise.resolve(which === "plugins" ? { commands: ["c"], agents: [], plugins: ["p"], mcpServers: [] } : { skills: ["s"] });
  };
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => { ended = true; },
    onFrame: () => () => {},
    sessionId: "sess-1",
    isEnded: () => ended,
    kill: () => { ended = true; },
    reloadPlugins: async () => run("plugins"),
    reloadSkills: async () => run("skills"),
  };
}

/** Neither reload member — what proves each handler's -32601 branch. */
const bareSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" });

async function boot(sessionFactory: () => any) {
  let session: any;
  const srv = new AppServer({}, { sessionFactory: () => (session = sessionFactory()) });
  const s = mkSink(); const c = srv.connect(s.sink);
  init(c, 1);
  send(c, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
  send(c, { id: 99, method: "thread/subscribe", params: { threadId } });
  await tick();
  s.lines.length = 0;
  return { srv, s, c, threadId, session: () => session };
}

const cases: Array<[method: string, counter: keyof Calls]> = [["plugin/reload", "plugins"], ["skill/reload", "skills"]];

describe("plugin/reload + skill/reload (probe 105 ALIVE)", () => {
  for (const [method, counter] of cases) {
    it(`${method} calls the engine and replies {ok:true}`, async () => {
      const calls = mkCalls();
      const { s, c, threadId } = await boot(() => fakeSession(calls));

      send(c, { id: 3, method, params: { threadId } });
      await tick();

      expect(calls[counter]).toBe(1);
      expect(replyTo(s, 3).result).toEqual({ ok: true });
    });

    it(`${method} pings thread/capabilities/changed AFTER the reply — a reload IS a capabilities refresh`, async () => {
      const calls = mkCalls();
      const { s, c, threadId } = await boot(() => fakeSession(calls));

      send(c, { id: 3, method, params: { threadId } });
      await tick();

      const frames = parsed(s.lines);
      const replyAt = frames.findIndex((f) => f.id === 3);
      const pingAt = frames.findIndex((f) => f.method === "thread/capabilities/changed");
      expect(replyAt).toBeGreaterThanOrEqual(0);
      expect(pingAt).toBeGreaterThan(replyAt);
      expect(frames[pingAt].params).toEqual({ threadId });
    });

    it(`${method} on an engine missing the method answers -32601 and pings nothing`, async () => {
      const { s, c, threadId } = await boot(bareSession);

      send(c, { id: 3, method, params: { threadId } });
      await tick();

      const reply = replyTo(s, 3);
      expect(reply.error.code).toBe(ERR.METHOD_NOT_FOUND);
      expect(reply.error.message).toBe("unsupported by this engine");
      expect(reply.result).toBeUndefined();
      expect(parsed(s.lines).filter((f) => f.method === "thread/capabilities/changed")).toEqual([]);
    });

    it(`${method} for an unknown threadId answers -33004`, async () => {
      const { s, c } = await boot(() => fakeSession(mkCalls()));

      send(c, { id: 3, method, params: { threadId: "thr_nope" } });
      await tick();

      expect(replyTo(s, 3).error.code).toBe(ERR.THREAD_NOT_FOUND);
    });

    it(`${method} on a THROWING but alive engine answers -32603 with the engine's message, and pings nothing`, async () => {
      const { s, c, threadId } = await boot(() => fakeSession(mkCalls(), { throwWith: "plugin dir is unreadable" }));

      send(c, { id: 3, method, params: { threadId } });
      await tick();

      const reply = replyTo(s, 3);
      expect(reply.error.code).toBe(ERR.INTERNAL);
      expect(reply.error.message).toBe("plugin dir is unreadable");
      expect(parsed(s.lines).filter((f) => f.method === "thread/capabilities/changed")).toEqual([]);
    });

    it(`${method} on an engine that dies mid-op answers -33005, not -32603 (the chain-deferred re-check)`, async () => {
      // The body runs inside record.chain, i.e. LATER than dispatch's arrival-time -33005 gate, so the
      // engine can die while the op waits its turn — and scoring that -32603 blames the server for a dead
      // read loop the caller can see for itself.
      const { s, c, threadId } = await boot(() => fakeSession(mkCalls(), { dieOnCall: true }));

      send(c, { id: 3, method, params: { threadId } });
      await tick();

      expect(replyTo(s, 3).error.code).toBe(ERR.ENGINE_GONE);
    });

    it(`${method} on an already-dead engine answers -33005 through dispatch's arrival gate`, async () => {
      const { s, c, threadId, session } = await boot(() => fakeSession(mkCalls()));
      session().kill();

      send(c, { id: 3, method, params: { threadId } });
      await tick();

      expect(replyTo(s, 3).error.code).toBe(ERR.ENGINE_GONE);
    });

    it(`${method} bumps record.updatedAt on success only`, async () => {
      const { srv, c, threadId } = await boot(() => fakeSession(mkCalls()));
      const record = srv.registry.get(threadId)!;
      record.updatedAt = 0;

      send(c, { id: 3, method, params: { threadId } });
      await tick();

      expect(record.updatedAt).toBeGreaterThan(0);
    });
  }

  it("both are chain-scoped: a hanging plugin/reload holds a later skill/reload on the same thread", async () => {
    const calls = mkCalls();
    const { s, c, threadId } = await boot(() => fakeSession(calls, { hang: true }));

    send(c, { id: 3, method: "plugin/reload", params: { threadId } });
    send(c, { id: 4, method: "skill/reload", params: { threadId } });
    await tick();

    expect(calls).toEqual({ plugins: 1, skills: 0 });
    expect(replyTo(s, 3)).toBeUndefined();
    expect(replyTo(s, 4)).toBeUndefined();
  });
});
