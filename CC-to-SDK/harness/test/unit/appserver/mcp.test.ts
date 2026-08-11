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

async function bootOneThread(sessionFactory: () => any) {
  const srv = new AppServer({}, { sessionFactory });
  const a = mkSink(); const connA = srv.connect(a.sink);
  init(connA, 1, "A");
  send(connA, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
  a.lines.length = 0;
  return { srv, a, connA, threadId };
}

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
    const session = { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" };
    const { a, connA, threadId } = await bootOneThread(() => session);

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

  it("mcpServer/permissionModeOverride/set passes a real mode through unchanged", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "mcpServer/permissionModeOverride/set", params: { threadId, name: "fs", mode: "acceptEdits" } });
    await tick();

    expect(calls.override).toEqual([["fs", "acceptEdits"]]);
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
