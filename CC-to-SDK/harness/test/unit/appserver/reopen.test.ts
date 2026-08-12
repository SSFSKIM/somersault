// test/unit/appserver/reopen.test.ts — M3 Task 14: `thread/reopen` (spec §4), the gap-10 recovery path.
// A record whose engine is DEAD gets a replacement in place — resumed when a sessionId was retained, fresh
// when the engine died before the first init frame — instead of staying -33005 until the client closes it.
//
// Everything is driven WIRE-LEVEL (srv.connect + feed), never by calling the handler, because two of the
// load-bearing claims are about DISPATCH rather than about the handler body: the method is in
// `ENGINE_GONE_EXEMPT` (so a dead thread can reach it at all) and a fleet thread's -33006 comes from the
// origin gate that runs right after that exemption (reopen never forwards — the host owns its own engine).
// Only real dispatch can prove either.
//
// Engine-faithful fakes, as rewind.test.ts's header sets out: `dispose()` awaits a real timer, and
// `onFrame`'s unsubscribe drops from the LIVE set while `captured` keeps every callback ever handed out.
// One addition here: `ended` is MUTABLE, so a test kills an engine the same way the world does (the read
// loop stops) rather than by hand-building a record around a permanently-dead fake.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { FLEET_UNSUPPORTED } from "../../../src/appserver/registry.js";
import { methodSchemas } from "../../../src/appserver/schema/index.js";
import type { PermissionBroker } from "../../../src/permissions/types.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
/** The swap crosses several real timer boundaries (an awaiting dispose, the chain callback), so one tick
 *  does not drain it — every assertion after a thread/reopen waits on this instead (rewind.test.ts). */
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
const init = (c: { feed(ch: string): void }, id: number, name = "t", extra: object = {}) =>
  send(c, { id, method: "initialize", params: { clientInfo: { name }, ...extra } });
const reply = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notif = (lines: string[], method: string) => parsed(lines).find((f) => f.method === method);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);

interface FakeEngine {
  sessionId?: string;
  ended: boolean;
  disposed: number;
  /** every optional-member push the post-swap re-push made, in order — the repush spy. */
  pushed: string[];
  live: Set<(m: unknown) => void>;
  captured: ((m: unknown) => void)[];
  push(frame: unknown): void;
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  onFrame(cb: (m: unknown) => void): () => void;
  isEnded(): boolean;
  setModel?(model?: string): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  applyFlagSettings?(s: Record<string, unknown>): Promise<void>;
  setMcpServers?(s: Record<string, unknown>): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }>;
  toggleMcpServer?(name: string, enabled: boolean): Promise<void>;
}

function mkEngine(opts: { sessionId?: string; disposeImpl?: () => Promise<void>; submitImpl?: () => Promise<{ result: unknown }> } = {}): FakeEngine {
  const live = new Set<(m: unknown) => void>();
  const captured: ((m: unknown) => void)[] = [];
  const e: FakeEngine = {
    sessionId: opts.sessionId,
    ended: false,
    disposed: 0,
    pushed: [],
    live,
    captured,
    push: (frame) => { for (const cb of [...live]) cb(frame); },
    submit: opts.submitImpl ?? (async () => ({ result: {} })),
    interrupt: async () => ({}),
    dispose: () => { e.disposed++; return opts.disposeImpl ? opts.disposeImpl() : new Promise<void>((r) => setTimeout(r, 1)); },
    onFrame: (cb) => { live.add(cb); captured.push(cb); return () => { live.delete(cb); }; },
    isEnded: () => e.ended,
    setModel: async (m) => { e.pushed.push(`model:${m}`); },
    setPermissionMode: async (m) => { e.pushed.push(`permissionMode:${m}`); },
    applyFlagSettings: async (s) => { e.pushed.push(`flags:${Object.keys(s).join("+")}`); },
    setMcpServers: async (s) => { e.pushed.push(`mcpServers:${Object.keys(s).join("+")}`); return { added: [], removed: [], errors: {} }; },
    toggleMcpServer: async (n, enabled) => { e.pushed.push(`mcpToggle:${n}=${enabled}`); },
  };
  return e;
}

/** Boots a server + one initialized, subscribed connection on one started thread. The session factory
 *  serves `engines` in order — thread/start takes the first, each reopen the next — and an `Error` in the
 *  list is a factory that THROWS on that call (the gap-10 wedge, reproduced on demand). */
async function bootThread(opts: {
  engines: Array<FakeEngine | Error>;
  config?: Record<string, unknown>;
  watcher?: boolean;
}) {
  const configs: Record<string, unknown>[] = [];
  let n = 0;
  const srv = new AppServer({}, {
    sessionFactory: (cfg: Record<string, unknown>) => {
      configs.push(cfg);
      const e = opts.engines[n++];
      if (e === undefined) throw new Error(`no engine configured for factory call #${n - 1}`);
      if (e instanceof Error) throw e;
      return e as never;
    },
  } as never);
  const s = mkSink(); const c = srv.connect(s.sink);
  init(c, 1);
  let w: { lines: string[]; sink: PeerSink } | undefined;
  if (opts.watcher) { w = mkSink(); init(srv.connect(w.sink), 1, "W", { watchThreads: true }); }
  send(c, { id: 2, method: "thread/start", params: opts.config ? { config: opts.config } : {} });
  await tick();
  const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
  send(c, { id: 99, method: "thread/subscribe", params: { threadId } });
  await tick();
  s.lines.length = 0; if (w) w.lines.length = 0;
  return { srv, s, c, w, threadId, configs };
}

describe("appserver thread/reopen — the swap (M3 Task 14)", () => {
  it("reopens a dead engine in place: the factory resumes the RETAINED sessionId off the thread's own config, the epoch bumps, the corpse is disposed, the router moves to the replacement, the accumulated state is re-pushed, and thread/rewound reaches subscribers AND watchers", async () => {
    const dead = mkEngine({ sessionId: "sess-1" });
    const fresh = mkEngine({});
    const { srv, s, w, c, threadId, configs } = await bootThread({
      engines: [dead, fresh],
      config: { model: "claude-opus-4-8", cwd: "/tmp/proj" },
      watcher: true,
    });
    const record = srv.registry.get(threadId)!;
    // What a live thread would have accumulated on the outgoing engine before it died (rewind.ts's
    // repushThreadState is what has to carry it across) — the MCP layer included, since fix wave 1's
    // accumulator rides the very same re-push.
    record.settings.permissionMode = "acceptEdits";
    record.flagPerms = { allow: ["Bash(ls:*)"], ask: [], deny: [], additionalDirectories: [] };
    record.mcpServersSet = { docs: { type: "stdio" } };
    record.mcpToggles = { docs: true };
    const epochBefore = record.epoch;
    dead.ended = true; // the read loop stopped — gap 10's wedge, or any other engine death

    send(c, { id: 3, method: "thread/reopen", params: { threadId } });
    await settle();

    // the replacement was built from the thread's ORIGINAL config, with the retained id as the resume
    expect(configs).toHaveLength(2);
    expect(configs[1].resume).toBe("sess-1");
    expect(configs[1].model).toBe("claude-opus-4-8");
    expect(configs[1].cwd).toBe("/tmp/proj");
    // the decision broker rides along, or every later tool call would bypass this server's permission surface
    expect(configs[1].permissionBroker).toBe(configs[0].permissionBroker);
    // the swap itself
    expect(record.epoch).toBe(epochBefore + 1);
    expect(dead.disposed).toBe(1);
    expect(dead.live.size).toBe(0);      // its router was unsubscribed before the dispose
    expect(record.session).toBe(fresh);
    expect(fresh.live.size).toBe(1);     // the router was reinstalled on the replacement
    expect(record.sessionId).toBe("sess-1");
    // the re-push: the settings mirror, the flag layer AND the MCP layer all replay onto the replacement
    expect(fresh.pushed).toContain("model:claude-opus-4-8");
    expect(fresh.pushed).toContain("permissionMode:acceptEdits");
    expect(fresh.pushed).toContain("flags:permissions");
    expect(fresh.pushed).toContain("mcpServers:docs");
    expect(fresh.pushed).toContain("mcpToggle:docs=true");
    expect(notif(s.lines, "thread/capabilities/changed")).toBeDefined(); // the catalog moved with the set/toggle replay
    // reply + fan-out
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: "sess-1" });
    expect(notif(s.lines, "thread/rewound").params).toEqual({ threadId, sessionId: "sess-1" });
    expect(notif(w!.lines, "thread/rewound").params).toEqual({ threadId, sessionId: "sess-1" });
    // and the thread is usable again — no wedge at "swapping", and turns run on the replacement
    expect(record.swapInFlight).toBe(false);
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "back" } });
    await settle();
    expect(reply(s.lines, 4).result.turn.status).toBe("inProgress");
  });

  it("a record with NO retained sessionId reopens as a FRESH conversation: the factory is handed no resume value, and the reply and broadcast carry null", async () => {
    // The engine died before its first init frame ever latched an id (spec §4: fresh-reopen, documented).
    const dead = mkEngine({});
    const fresh = mkEngine({});
    const { s, c, threadId, configs } = await bootThread({ engines: [dead, fresh] });
    dead.ended = true;

    send(c, { id: 3, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(configs[1].resume).toBeUndefined();
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: null });
    expect(notif(s.lines, "thread/rewound").params).toEqual({ threadId, sessionId: null });
  });

  it("the replacement engine's decisions still park: the reopen must not settle or latch the thread's decision registry", async () => {
    // Both `ThreadDecisions.teardown()` and `.discard()` latch `closed`, after which the broker — the SAME
    // object, carried in `record.config` onto every replacement — denies every request forever. So a reopen
    // that "cleaned up" the dead conversation's parks would hand the recovered thread an engine whose every
    // tool call is auto-denied with nothing on the wire saying why.
    const dead = mkEngine({ sessionId: "sess-1" });
    const fresh = mkEngine({});
    const { srv, s, c, threadId, configs } = await bootThread({ engines: [dead, fresh] });
    dead.ended = true;

    send(c, { id: 3, method: "thread/reopen", params: { threadId } });
    await settle();

    const broker = configs[1].permissionBroker as PermissionBroker;
    void broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_after", signal: new AbortController().signal });
    await tick();

    expect(srv.pendingDecisions(threadId).map((d) => d.toolUseID)).toEqual(["toolu_after"]);
    expect(notif(s.lines, "decision/requested").params.decision.toolUseId).toBe("toolu_after");
  });
});

describe("appserver thread/reopen refusals (M3 Task 14)", () => {
  it("an ALIVE engine is refused -32602 and no replacement is built — reopen is not a covert restart", async () => {
    const alive = mkEngine({ sessionId: "sess-1" });
    const { s, c, threadId, configs } = await bootThread({ engines: [alive] });

    send(c, { id: 3, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 3).error).toMatchObject({ code: ERR.INVALID_PARAMS, message: "engine is not dead; nothing to reopen" });
    expect(configs).toHaveLength(1); // the factory was never called a second time
    expect(alive.disposed).toBe(0);
  });

  it("a BUSY thread is refused -33001 with its reason, even though its engine is dead", async () => {
    const dead = mkEngine({ sessionId: "sess-1", submitImpl: () => new Promise(() => {}) }); // the turn never ends
    const { srv, s, c, threadId, configs } = await bootThread({ engines: [dead] });
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await settle();
    dead.ended = true; // the engine dies UNDER the running turn

    send(c, { id: 4, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 4).error).toMatchObject({ code: ERR.BUSY, message: "Thread is busy (turn)" });
    expect(configs).toHaveLength(1);
    expect(srv.registry.get(threadId)!.session).toBe(dead);
  });

  it("a CLOSING thread is refused -33001 (closing) — a reopen must not race a teardown into spawning an engine nothing will dispose", async () => {
    const dead = mkEngine({ sessionId: "sess-1", disposeImpl: () => new Promise(() => {}) }); // the close hangs on dispose
    const { s, c, threadId, configs } = await bootThread({ engines: [dead] });
    dead.ended = true;
    send(c, { id: 3, method: "thread/close", params: { threadId } });

    send(c, { id: 4, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 4).error).toMatchObject({ code: ERR.BUSY, message: "Thread is busy (closing)" });
    expect(configs).toHaveLength(1);
  });

  it("an unknown thread is -33004 and a missing threadId is -32602", async () => {
    const { s, c } = await bootThread({ engines: [mkEngine({ sessionId: "sess-1" })] });

    send(c, { id: 3, method: "thread/reopen", params: { threadId: "thr_nope" } });
    send(c, { id: 4, method: "thread/reopen", params: {} });
    await settle();

    expect(reply(s.lines, 3).error.code).toBe(ERR.THREAD_NOT_FOUND);
    expect(reply(s.lines, 4).error.code).toBe(ERR.INVALID_PARAMS);
  });
});

describe("appserver thread/reopen dispatch reachability (M3 Task 14)", () => {
  it("the exemption: the same dead-engine record that answers -33005 for thread/capabilities/read gets THROUGH to thread/reopen", async () => {
    // Without `thread/reopen` in ENGINE_GONE_EXEMPT the dispatch gate refuses it exactly when it is legal.
    const dead = mkEngine({ sessionId: "sess-1" });
    const fresh = mkEngine({});
    const { s, c, threadId } = await bootThread({ engines: [dead, fresh] });
    dead.ended = true;

    send(c, { id: 3, method: "thread/capabilities/read", params: { threadId } });
    send(c, { id: 4, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 3).error).toMatchObject({ code: ERR.ENGINE_GONE, message: "Engine is gone (session ended)" });
    expect(reply(s.lines, 4).result).toEqual({ ok: true, sessionId: "sess-1" });
  });

  it("a FLEET thread answers -33006 at the dispatch gate — reopen never forwards, because the host owns its own engine lifecycle", async () => {
    // Origin is flipped on a live record rather than attaching a real host: the gate is a property of the
    // RECORD's origin and never touches the session (origin-gate.test.ts's own convention). A DEAD engine on
    // purpose — that is the ordering claim, exemption first (so -33005 does not fire) and the origin gate
    // right after it.
    const dead = mkEngine({ sessionId: "sess-1" });
    const { srv, s, c, threadId, configs } = await bootThread({ engines: [dead] });
    srv.registry.get(threadId)!.origin = "fleet";
    dead.ended = true;

    send(c, { id: 3, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 3).error).toMatchObject({ code: ERR.UNSUPPORTED_FOR_ORIGIN, message: "unsupported for fleet-origin threads" });
    expect(configs).toHaveLength(1); // nothing local was swapped, and nothing was forwarded
  });
});

describe("appserver thread/reopen recovery is REPEATABLE (M3 Task 14)", () => {
  it("a factory that throws again relays its message, leaves the thread dead but un-wedged, and a SECOND reopen with a working factory succeeds", async () => {
    // Gap 10 itself, reproduced and then recovered: the first reopen's factory throws exactly as the
    // original wedge's did. The record keeps answering -33005, `swapInFlight` is released, and the retry
    // works — which is the whole difference between the residual and the recovery path.
    const dead = mkEngine({ sessionId: "sess-1" });
    const fresh = mkEngine({});
    const { srv, s, c, threadId } = await bootThread({ engines: [dead, new Error("cannot spawn the CLI child"), fresh] });
    dead.ended = true;

    send(c, { id: 3, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 3).error).toMatchObject({ code: ERR.INTERNAL, message: "cannot spawn the CLI child" });
    const record = srv.registry.get(threadId)!;
    expect(record.swapInFlight).toBe(false);      // released in the finally — no wedge at "swapping"
    expect(record.session).toBe(dead);            // still holding the corpse: honestly -33005 everywhere else
    send(c, { id: 4, method: "thread/capabilities/read", params: { threadId } });
    await settle();
    expect(reply(s.lines, 4).error.code).toBe(ERR.ENGINE_GONE);

    send(c, { id: 5, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 5).result).toEqual({ ok: true, sessionId: "sess-1" });
    expect(srv.registry.get(threadId)!.session).toBe(fresh);
  });
});

describe("appserver thread/reopen and the turn queue (M3 Task 14)", () => {
  it("queued turns are CANCELLED by the reopen, not left to drain onto the replacement", async () => {
    // A queued turn was priced against a conversation that is now gone (and on the no-sessionId arm the
    // replacement is a different conversation outright). Nothing would run it at reopen time either — the
    // drain only fires from a turn settling — so it would sit until some later turn completed and then
    // execute against context its client never saw. Flushed with the terminal `cancelled` every queued id
    // is owed (queue.ts), synchronously beside the swap latch, exactly as thread/close does.
    const dead = mkEngine({ sessionId: "sess-1", submitImpl: () => new Promise(() => {}) });
    const fresh = mkEngine({});
    const { srv, s, c, threadId } = await bootThread({ engines: [dead, fresh] });
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "running" } });
    await settle();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "queued", queue: true } });
    await settle();
    const queuedId = reply(s.lines, 4).result.turn.id;
    expect(srv.registry.get(threadId)!.queue).toHaveLength(1);
    // the engine dies under the running turn, and the turn machinery gives the thread back
    dead.ended = true;
    srv.registry.get(threadId)!.busy = false;
    s.lines.length = 0;

    send(c, { id: 5, method: "thread/reopen", params: { threadId } });
    await settle();

    expect(reply(s.lines, 5).result).toEqual({ ok: true, sessionId: "sess-1" });
    expect(srv.registry.get(threadId)!.queue).toEqual([]);
    const cancelled = notifs(s.lines, "turn/completed").map((f) => f.params.turn);
    expect(cancelled).toContainEqual({ id: queuedId, status: "cancelled" });
  });
});

describe("appserver thread/reopen registration (M3 Task 14)", () => {
  it("is a registered STABLE method and is origin-gated for fleet threads", () => {
    expect(methodSchemas["thread/reopen"]).toBeDefined();
    expect(methodSchemas["thread/reopen"].experimental).toBeUndefined();
    expect(FLEET_UNSUPPORTED.has("thread/reopen")).toBe(true);
  });
});
