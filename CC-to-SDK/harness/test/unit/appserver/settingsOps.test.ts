// test/unit/appserver/settingsOps.test.ts — M2b Task 3b: the settings-ops nonet (thread/settings/read,
// thread/directory/{list,add,remove}, thread/permissionRule/{add,remove}, thread/outputStyle/set,
// thread/effort/set, thread/clear) driven through the full AppServer RPC surface, as
// rewind.test.ts/tasks.test.ts do — so the un-chained reads, the chain-scoped accumulator mutations and
// the clear-path engine swap are all proven against real dispatch rather than in isolation. Copies those
// files' mkSink/send/parsed/init helpers so this file reads standalone.
//
// Engine-faithful fakes (Global Constraints, verbatim): `dispose()` AWAITS on a real timer (the real
// Session.dispose is `input.close(); await this.done`), and `onFrame`'s unsubscribe deletes from the LIVE
// callback set only while `captured` keeps every callback ever handed out — the real read loop dispatches
// each frame over a snapshot, so a superseded engine's late frame still reaches the router it was
// installed with. `applyFlagSettings` records the WHOLE settings object it was handed, because the thing
// under test is what the accumulator pushed, not merely that it pushed.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
/** The clear swap crosses several real timer boundaries (an awaiting dispose, the chain callback, the
 *  post-swap re-push) — one tick is not enough to drain it (rewind.test.ts's convention). */
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const init = (c: { feed(ch: string): void }, id: number, name = "t", extra: object = {}) =>
  send(c, { id, method: "initialize", params: { clientInfo: { name }, ...extra } });
const reply = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notif = (lines: string[], method: string) => parsed(lines).find((f) => f.method === method);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);

const EMPTY_PERMS = { allow: [], ask: [], deny: [], additionalDirectories: [] };

interface FakeEngine {
  sessionId?: string;
  flagCalls: Record<string, unknown>[];
  modelCalls: (string | undefined)[];
  modeCalls: string[];
  thinkingCalls: (number | null)[];
  disposed: number;
  live: Set<(m: unknown) => void>;
  captured: ((m: unknown) => void)[];
  push(frame: unknown): void;
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  onFrame(cb: (m: unknown) => void): () => void;
  applyFlagSettings?(settings: Record<string, unknown>): Promise<void>;
  getSettings?(): Promise<unknown>;
  setModel?(model?: string): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  setMaxThinkingTokens?(n: number | null): Promise<void>;
  isEnded?(): boolean;
}

function mkEngine(opts: {
  sessionId?: string;
  /** omit `applyFlagSettings` entirely — an engine build with no dynamic flag layer at all. */
  noFlags?: boolean;
  /** omit `getSettings` — the introspection-convention -32601 case. */
  noGetSettings?: boolean;
  /** omit setModel/setPermissionMode/setMaxThinkingTokens — the post-swap re-push must SKIP, not throw. */
  noSetters?: boolean;
  settings?: unknown;
  /** what `applyFlagSettings` does; the call is recorded either way (before this runs). */
  flagImpl?: (settings: Record<string, unknown>) => Promise<void>;
  disposeImpl?: () => Promise<void>;
  submitImpl?: () => Promise<{ result: unknown }>;
  /** The read loop's liveness, overridable so a fake can DIE mid-op (tasks.test.ts's `dyingSession`): the
   *  chain-deferred bodies here run later than dispatch's arrival-time -33005 gate, so "ended by the time
   *  the chain reached it" is a state only a settable isEnded can reach. Default: alive throughout. */
  isEndedImpl?: () => boolean;
} = {}): FakeEngine {
  const live = new Set<(m: unknown) => void>();
  const captured: ((m: unknown) => void)[] = [];
  const e: FakeEngine = {
    sessionId: opts.sessionId,
    flagCalls: [], modelCalls: [], modeCalls: [], thinkingCalls: [],
    disposed: 0,
    live, captured,
    push: (frame) => { for (const cb of [...live]) cb(frame); },
    submit: opts.submitImpl ?? (async () => ({ result: {} })),
    interrupt: async () => ({}),
    dispose: () => { e.disposed++; return opts.disposeImpl ? opts.disposeImpl() : new Promise<void>((r) => setTimeout(r, 1)); },
    onFrame: (cb) => { live.add(cb); captured.push(cb); return () => { live.delete(cb); }; },
    isEnded: opts.isEndedImpl ?? (() => false),
  };
  if (!opts.noFlags) {
    e.applyFlagSettings = async (settings) => { e.flagCalls.push(settings); if (opts.flagImpl) await opts.flagImpl(settings); };
  }
  if (!opts.noGetSettings) e.getSettings = async () => opts.settings ?? { outputStyle: "default" };
  if (!opts.noSetters) {
    e.setModel = async (m) => { e.modelCalls.push(m); };
    e.setPermissionMode = async (m) => { e.modeCalls.push(m); };
    e.setMaxThinkingTokens = async (n) => { e.thinkingCalls.push(n); };
  }
  return e;
}

/** Boots a server + one initialized, subscribed connection on one started thread. `sessions` is handed
 *  out in order — index 0 to thread/start, index 1 to the clear swap's fresh factory call (the LAST entry
 *  repeats if a test swaps more times than it supplied engines). `watcher: true` adds a second connection
 *  that only opted into server-scoped fan-out and never subscribes. */
async function bootThread(opts: {
  sessions: FakeEngine[];
  deps?: Record<string, unknown>;
  config?: Record<string, unknown>;
  watcher?: boolean;
}) {
  const configs: Record<string, unknown>[] = [];
  let n = 0;
  const srv = new AppServer({}, {
    sessionFactory: (cfg: Record<string, unknown>) => { configs.push(cfg); return (opts.sessions[Math.min(n++, opts.sessions.length - 1)]) as never; },
    ...opts.deps,
  });
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

describe("appserver thread/settings/read (M2b Task 3b)", () => {
  it("passes the engine's untyped get_settings answer straight through under one named key", async () => {
    const engine = mkEngine({ sessionId: "s1", settings: { outputStyle: "explanatory", effortLevel: "high" } });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/settings/read", params: { threadId } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ settings: { outputStyle: "explanatory", effortLevel: "high" } });
  });

  it("an engine with no getSettings answers -32601, never a crash and never a result-less frame", async () => {
    const { s, c, threadId } = await bootThread({ sessions: [mkEngine({ sessionId: "s1", noGetSettings: true })] });

    send(c, { id: 3, method: "thread/settings/read", params: { threadId } });
    await tick();

    expect(reply(s.lines, 3).error.code).toBe(ERR.METHOD_NOT_FOUND);
    expect(reply(s.lines, 3).error.message).toBe("unsupported by this engine");
    expect(reply(s.lines, 3).result).toBeUndefined();
  });
});

describe("appserver thread/directory/* (M2b Task 3b)", () => {
  it("list assembles the three sources in host order: cwd, then the launch config's dirs, then this thread's own grants", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({
      sessions: [engine],
      config: { cwd: "/tmp/proj", additionalDirectories: ["/launch/a", "/launch/b"] },
    });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/sess/c" } });
    await tick();
    send(c, { id: 4, method: "thread/directory/list", params: { threadId } });
    await tick();

    expect(reply(s.lines, 4).result).toEqual({
      data: [
        { path: "/tmp/proj", source: "cwd" },
        { path: "/launch/a", source: "launch" },
        { path: "/launch/b", source: "launch" },
        { path: "/sess/c", source: "session" },
      ],
      nextCursor: null,
    });
    expect(engine.flagCalls).toEqual([{ permissions: { ...EMPTY_PERMS, additionalDirectories: ["/sess/c"] } }]);
  });

  it("a thread started with no cwd still reports one row for the engine's actual working directory", async () => {
    const { s, c, threadId } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" })] });

    send(c, { id: 3, method: "thread/directory/list", params: { threadId } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ data: [{ path: process.cwd(), source: "cwd" }], nextCursor: null });
  });

  it("remove pushes the FILTERED list and the removed dir leaves the session rows", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine], config: { cwd: "/tmp/proj" } });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/a" } });
    send(c, { id: 4, method: "thread/directory/add", params: { threadId, path: "/b" } });
    send(c, { id: 5, method: "thread/directory/remove", params: { threadId, path: "/a" } });
    await tick();
    send(c, { id: 6, method: "thread/directory/list", params: { threadId } });
    await tick();

    expect(engine.flagCalls.at(-1)).toEqual({ permissions: { ...EMPTY_PERMS, additionalDirectories: ["/b"] } });
    expect(reply(s.lines, 6).result.data).toEqual([{ path: "/tmp/proj", source: "cwd" }, { path: "/b", source: "session" }]);
  });

  it("an idempotent re-add replies ok WITHOUT a second push, and does not bump updatedAt — nothing changed", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { srv, s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/a" } });
    await tick();
    const record = srv.registry.get(threadId)!;
    record.updatedAt = 0;

    send(c, { id: 4, method: "thread/directory/add", params: { threadId, path: "/a" } });
    await tick();

    expect(reply(s.lines, 4).result).toEqual({ ok: true });
    expect(engine.flagCalls).toHaveLength(1);
    expect(record.updatedAt).toBe(0);
  });

  it("a push whose engine DIES mid-op answers -33005, not -32603 — the chain-deferred re-check, since the arrival-time gate saw a live engine", async () => {
    let ended = false;
    const engine = mkEngine({
      sessionId: "s1",
      isEndedImpl: () => ended,
      flagImpl: async () => { ended = true; throw new Error("Session is not running"); },
    });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/a" } });
    await tick();

    expect(engine.flagCalls).toHaveLength(1);            // the op did reach the engine — it died on the way through
    expect(reply(s.lines, 3).error.code).toBe(ERR.ENGINE_GONE);
    expect(reply(s.lines, 3).error.message).toBe("Engine is gone (session ended)");
  });

  it("a REJECTED push leaves the accumulator untouched: the retry pushes the SAME delta, not a doubled one (commit-after-accept)", async () => {
    let fail = true;
    const engine = mkEngine({ sessionId: "s1", flagImpl: async () => { if (fail) throw new Error("denied by policy"); } });
    const { s, c, threadId } = await bootThread({ sessions: [engine], config: { cwd: "/tmp/proj" } });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/a" } });
    await tick();
    expect(reply(s.lines, 3).error.code).toBe(ERR.INTERNAL);
    expect(reply(s.lines, 3).error.message).toBe("denied by policy");

    // the rejected grant must not be visible anywhere — a phantom row here is what a later replay re-pushes
    send(c, { id: 4, method: "thread/directory/list", params: { threadId } });
    await tick();
    expect(reply(s.lines, 4).result.data).toEqual([{ path: "/tmp/proj", source: "cwd" }]);

    fail = false;
    send(c, { id: 5, method: "thread/directory/add", params: { threadId, path: "/a" } });
    await tick();

    expect(reply(s.lines, 5).result).toEqual({ ok: true });
    expect(engine.flagCalls).toEqual([
      { permissions: { ...EMPTY_PERMS, additionalDirectories: ["/a"] } },
      { permissions: { ...EMPTY_PERMS, additionalDirectories: ["/a"] } }, // NOT ["/a","/a"]
    ]);
  });
});

describe("appserver thread/permissionRule/* (M2b Task 3b)", () => {
  it("each behavior accumulates into its own bucket, and every push carries the WHOLE permissions object", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/permissionRule/add", params: { threadId, behavior: "allow", rule: "Bash(ls:*)" } });
    send(c, { id: 4, method: "thread/permissionRule/add", params: { threadId, behavior: "ask", rule: "Write" } });
    send(c, { id: 5, method: "thread/permissionRule/add", params: { threadId, behavior: "deny", rule: "Bash(rm:*)" } });
    await tick();

    expect(reply(s.lines, 5).result).toEqual({ ok: true });
    expect(engine.flagCalls.at(-1)).toEqual({
      permissions: { allow: ["Bash(ls:*)"], ask: ["Write"], deny: ["Bash(rm:*)"], additionalDirectories: [] },
    });
  });

  it("remove filters only its own behavior's bucket", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/permissionRule/add", params: { threadId, behavior: "allow", rule: "Bash(ls:*)" } });
    send(c, { id: 4, method: "thread/permissionRule/add", params: { threadId, behavior: "deny", rule: "Bash(ls:*)" } });
    send(c, { id: 5, method: "thread/permissionRule/remove", params: { threadId, behavior: "allow", rule: "Bash(ls:*)" } });
    await tick();

    expect(engine.flagCalls.at(-1)).toEqual({ permissions: { ...EMPTY_PERMS, deny: ["Bash(ls:*)"] } });
  });

  it("an idempotent re-add of the same rule replies ok without a second push", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/permissionRule/add", params: { threadId, behavior: "deny", rule: "Read(./secrets/**)" } });
    send(c, { id: 4, method: "thread/permissionRule/add", params: { threadId, behavior: "deny", rule: "Read(./secrets/**)" } });
    await tick();

    expect(reply(s.lines, 4).result).toEqual({ ok: true });
    expect(engine.flagCalls).toHaveLength(1);
  });

  it("an off-vocabulary behavior is -32602 before the engine is touched", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/permissionRule/add", params: { threadId, behavior: "maybe", rule: "Write" } });
    await tick();

    expect(reply(s.lines, 3).error.code).toBe(ERR.INVALID_PARAMS);
    expect(engine.flagCalls).toEqual([]);
  });
});

describe("appserver thread/outputStyle/set + thread/effort/set (M2b Task 3b)", () => {
  it("outputStyle pushes {outputStyle} and commits after the engine accepts", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/outputStyle/set", params: { threadId, style: "explanatory" } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ ok: true });
    expect(engine.flagCalls).toEqual([{ outputStyle: "explanatory" }]);
  });

  it("a REJECTED outputStyle push is not committed — the next swap must not replay a style the engine refused", async () => {
    const engine = mkEngine({ sessionId: "s1", flagImpl: async () => { throw new Error("no such output style"); } });
    const fresh = mkEngine({});
    const { s, c, threadId } = await bootThread({ sessions: [engine, fresh] });

    send(c, { id: 3, method: "thread/outputStyle/set", params: { threadId, style: "nope" } });
    await tick();
    expect(reply(s.lines, 3).error.code).toBe(ERR.INTERNAL);

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    expect(fresh.flagCalls).toEqual([]); // nothing accumulated, so nothing replayed
  });

  it("effort pushes {effortLevel} for a level inside the host wire's closed enum", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/effort/set", params: { threadId, level: "xhigh" } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ ok: true });
    expect(engine.flagCalls).toEqual([{ effortLevel: "xhigh" }]);
  });

  it("an unknown effort level is -32602 BEFORE the engine is touched — probe 102: the SDK validates nothing, so the wire must", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/effort/set", params: { threadId, level: "ludicrous" } });
    await tick();

    expect(reply(s.lines, 3).error.code).toBe(ERR.INVALID_PARAMS);
    expect(engine.flagCalls).toEqual([]);
  });

  it("every level of the host wire's enum is accepted (the two vocabularies are one)", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    const levels = ["low", "medium", "high", "xhigh", "max"];
    let id = 3;
    for (const level of levels) send(c, { id: id++, method: "thread/effort/set", params: { threadId, level } });
    await tick();

    expect(engine.flagCalls).toEqual(levels.map((level) => ({ effortLevel: level })));
    expect(parsed(s.lines).filter((f) => f.error !== undefined)).toEqual([]);
  });
});

describe("appserver settings-ops chain scope + updatedAt (M2b Task 3b)", () => {
  it("the mutations are chain-scoped: a hung directory/add blocks a later outputStyle/set on the same thread", async () => {
    let release!: () => void;
    let hang = true; // only the FIRST push hangs — the second must be free to complete once the chain moves
    const engine = mkEngine({ sessionId: "s1", flagImpl: () => hang ? new Promise<void>((r) => { hang = false; release = r; }) : Promise.resolve() });
    const { s, c, threadId } = await bootThread({ sessions: [engine] });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/a" } });
    send(c, { id: 4, method: "thread/outputStyle/set", params: { threadId, style: "explanatory" } });
    await tick();

    expect(engine.flagCalls).toHaveLength(1); // the style push has not run yet
    expect(reply(s.lines, 3)).toBeUndefined();

    release();
    await settle();
    expect(engine.flagCalls).toHaveLength(2);
    expect(reply(s.lines, 4).result).toEqual({ ok: true });
  });

  it("the two READS are un-chained: both answer while a hung mutation still holds the chain", async () => {
    const engine = mkEngine({ sessionId: "s1", flagImpl: () => new Promise<void>(() => {}) });
    const { s, c, threadId } = await bootThread({ sessions: [engine], config: { cwd: "/tmp/proj" } });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/a" } });
    send(c, { id: 4, method: "thread/directory/list", params: { threadId } });
    send(c, { id: 5, method: "thread/settings/read", params: { threadId } });
    await tick();

    expect(reply(s.lines, 3)).toBeUndefined();
    expect(reply(s.lines, 4).result.data).toEqual([{ path: "/tmp/proj", source: "cwd" }]);
    expect(reply(s.lines, 5).result).toEqual({ settings: { outputStyle: "default" } });
  });

  // Backdated rather than clock-compared: updatedAt is unix SECONDS (tasks.test.ts's convention).
  it("an accepted mutation bumps record.updatedAt; a rejected one does not", async () => {
    let fail = false;
    const engine = mkEngine({ sessionId: "s1", flagImpl: async () => { if (fail) throw new Error("denied"); } });
    const { srv, c, threadId } = await bootThread({ sessions: [engine] });
    const record = srv.registry.get(threadId)!;

    record.updatedAt = 0;
    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/a" } });
    await tick();
    expect(record.updatedAt).toBeGreaterThan(0);

    fail = true;
    record.updatedAt = 0;
    send(c, { id: 4, method: "thread/directory/add", params: { threadId, path: "/b" } });
    await tick();
    expect(record.updatedAt).toBe(0);
  });
});

describe("appserver settings-ops — absent engine method answers -32601", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["thread/directory/add", { path: "/a" }],
    ["thread/directory/remove", { path: "/a" }],
    ["thread/permissionRule/add", { behavior: "allow", rule: "Write" }],
    ["thread/permissionRule/remove", { behavior: "allow", rule: "Write" }],
    ["thread/outputStyle/set", { style: "explanatory" }],
    ["thread/effort/set", { level: "high" }],
  ];

  for (const [method, extra] of cases) {
    it(`${method} on an engine with no applyFlagSettings answers -32601 "unsupported by this engine"`, async () => {
      const { s, c, threadId } = await bootThread({ sessions: [mkEngine({ sessionId: "s1", noFlags: true })] });

      send(c, { id: 3, method, params: { threadId, ...extra } });
      await tick();

      expect(reply(s.lines, 3).error.code).toBe(ERR.METHOD_NOT_FOUND);
      expect(reply(s.lines, 3).error.message).toBe("unsupported by this engine");
    });
  }

  it("no absent-method call reports false success, and none of them writes the accumulator", async () => {
    const { srv, s, c, threadId } = await bootThread({ sessions: [mkEngine({ sessionId: "s1", noFlags: true })] });

    let id = 3;
    for (const [method, extra] of cases) send(c, { id: id++, method, params: { threadId, ...extra } });
    await tick();

    const replies = parsed(s.lines).filter((f) => f.id !== undefined);
    expect(replies).toHaveLength(cases.length);
    for (const r of replies) { expect(r.result).toBeUndefined(); expect("error" in r).toBe(true); }
    const record = srv.registry.get(threadId)!;
    expect(record.flagPerms).toEqual(EMPTY_PERMS);
    expect(record.flagOutputStyle).toBeUndefined();
    expect(record.flagEffort).toBeUndefined();
  });
});

describe("appserver thread/clear (M2b Task 3b)", () => {
  it("swaps in a FRESH conversation: factory called with resume/resumeAt explicitly overridden to undefined, epoch bumped, old engine disposed and unrouted, sessionId dropped", async () => {
    const oldEngine = mkEngine({ sessionId: "s1" });
    const fresh = mkEngine({});
    const { s, c, threadId, srv, configs } = await bootThread({
      sessions: [oldEngine, fresh],
      config: { model: "claude-opus-4-8", cwd: "/tmp/proj" },
    });
    const epochBefore = srv.registry.get(threadId)!.epoch;

    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    await settle();

    const record = srv.registry.get(threadId)!;
    expect(record.epoch).toBe(epochBefore + 1);
    expect(oldEngine.disposed).toBe(1);
    expect(oldEngine.live.size).toBe(0);
    expect(record.session).toBe(fresh);
    expect(fresh.live.size).toBe(1);                 // the router was reinstalled on the replacement
    expect(record.sessionId).toBeUndefined();        // a fresh conversation has no id until its init frame
    expect(configs).toHaveLength(2);
    // The explicit override, not an omission: the stored start config of a thread born from thread/resume
    // still carries `resume`, and spreading it would silently reopen the conversation /clear was asked to drop.
    expect("resume" in configs[1]).toBe(true);
    expect(configs[1].resume).toBeUndefined();
    expect(configs[1].resumeAt).toBeUndefined();
    expect(configs[1].model).toBe("claude-opus-4-8"); // everything ELSE survives, broker included
    expect(configs[1].permissionBroker).toBe(configs[0].permissionBroker);
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: null });
    expect(record.swapInFlight).toBe(false);
  });

  it("a thread/resume-born thread does not silently reopen its resumed session (host.clearSession's explicit-override lesson)", async () => {
    const oldEngine = mkEngine({ sessionId: "sess-old" });
    const fresh = mkEngine({});
    const configs: Record<string, unknown>[] = [];
    let n = 0;
    const srv = new AppServer({}, { sessionFactory: (cfg: Record<string, unknown>) => { configs.push(cfg); return [oldEngine, fresh][Math.min(n++, 1)] as never; } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/resume", params: { sessionId: "sess-old" } });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;

    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    await settle();

    expect(configs[0].resume).toBe("sess-old");
    expect(configs[1].resume).toBeUndefined();
  });

  it("broadcasts thread/rewound {cleared:true} to subscribers AND watchers, carrying an explicit null id", async () => {
    const { s, w, c, threadId } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), mkEngine({})], watcher: true });

    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    await settle();

    expect(notif(s.lines, "thread/rewound").params).toEqual({ threadId, sessionId: null, cleared: true });
    expect(notif(w!.lines, "thread/rewound").params).toEqual({ threadId, sessionId: null, cleared: true });
  });

  it("the accumulator SURVIVES the clear: dirs, rules, output style and effort are all re-pushed onto the fresh engine", async () => {
    const oldEngine = mkEngine({ sessionId: "s1" });
    const fresh = mkEngine({});
    const { s, c, threadId } = await bootThread({ sessions: [oldEngine, fresh], config: { cwd: "/tmp/proj" } });

    send(c, { id: 3, method: "thread/directory/add", params: { threadId, path: "/sess/c" } });
    send(c, { id: 4, method: "thread/permissionRule/add", params: { threadId, behavior: "deny", rule: "Bash(rm:*)" } });
    send(c, { id: 5, method: "thread/outputStyle/set", params: { threadId, style: "explanatory" } });
    send(c, { id: 6, method: "thread/effort/set", params: { threadId, level: "high" } });
    await settle();

    send(c, { id: 7, method: "thread/clear", params: { threadId } });
    await settle();

    expect(fresh.flagCalls).toEqual([
      { permissions: { allow: [], ask: [], deny: ["Bash(rm:*)"], additionalDirectories: ["/sess/c"] } },
      { outputStyle: "explanatory" },
      { effortLevel: "high" },
    ]);
    // and the accumulator still reads back on the wire afterwards
    send(c, { id: 8, method: "thread/directory/list", params: { threadId } });
    await tick();
    expect(reply(s.lines, 8).result.data).toEqual([{ path: "/tmp/proj", source: "cwd" }, { path: "/sess/c", source: "session" }]);
  });

  it("refuses while a turn is in flight (-33001 'turn') — before any swap", async () => {
    const busyEngine = mkEngine({ sessionId: "s1", submitImpl: () => new Promise(() => {}) });
    const fresh = mkEngine({});
    const { s, c, threadId, configs } = await bootThread({ sessions: [busyEngine, fresh] });

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    expect(reply(s.lines, 4).error.code).toBe(ERR.BUSY);
    expect(reply(s.lines, 4).error.message).toContain("turn");
    expect(configs).toHaveLength(1);
    expect(busyEngine.disposed).toBe(0);
  });

  it("refuses while a decision is parked (-33001) — the swap awaits a dispose the parked turn would deadlock", async () => {
    const engine = mkEngine({ sessionId: "s1" });
    let broker: { request(req: unknown): Promise<unknown> } | undefined;
    const configs: Record<string, unknown>[] = [];
    const srv = new AppServer({}, { sessionFactory: (cfg: Record<string, unknown>) => { configs.push(cfg); broker = cfg.permissionBroker as typeof broker; return engine as never; } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;

    void broker!.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_1", signal: new AbortController().signal });
    await tick();
    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    await settle();

    expect(reply(s.lines, 3).error.code).toBe(ERR.BUSY);
    expect(reply(s.lines, 3).error.message).toBe("a decision is pending — answer it first");
    expect(configs).toHaveLength(1);
  });

  it("turn/start during a clear is refused -33001 (swapping), same tick and again mid-dispose", async () => {
    let releaseDispose!: () => void;
    const oldEngine = mkEngine({ sessionId: "s1", disposeImpl: () => new Promise<void>((r) => { releaseDispose = r; }) });
    const { s, c, threadId } = await bootThread({ sessions: [oldEngine, mkEngine({})] });

    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await settle();

    expect(reply(s.lines, 4).error.message).toBe("Thread is busy (swapping)");
    expect(reply(s.lines, 3)).toBeUndefined();

    releaseDispose();
    await settle();
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: null });
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "now" } });
    await settle();
    expect(reply(s.lines, 5).result.turn.status).toBe("inProgress");
  });

  it("refuses -33007 while the server is shutting down, before the replacement factory is ever reached", async () => {
    const { s, c, threadId, configs, srv } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), mkEngine({})] });

    // Same tick as the shutdown pass, which is the whole window: `shuttingDown` latches synchronously
    // while the teardown itself sits behind each record's chain, so a clear admitted here would open a
    // replacement engine — an SDK session and its `claude` child — that the sweep has already walked past.
    const done = srv.shutdown();
    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    await settle();
    await done;

    expect(reply(s.lines, 3).error.code).toBe(ERR.SHUTTING_DOWN);
    expect(reply(s.lines, 3).error.message).toBe("Server is shutting down");
    expect(configs).toHaveLength(1);
  });

  it("a replacement factory that throws on an engine which died during the swap answers -33005, not -32603", async () => {
    let ended = false;
    let n = 0;
    // The outgoing engine's read loop ends with its dispose — which swapEngine awaits BEFORE building the
    // replacement, so the throw below lands with `record.session` still pointing at a dead engine.
    const oldEngine = mkEngine({ sessionId: "s1", isEndedImpl: () => ended, disposeImpl: async () => { ended = true; } });
    const { s, c, threadId, srv } = await bootThread({
      sessions: [oldEngine],
      deps: { sessionFactory: () => { if (n++ === 0) return oldEngine; throw new Error("replacement engine failed to open"); } },
    });

    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    await settle();

    expect(reply(s.lines, 3).error.code).toBe(ERR.ENGINE_GONE);
    expect(reply(s.lines, 3).error.message).toBe("Engine is gone (session ended)");
    expect(srv.registry.get(threadId)!.swapInFlight).toBe(false); // and the thread is not wedged at "swapping"
  });

  it("clears a thread whose engine never reported a session id — a fresh conversation needs no anchor (unlike a rewind)", async () => {
    const { s, c, threadId, configs } = await bootThread({ sessions: [mkEngine({}), mkEngine({})] });

    send(c, { id: 3, method: "thread/clear", params: { threadId } });
    await settle();

    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: null });
    expect(configs).toHaveLength(2);
  });

  it("a thread/read cursor minted before the clear is refused -32602 afterwards — the empty-page early return must not swallow it", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ type: "assistant", message: { id: `m${i}`, content: [{ type: "text", text: `t${i}` }] } }));
    const getSessionMessages = async (_sid: string, o?: { limit?: number; offset?: number }) => {
      if (!o) return rows;
      const { offset = 0, limit } = o;
      return rows.slice(offset, limit === undefined ? undefined : offset + limit);
    };
    const { s, c, threadId } = await bootThread({
      sessions: [mkEngine({ sessionId: "s1" }), mkEngine({})],
      deps: { getSessionMessages },
    });

    send(c, { id: 3, method: "thread/read", params: { threadId, limit: 2 } });
    await tick();
    const staleCursor = reply(s.lines, 3).result.nextCursor;
    expect(staleCursor).toBe("0:3");

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    send(c, { id: 5, method: "thread/read", params: { threadId, cursor: staleCursor } });
    await tick();
    expect(reply(s.lines, 5).error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply(s.lines, 5).error.message).toBe("cursor invalidated by a rewind; re-read from the start");
  });

  it("the discarded conversation's per-turn replay buffer does not survive the clear", async () => {
    const { srv, c, threadId } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), mkEngine({})] });

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "hello" } });
    await settle();
    expect(srv.registry.get(threadId)!.buffer.length).toBeGreaterThan(0);

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    expect(srv.registry.get(threadId)!.buffer).toEqual([]);
  });
});

// The chartered carry-forward from Task 1's review: an engine swap rebuilds from `record.config`, so
// EVERY runtime-mutated knob silently reverts unless the swap seam re-pushes it. One function, both paths.
describe("appserver post-swap state re-push (M2b Task 3b, both swap paths)", () => {
  it("a REWIND swap re-pushes the settings mirror and the flag accumulator onto the replacement engine", async () => {
    const oldEngine = mkEngine({ sessionId: "s1" });
    const fresh = mkEngine({});
    const { s, c, threadId } = await bootThread({
      sessions: [oldEngine],
      deps: { resumeAtFactory: () => fresh },
    });

    // runtime writes the replacement engine would otherwise lose
    send(c, { id: 3, method: "thread/model/set", params: { threadId, model: "claude-haiku-4-8" } });
    send(c, { id: 4, method: "thread/permissionMode/set", params: { threadId, mode: "acceptEdits" } });
    send(c, { id: 5, method: "thread/thinking/set", params: { threadId, maxTokens: 4096 } });
    send(c, { id: 6, method: "thread/directory/add", params: { threadId, path: "/sess/c" } });
    await settle();

    send(c, { id: 7, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "conversation" } });
    await settle();

    expect(reply(s.lines, 7).result).toEqual({ ok: true, sessionId: "s1" });
    expect(fresh.modelCalls).toEqual(["claude-haiku-4-8"]);
    expect(fresh.modeCalls).toEqual(["acceptEdits"]);
    expect(fresh.thinkingCalls).toEqual([4096]);
    expect(fresh.flagCalls).toEqual([{ permissions: { ...EMPTY_PERMS, additionalDirectories: ["/sess/c"] } }]);
  });

  it("a CLEAR swap re-pushes the same state — the security-relevant one is permissionMode: the mirror is what the wire announces", async () => {
    const fresh = mkEngine({});
    const { s, c, threadId, srv } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), fresh] });

    send(c, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "plan" } });
    await settle();

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    expect(reply(s.lines, 4).result.ok).toBe(true);
    expect(fresh.modeCalls).toEqual(["plan"]);
    expect(srv.registry.get(threadId)!.settings.permissionMode).toBe("plan"); // mirror and engine agree
  });

  it("a replacement engine MISSING the optional setters is skipped silently — no throw, no warning", async () => {
    const fresh = mkEngine({ noSetters: true, noFlags: true });
    const { s, c, threadId } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), fresh] });

    send(c, { id: 3, method: "thread/model/set", params: { threadId, model: "claude-haiku-4-8" } });
    await settle();

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    expect(reply(s.lines, 4).result.ok).toBe(true);
    expect(notif(s.lines, "warning")).toBeUndefined();
  });

  it("a re-push that FAILS does not fail the swap — the caller still gets ok, and the warning names what was lost, carries the threadId, and reaches watchers as well as subscribers", async () => {
    const fresh = mkEngine({ flagImpl: async () => { throw new Error("engine refused the replay"); } });
    fresh.setPermissionMode = async () => { throw new Error("engine refused the mode"); };
    const { s, w, c, threadId, srv } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), fresh], watcher: true });

    send(c, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "acceptEdits" } });
    send(c, { id: 4, method: "thread/directory/add", params: { threadId, path: "/sess/c" } });
    await settle();

    send(c, { id: 5, method: "thread/clear", params: { threadId } });
    await settle();

    expect(reply(s.lines, 5).result.ok).toBe(true);       // the swap completed; the record holds a live engine
    expect(srv.registry.get(threadId)!.session).toBe(fresh);
    const warnings = notifs(s.lines, "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].params.threadId).toBe(threadId);   // WHICH thread lost state — a bare {code,message} cannot say
    expect(warnings[0].params.code).toBe("stateRepushFailed");
    expect(warnings[0].params.message).toContain("permissionMode");
    expect(warnings[0].params.message).toContain("permissions");
    // the same both-scope audience thread/rewound has: lost state is a fact about what this thread now IS
    const watcherWarnings = notifs(w!.lines, "warning");
    expect(watcherWarnings).toHaveLength(1);
    expect(watcherWarnings[0].params).toEqual(warnings[0].params);
  });

  it("a rejected mirror step reconciles the mirror to what the replacement engine really has — the config seed — and announces it as source:'engine'", async () => {
    const fresh = mkEngine({});
    fresh.setPermissionMode = async () => { throw new Error("engine refused the mode"); };
    const { s, c, threadId, srv } = await bootThread({
      sessions: [mkEngine({ sessionId: "s1" }), fresh],
      config: { permissionMode: "default" },
    });

    send(c, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "acceptEdits" } });
    await settle();
    expect(srv.registry.get(threadId)!.settings.permissionMode).toBe("acceptEdits");
    s.lines.length = 0; // drop the client leg's own settings/changed — what follows is the swap's doing

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    // The replacement was BUILT from record.config, so "default" — not the client's write — is the mode it
    // is actually running. Leaving "acceptEdits" in the mirror is threadView announcing a permission
    // posture no engine is honouring.
    expect(srv.registry.get(threadId)!.settings.permissionMode).toBe("default");
    const changed = notifs(s.lines, "thread/settings/changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].params.threadId).toBe(threadId);
    expect(changed[0].params.source).toBe("engine");      // the engine decided this, not a client
    expect(changed[0].params.permissionMode).toBe("default");
    expect(notifs(s.lines, "warning")[0].params.message).toContain("permissionMode"); // and the loss is still named
  });

  it("a rejected mirror step for a knob the config never named CLEARS the field — the replacement has no value for it at all", async () => {
    const fresh = mkEngine({});
    fresh.setModel = async () => { throw new Error("unknown model"); };
    const { s, c, threadId, srv } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), fresh] });

    send(c, { id: 3, method: "thread/model/set", params: { threadId, model: "claude-haiku-4-8" } });
    await settle();
    s.lines.length = 0;

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();

    expect(srv.registry.get(threadId)!.settings.model).toBeUndefined();
    const changed = notifs(s.lines, "thread/settings/changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].params.source).toBe("engine");
    expect("model" in changed[0].params).toBe(false);     // JSON drops the cleared key — "no model", not a stale one
    expect(notifs(s.lines, "warning")[0].params.message).toContain("model");
  });

  it("an ACCEPTED re-push announces nothing — the mirror never moved, so the replacement's own status echo is echo-deduped away (router.ts)", async () => {
    const fresh = mkEngine({});
    const { s, c, threadId, srv } = await bootThread({ sessions: [mkEngine({ sessionId: "s1" }), fresh] });

    send(c, { id: 3, method: "thread/permissionMode/set", params: { threadId, mode: "plan" } });
    await settle();
    s.lines.length = 0;

    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await settle();
    expect(fresh.modeCalls).toEqual(["plan"]);            // the replacement accepted the whole re-push

    fresh.push({ type: "system", subtype: "status", permissionMode: "plan" }); // the replacement echoing it back
    await tick();

    expect(notifs(s.lines, "thread/settings/changed")).toEqual([]);
    expect(notifs(s.lines, "warning")).toEqual([]);
    expect(srv.registry.get(threadId)!.settings.permissionMode).toBe("plan");
  });
});
