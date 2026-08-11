// test/unit/appserver/mcp.test.ts — M2b Task 2: the MCP quintet (mcpServer/status/list, reconnect,
// toggle, set, permissionModeOverride/set) driven through the full AppServer RPC surface, as
// settings.test.ts/introspect.test.ts do — so chain-scoping (mutations) and the un-chained read are both
// proven against real dispatch. Copies those files' mkSink/send/parsed/init/tick helpers so this file
// reads standalone.
//
// Engine-faithful fakes (spec Testing, verbatim): reconnect/toggle's real Session throws for SDK-type
// servers ("SDK servers should be handled in print.ts", session.ts's own doc comment) — a fake asserting
// the -32602 mapping must genuinely throw, not just return a falsy value, since a real engine's rejection
// is what mcp.ts's catch block is written against.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { mcpToggleParams } from "../../../src/appserver/schema/mcp.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

type Calls = { reconnect: string[]; toggle: [string, boolean][]; set: Record<string, unknown>[]; override: [string, string | null][] };
function mkCalls(): Calls { return { reconnect: [], toggle: [], set: [], override: [] }; }

/** A bare-minimum fake engine session — the five MCP methods are the ONLY optional methods this fixture
 *  may add per-test, mirroring introspect.test.ts's convention (a missing one genuinely means "this
 *  engine doesn't implement it"). `throwReconnect`/`throwToggle` simulate the SDK-type-server throw. */
function fakeSession(calls: Calls, opts: { throwReconnect?: string; throwToggle?: string; statusData?: unknown[]; setReceipt?: unknown } = {}) {
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: () => () => {},
    sessionId: "sess-1",
    mcpServerStatus: async () => opts.statusData ?? [],
    reconnectMcpServer: async (name: string) => {
      calls.reconnect.push(name);
      if (opts.throwReconnect) throw new Error(opts.throwReconnect);
    },
    toggleMcpServer: async (name: string, enabled: boolean) => {
      calls.toggle.push([name, enabled]);
      if (opts.throwToggle) throw new Error(opts.throwToggle);
    },
    setMcpServers: async (servers: Record<string, unknown>) => {
      calls.set.push(servers);
      return opts.setReceipt ?? { added: Object.keys(servers), removed: [], errors: {} };
    },
    setMcpPermissionModeOverride: async (name: string, mode: string | null) => {
      calls.override.push([name, mode]);
      return {};
    },
  };
}

/** A bare engine — the four MCP mutations are ABSENT, so it is what proves each handler's -32601 branch
 *  (finding 4: `?.()` on a missing optional method used to reply success for work no engine ever did). */
function bareSession() {
  return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" };
}

/** Boots a server + one thread and SUBSCRIBES the connection to it (mirrors lifecycle2.test.ts's
 *  bootThread) — subscription is what makes `srv.broadcast` fan-out observable, so the
 *  thread/capabilities/changed assertions below read the real subscriber path, not an internal call. */
async function bootOneThread(sessionFactory: () => any) {
  const srv = new AppServer({}, { sessionFactory });
  const a = mkSink(); const connA = srv.connect(a.sink);
  init(connA, 1, "A");
  send(connA, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
  send(connA, { id: 99, method: "thread/subscribe", params: { threadId } });
  await tick();
  a.lines.length = 0;
  return { srv, a, connA, threadId };
}

const capPings = (lines: string[]) => parsed(lines).filter((f) => f.method === "thread/capabilities/changed");

describe("appserver MCP quintet (M2b Task 2)", () => {
  it("mcpServer/status/list replies { data, nextCursor: null } from the engine's array", async () => {
    const calls = mkCalls();
    const statusData = [{ name: "fs", status: "connected" }];
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls, { statusData }));

    send(connA, { id: 3, method: "mcpServer/status/list", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ data: statusData, nextCursor: null });
  });

  it("mcpServer/status/list on an engine missing the method answers -32601, not a crash", async () => {
    const { a, connA, threadId } = await bootOneThread(bareSession);

    send(connA, { id: 3, method: "mcpServer/status/list", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error.code).toBe(ERR.METHOD_NOT_FOUND);
    expect(reply.error.message).toBe("unsupported by this engine");
  });

  it("mcpServer/status/list for an unknown threadId answers THREAD_NOT_FOUND", async () => {
    const calls = mkCalls();
    const { a, connA } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/status/list", params: { threadId: "thr_nope" } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("mcpServer/reconnect: engine called with the name, reply {ok:true}", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/reconnect", params: { threadId, name: "fs" } });
    await tick();

    expect(calls.reconnect).toEqual(["fs"]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
  });

  it("mcpServer/reconnect on a THROWING fake (SDK-type server) replies -32602 carrying the engine's message", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls, { throwReconnect: "SDK servers should be handled in print.ts" }));

    send(connA, { id: 3, method: "mcpServer/reconnect", params: { threadId, name: "sdk-server" } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply.error.message).toBe("SDK servers should be handled in print.ts");
  });

  it("mcpServer/toggle: engine called with (name, enabled), reply {ok:true}", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/toggle", params: { threadId, name: "fs", enabled: false } });
    await tick();

    expect(calls.toggle).toEqual([["fs", false]]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
  });

  it("mcpServer/toggle on a THROWING fake (SDK-type server) replies -32602 carrying the engine's message — same mapping as reconnect", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls, { throwToggle: "SDK servers should be handled in print.ts" }));

    send(connA, { id: 3, method: "mcpServer/toggle", params: { threadId, name: "sdk-server", enabled: true } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply.error.message).toBe("SDK servers should be handled in print.ts");
  });

  it("mcpServer/set replies the engine's {added, removed, errors} receipt verbatim", async () => {
    const calls = mkCalls();
    const receipt = { added: ["fs"], removed: ["old"], errors: { bad: "boom" } };
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls, { setReceipt: receipt }));

    send(connA, { id: 3, method: "mcpServer/set", params: { threadId, servers: { fs: { command: "node" } } } });
    await tick();

    expect(calls.set).toEqual([{ fs: { command: "node" } }]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual(receipt);
  });

  it("mcpServer/permissionModeOverride/set passes null through (clear-pin) and replies {ok:true}", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/permissionModeOverride/set", params: { threadId, name: "fs", mode: null } });
    await tick();

    expect(calls.override).toEqual([["fs", null]]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
  });

  it("mcpServer/permissionModeOverride/set passes a real mode through unchanged and replies {ok:true}", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/permissionModeOverride/set", params: { threadId, name: "fs", mode: "acceptEdits" } });
    await tick();

    expect(calls.override).toEqual([["fs", "acceptEdits"]]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
  });

  it("the four mutations are chain-scoped: a slow reconnect blocks a subsequent toggle on the same thread until it settles", async () => {
    const calls = mkCalls();
    let releaseReconnect!: () => void;
    const session = Object.assign(fakeSession(calls), {
      reconnectMcpServer: (name: string) => { calls.reconnect.push(name); return new Promise<void>((r) => { releaseReconnect = r; }); },
    });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "mcpServer/reconnect", params: { threadId, name: "fs" } });
    send(connA, { id: 4, method: "mcpServer/toggle", params: { threadId, name: "fs", enabled: false } });
    await tick();

    // the reconnect is still pending, so its chained toggle must not have run yet
    expect(calls.toggle).toEqual([]);
    expect(parsed(a.lines).find((f) => f.id === 3)).toBeUndefined();

    releaseReconnect();
    await tick();
    expect(calls.toggle).toEqual([["fs", false]]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(parsed(a.lines).find((f) => f.id === 4).result).toEqual({ ok: true });
  });

  it("mcpToggleParams carries the spec's advisory warning verbatim as its schema description (Task 6's future JSON-schema generator picks this up)", () => {
    expect(mcpToggleParams.description).toBe("advisory, not a security boundary — a model tool call resurrects a disabled server; gate with permissions instead");
  });

  it("a dead engine (isEnded true) answers -33005 via the dispatch guard, proving the guard covers these new methods too", async () => {
    const calls = mkCalls();
    let ended = false;
    const session = Object.assign(fakeSession(calls), { isEnded: () => ended });
    const { a, connA, threadId } = await bootOneThread(() => session);
    ended = true;

    send(connA, { id: 3, method: "mcpServer/status/list", params: { threadId } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.ENGINE_GONE);
  });
});

// `mcpServers` is one of the four catalogs thread/capabilities/read replies (registry.ts's
// `capabilities()`), so the three mutations that change the server topology owe subscribers the standing
// `thread/capabilities/changed` ping (registry.ts:56) — and the rules-layer knob does not.
describe("appserver MCP quintet — thread/capabilities/changed ping", () => {
  it("mcpServer/reconnect pings thread/capabilities/changed on the thread's subscribers", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/reconnect", params: { threadId, name: "fs" } });
    await tick();

    expect(capPings(a.lines).map((f) => f.params)).toEqual([{ threadId }]);
  });

  it("mcpServer/toggle pings thread/capabilities/changed on the thread's subscribers", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/toggle", params: { threadId, name: "fs", enabled: false } });
    await tick();

    expect(capPings(a.lines).map((f) => f.params)).toEqual([{ threadId }]);
  });

  it("mcpServer/set pings thread/capabilities/changed on the thread's subscribers", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/set", params: { threadId, servers: { fs: { command: "node" } } } });
    await tick();

    expect(capPings(a.lines).map((f) => f.params)).toEqual([{ threadId }]);
  });

  it("mcpServer/permissionModeOverride/set does NOT ping — it moves the rules layer (probe 49), and the capabilities payload carries no per-server override", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/permissionModeOverride/set", params: { threadId, name: "fs", mode: "acceptEdits" } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(capPings(a.lines)).toEqual([]);
  });

  it("a FAILED mutation does not ping — the engine kept its topology, so there is nothing to re-read", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls, { throwReconnect: "SDK servers should be handled in print.ts" }));

    send(connA, { id: 3, method: "mcpServer/reconnect", params: { threadId, name: "sdk-server" } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.INVALID_PARAMS);
    expect(capPings(a.lines)).toEqual([]);
  });
});

// An engine that does not implement a method must be told apart from one that did the work. `?.()` did
// neither: it replied {ok:true} for three of these and, for `set`, a bare `undefined` — a result-less
// frame rpc.ts's own classify() scores "invalid", so the caller's request never settles at all.
describe("appserver MCP quintet — absent engine method answers -32601", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["mcpServer/reconnect", { name: "fs" }],
    ["mcpServer/toggle", { name: "fs", enabled: false }],
    ["mcpServer/set", { servers: { fs: { command: "node" } } }],
    ["mcpServer/permissionModeOverride/set", { name: "fs", mode: null }],
  ];

  for (const [method, extra] of cases) {
    it(`${method} on an engine missing the method answers -32601 "unsupported by this engine"`, async () => {
      const { a, connA, threadId } = await bootOneThread(bareSession);

      send(connA, { id: 3, method, params: { threadId, ...extra } });
      await tick();

      const reply = parsed(a.lines).find((f) => f.id === 3);
      expect(reply.error.code).toBe(ERR.METHOD_NOT_FOUND);
      expect(reply.error.message).toBe("unsupported by this engine");
    });
  }

  it("no absent-method call reports false success: no {ok:true}, no result-less frame, no capabilities ping", async () => {
    const { a, connA, threadId } = await bootOneThread(bareSession);

    let id = 3;
    for (const [method, extra] of cases) send(connA, { id: id++, method, params: { threadId, ...extra } });
    await tick();

    const replies = parsed(a.lines).filter((f) => f.id !== undefined);
    expect(replies).toHaveLength(cases.length);
    for (const r of replies) {
      expect(r.result).toBeUndefined();          // never {ok:true}, and never the bare `{"id":N}` classify() rejects
      expect("error" in r).toBe(true);
    }
    expect(capPings(a.lines)).toEqual([]);
  });
});

// The mutations' bodies are DEFERRED into record.chain, so they run after dispatch's arrival-time -33005
// gate has already passed. An engine that dies in between throws, and scoring that throw -32602 would
// blame the caller for the server's dead read loop — hence the catch's own isEnded() re-check
// (server.ts's dispatch catch does exactly the same).
describe("appserver MCP quintet — engine death inside a chain-deferred mutation", () => {
  /** A fake whose engine call throws AND kills the engine, so `isEnded()` is false at dispatch time (the
   *  arrival gate must let the handler run) and true by the time the catch reads it. */
  function dyingSession(calls: Calls) {
    let ended = false;
    return Object.assign(fakeSession(calls), {
      isEnded: () => ended,
      reconnectMcpServer: async (name: string) => { calls.reconnect.push(name); ended = true; throw new Error("Session is not running"); },
      toggleMcpServer: async (name: string, enabled: boolean) => { calls.toggle.push([name, enabled]); ended = true; throw new Error("Session is not running"); },
    });
  }

  it("reconnect on an engine that died mid-op answers -33005, not -32602", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => dyingSession(calls));

    send(connA, { id: 3, method: "mcpServer/reconnect", params: { threadId, name: "fs" } });
    await tick();

    expect(calls.reconnect).toEqual(["fs"]);
    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.ENGINE_GONE);
  });

  it("toggle on an engine that died mid-op answers -33005, not -32602", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => dyingSession(calls));

    send(connA, { id: 3, method: "mcpServer/toggle", params: { threadId, name: "fs", enabled: true } });
    await tick();

    expect(calls.toggle).toEqual([["fs", true]]);
    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.ENGINE_GONE);
  });

  it("a throwing engine that is still ALIVE keeps the -32602 mapping — the re-check narrows the class, it does not replace it", async () => {
    const calls = mkCalls();
    const session = Object.assign(fakeSession(calls, { throwToggle: "SDK servers should be handled in print.ts" }), { isEnded: () => false });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "mcpServer/toggle", params: { threadId, name: "sdk-server", enabled: true } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply.error.message).toBe("SDK servers should be handled in print.ts");
  });
});
