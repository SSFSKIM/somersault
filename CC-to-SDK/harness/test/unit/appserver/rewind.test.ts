// test/unit/appserver/rewind.test.ts — M2b Task 1: the rewind trio (thread/rewind/anchors,
// thread/rewind/dryRun, thread/rewind) driven through the full AppServer RPC surface, as
// turns.test.ts/lifecycle2.test.ts do — so the synchronous gates, the chain scoping, the engine swap and
// the two-scope fan-out are all proven together against real dispatch rather than in isolation. Copies
// Task 6's mkSink/send/parsed/init helpers so this file reads standalone.
//
// Engine-faithful fakes (Global Constraints, verbatim): `dispose()` AWAITS on a real timer — the real
// Session.dispose is `input.close(); await this.done` (src/session/session.ts), so a fake that resolves
// synchronously would let a swap "complete" in a window the real one cannot. `onFrame`'s unsubscribe
// deletes from the LIVE callback set only, while `captured` keeps every callback ever handed out: the real
// read loop dispatches each frame over a SNAPSHOT (`for (const cb of [...this.frameCbs])`,
// src/session/session.ts:266), so a dispatch that began before the swap's `routerOff()` still reaches the
// router afterwards. `pushStale` replays exactly that — the superseded engine's late frame, which is what
// the epoch guard (and nothing else) has to make inert.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
/** The swap crosses several real timer boundaries (an awaiting dispose, the chain callback) — one tick is
 *  not enough to drain it, so every assertion after a thread/rewind waits on this instead. */
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
const init = (c: { feed(ch: string): void }, id: number, name = "t", extra: object = {}) =>
  send(c, { id, method: "initialize", params: { clientInfo: { name }, ...extra } });

type RewindCall = [string, { dryRun?: boolean } | undefined];

interface FakeEngine {
  sessionId?: string;
  rewindCalls: RewindCall[];
  disposed: number;
  live: Set<(m: unknown) => void>;
  captured: ((m: unknown) => void)[];
  push(frame: unknown): void;
  pushStale(frame: unknown): void;
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  onFrame(cb: (m: unknown) => void): () => void;
  rewind?(uuid: string, opts?: { dryRun?: boolean }): Promise<unknown>;
}

function mkEngine(opts: {
  sessionId?: string;
  /** what `rewind(uuid, opts?)` does — default: dryRun answers {canRewind:true}, the real call resolves. */
  rewindImpl?: (uuid: string, o?: { dryRun?: boolean }) => Promise<unknown>;
  /** omit `rewind` entirely — an engine build that has no rewindFiles at all. */
  noRewind?: boolean;
  disposeImpl?: () => Promise<void>;
  submitImpl?: () => Promise<{ result: unknown }>;
} = {}): FakeEngine {
  const live = new Set<(m: unknown) => void>();
  const captured: ((m: unknown) => void)[] = [];
  const e: FakeEngine = {
    sessionId: opts.sessionId,
    rewindCalls: [],
    disposed: 0,
    live,
    captured,
    push: (frame) => { for (const cb of [...live]) cb(frame); },
    pushStale: (frame) => { for (const cb of captured) cb(frame); },
    submit: opts.submitImpl ?? (async () => ({ result: {} })),
    interrupt: async () => ({}),
    dispose: () => { e.disposed++; return opts.disposeImpl ? opts.disposeImpl() : new Promise<void>((r) => setTimeout(r, 1)); },
    onFrame: (cb) => { live.add(cb); captured.push(cb); return () => { live.delete(cb); }; },
  };
  if (!opts.noRewind) {
    e.rewind = (uuid, o) => {
      e.rewindCalls.push([uuid, o]);
      return opts.rewindImpl ? opts.rewindImpl(uuid, o) : Promise.resolve(o?.dryRun ? { canRewind: true } : { ok: true });
    };
  }
  return e;
}

/** Boots a server + one initialized, subscribed connection on one started thread. `watcher: true` adds a
 *  SECOND connection that only opted into server-scoped fan-out (initialize{watchThreads:true}) and never
 *  subscribes — the orthogonal scope thread/rewound must also reach. */
async function bootThread(opts: {
  session: (cfg: Record<string, unknown>) => FakeEngine;
  deps?: Record<string, unknown>;
  config?: Record<string, unknown>;
  watcher?: boolean;
}) {
  const startConfigs: Record<string, unknown>[] = [];
  const srv = new AppServer({}, {
    sessionFactory: (cfg: Record<string, unknown>) => { startConfigs.push(cfg); return opts.session(cfg) as never; },
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
  return { srv, s, c, w, threadId, startConfigs };
}

const reply = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notif = (lines: string[], method: string) => parsed(lines).find((f) => f.method === method);

describe("appserver thread/rewind/anchors (M2b Task 1)", () => {
  it("maps the persisted transcript through rewindAnchorsFrom: a phantom row is not an anchor, and is walked PAST when the next prompt's prevUuid is computed", async () => {
    // One phantom (a slash-command echo row) followed by one real prompt. Two properties in one fixture:
    // the phantom yields no anchor of its own, and the prompt's prevUuid is null rather than the phantom's
    // uuid — i.e. a rewind to this prompt also drops the phantom row (rows.ts's PHANTOM walk).
    const rows = [
      { type: "user", uuid: "ph1", message: { content: "<command-name>/model</command-name>" } },
      { type: "user", uuid: "u2", message: { content: "second prompt" }, timestamp: "2026-08-11T00:00:00Z" },
    ];
    const { s, c, threadId } = await bootThread({
      session: () => mkEngine({ sessionId: "sess-1" }),
      deps: { getSessionMessages: async () => rows },
    });

    send(c, { id: 3, method: "thread/rewind/anchors", params: { threadId } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({
      data: [{ uuid: "u2", prevUuid: null, text: "second prompt", index: 1, timestamp: "2026-08-11T00:00:00Z" }],
      nextCursor: null,
    });
  });

  it("a thread whose engine has not reported a sessionId yet is an empty page, not an error", async () => {
    const { s, c, threadId } = await bootThread({
      session: () => mkEngine({}), // no sessionId — the init latch has nothing to latch yet
      deps: { getSessionMessages: async () => { throw new Error("must not be read"); } },
    });

    send(c, { id: 3, method: "thread/rewind/anchors", params: { threadId } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ data: [], nextCursor: null });
  });
});

describe("appserver thread/rewind/dryRun (M2b Task 1)", () => {
  it("normalizes a THROWING engine to {canRewind:false, error} — the throw-vs-return split (probe 68d) never reaches the wire", async () => {
    const { s, c, threadId } = await bootThread({
      session: () => mkEngine({ sessionId: "sess-1", rewindImpl: async () => { throw new Error("checkpointing is off"); } }),
    });

    send(c, { id: 3, method: "thread/rewind/dryRun", params: { threadId, uuid: "u2" } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ canRewind: false, error: "checkpointing is off" });
  });

  it("an engine with no rewind at all answers {canRewind:false, error:'rewind unsupported by this engine'}", async () => {
    const { s, c, threadId } = await bootThread({ session: () => mkEngine({ sessionId: "sess-1", noRewind: true }) });

    send(c, { id: 3, method: "thread/rewind/dryRun", params: { threadId, uuid: "u2" } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ canRewind: false, error: "rewind unsupported by this engine" });
  });

  it("an engine that answers gets its own result back verbatim, and the call carries {dryRun:true}", async () => {
    const engine = mkEngine({ sessionId: "sess-1", rewindImpl: async () => ({ canRewind: true, filesChanged: 3 }) });
    const { s, c, threadId } = await bootThread({ session: () => engine });

    send(c, { id: 3, method: "thread/rewind/dryRun", params: { threadId, uuid: "u2" } });
    await tick();

    expect(reply(s.lines, 3).result).toEqual({ canRewind: true, filesChanged: 3 });
    expect(engine.rewindCalls).toEqual([["u2", { dryRun: true }]]);
  });
});

describe("appserver thread/rewind refusals (M2b Task 1)", () => {
  it("refuses while a turn is in flight (-33001 'turn') BEFORE the engine's rewind was called", async () => {
    const engine = mkEngine({ sessionId: "sess-1", submitImpl: () => new Promise(() => {}) }); // turn never ends
    const { s, c, threadId } = await bootThread({ session: () => engine });

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    send(c, { id: 4, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();

    expect(reply(s.lines, 4).error.code).toBe(ERR.BUSY);
    expect(reply(s.lines, 4).error.message).toContain("turn");
    expect(engine.rewindCalls).toEqual([]);
  });

  it("refuses while a decision is parked (-33001) BEFORE the engine's rewind was called", async () => {
    const engine = mkEngine({ sessionId: "sess-1" });
    let broker: { request(req: unknown): Promise<unknown> } | undefined;
    const { s, c, threadId } = await bootThread({
      session: (cfg) => { broker = cfg.permissionBroker as typeof broker; return engine; },
    });

    void broker!.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_1", signal: new AbortController().signal });
    await tick();
    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();

    expect(reply(s.lines, 3).error.code).toBe(ERR.BUSY);
    expect(reply(s.lines, 3).error.message).toBe("a decision is pending — answer it first");
    expect(engine.rewindCalls).toEqual([]);
  });

  it("refuses a thread with no sessionId yet (-33005) BEFORE the engine's rewind was called", async () => {
    const engine = mkEngine({}); // no sessionId
    const { s, c, threadId } = await bootThread({ session: () => engine });

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();

    expect(reply(s.lines, 3).error.code).toBe(ERR.ENGINE_GONE);
    expect(engine.rewindCalls).toEqual([]);
  });

  it("refuses a both-scope rewind with a null prevUuid (-32602) BEFORE the engine's rewind was called — validation precedes every side effect", async () => {
    const engine = mkEngine({ sessionId: "sess-1" });
    let swapped = 0;
    const { s, c, threadId } = await bootThread({
      session: () => engine,
      deps: { resumeAtFactory: () => { swapped++; return mkEngine({}); } },
    });

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: null, scope: "both" } });
    await settle();

    expect(reply(s.lines, 3).error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply(s.lines, 3).error.message).toBe("no conversation anchor before the first prompt — code-only rewind is available");
    // The whole point of the ordering: nothing was touched. No file restore, no swap.
    expect(engine.rewindCalls).toEqual([]);
    expect(engine.disposed).toBe(0);
    expect(swapped).toBe(0);
  });

  it("a dry run that says no refuses the whole rewind, never reaches the real (throwing) restore, and releases the swap latch", async () => {
    const engine = mkEngine({
      sessionId: "sess-1",
      rewindImpl: async (_uuid, o) => { if (o?.dryRun) return { canRewind: false, error: "file checkpointing is disabled" }; throw new Error("must not be called"); },
    });
    const { s, c, threadId, srv } = await bootThread({ session: () => engine });

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();

    expect(reply(s.lines, 3).error.code).toBe(ERR.INTERNAL);
    expect(reply(s.lines, 3).error.message).toBe("file checkpointing is disabled");
    expect(engine.rewindCalls).toEqual([["u2", { dryRun: true }]]); // the real restore was never attempted
    expect(engine.disposed).toBe(0);
    expect(srv.registry.get(threadId)!.swapInFlight).toBe(false); // finally released — the thread is usable again
  });
});

describe("appserver thread/rewind engine swap (M2b Task 1)", () => {
  it("scope 'both': dry run then the real restore on the LIVE engine, then the swap — epoch bumped, old router off, old engine disposed, resumeAtFactory called with (sessionId, prevUuid, the discarded turn's uuid, the thread's ORIGINAL config), router reinstalled on the replacement, thread/rewound to subscribers AND watchers", async () => {
    const oldEngine = mkEngine({ sessionId: "sess-1" });
    const newEngine = mkEngine({}); // a fresh engine's sessionId getter is undefined until its first init frame
    const factoryCalls: Array<[string, string, string, Record<string, unknown>]> = [];
    const { s, w, c, threadId, srv, startConfigs } = await bootThread({
      session: () => oldEngine,
      config: { model: "claude-opus-4-8", cwd: "/tmp/proj" },
      watcher: true,
      deps: {
        resumeAtFactory: (sid: string, at: string, dropped: string, cfg: Record<string, unknown>) => { factoryCalls.push([sid, at, dropped, cfg]); return newEngine; },
      },
    });
    const epochBefore = srv.registry.get(threadId)!.epoch;

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();

    // (4) file restore on the live engine: dry run FIRST, then the real call — host order, verbatim
    expect(oldEngine.rewindCalls).toEqual([["u2", { dryRun: true }], ["u2", undefined]]);
    // (5) the swap
    const record = srv.registry.get(threadId)!;
    expect(record.epoch).toBe(epochBefore + 1);
    expect(oldEngine.disposed).toBe(1);
    expect(oldEngine.live.size).toBe(0);        // its router was unsubscribed before the dispose
    expect(record.session).toBe(newEngine);
    expect(newEngine.live.size).toBe(1);        // the router was reinstalled on the replacement
    expect(factoryCalls).toHaveLength(1);
    const [sid, at, dropped, cfg] = factoryCalls[0];
    expect(sid).toBe("sess-1");
    expect(at).toBe("u1");
    // M3 Wave 0: the request's `uuid` IS the discarded turn's prompt — the rewind resumes at `prevUuid`
    // and throws away the turn `uuid` opened — so it rides along as the SDK's `resumeDropsTurn` guard.
    expect(dropped).toBe("u2");
    // the thread's ORIGINAL start config — including the decision broker, or the replacement engine would
    // park nothing and every later tool call would bypass this server's permission surface entirely
    expect(cfg.model).toBe("claude-opus-4-8");
    expect(cfg.cwd).toBe("/tmp/proj");
    expect(cfg.permissionBroker).toBe(startConfigs[0].permissionBroker);
    // (6) reply + fan-out
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: "sess-1" });
    expect(notif(s.lines, "thread/rewound").params).toEqual({ threadId, sessionId: "sess-1" });
    expect(notif(w!.lines, "thread/rewound").params).toEqual({ threadId, sessionId: "sess-1" });
    // turn ids keep counting across the swap, so a post-rewind turn can never collide with a pre-rewind one
    expect(record.turnSeq).toBe(0);
    // the thread is usable again
    expect(record.swapInFlight).toBe(false);
  });

  it("scope 'code' with a null prevUuid is allowed: the file restore runs, no engine swap happens, and the reply still carries the session id", async () => {
    const engine = mkEngine({ sessionId: "sess-1" });
    let swapped = 0;
    const { s, c, threadId, srv } = await bootThread({
      session: () => engine,
      deps: { resumeAtFactory: () => { swapped++; return mkEngine({}); } },
    });

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: null, scope: "code" } });
    await settle();

    expect(engine.rewindCalls).toEqual([["u2", { dryRun: true }], ["u2", undefined]]);
    expect(swapped).toBe(0);
    expect(engine.disposed).toBe(0);
    expect(srv.registry.get(threadId)!.epoch).toBe(0); // no swap, no generation change
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: "sess-1" });
  });

  it("scope 'conversation' skips the file restore entirely and only swaps", async () => {
    const oldEngine = mkEngine({ sessionId: "sess-1" });
    const newEngine = mkEngine({});
    const { s, c, threadId, srv } = await bootThread({
      session: () => oldEngine,
      deps: { resumeAtFactory: () => newEngine },
    });

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "conversation" } });
    await settle();

    expect(oldEngine.rewindCalls).toEqual([]); // no dry run, no restore — the files are left alone
    expect(oldEngine.disposed).toBe(1);
    expect(srv.registry.get(threadId)!.session).toBe(newEngine);
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: "sess-1" });
  });

  it("a failing dispose does not abort the swap — the replacement engine is still installed and the caller still gets ok", async () => {
    const oldEngine = mkEngine({ sessionId: "sess-1", disposeImpl: async () => { throw new Error("read loop already dead"); } });
    const newEngine = mkEngine({});
    const { s, c, threadId, srv } = await bootThread({
      session: () => oldEngine,
      deps: { resumeAtFactory: () => newEngine },
    });

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();

    expect(srv.registry.get(threadId)!.session).toBe(newEngine);
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: "sess-1" });
  });

  it("turn/start during a swap is refused -33001 (swapping): same tick as the rewind, and again while the old engine's dispose is still hanging", async () => {
    let releaseDispose!: () => void;
    const oldEngine = mkEngine({ sessionId: "sess-1", disposeImpl: () => new Promise<void>((r) => { releaseDispose = r; }) });
    const newEngine = mkEngine({});
    const { s, c, threadId } = await bootThread({
      session: () => oldEngine,
      deps: { resumeAtFactory: () => newEngine },
    });

    // SAME TICK — the latch must be set at request arrival, not deferred into the chain callback, or this
    // turn/start is admitted and runs its engine call against a thread that is being swapped out.
    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await settle();

    expect(reply(s.lines, 4).error.code).toBe(ERR.BUSY);
    expect(reply(s.lines, 4).error.message).toBe("Thread is busy (swapping)");
    expect(reply(s.lines, 3)).toBeUndefined(); // the rewind has not replied — the dispose is still hanging

    // still refused deep inside the swap, with the engine call genuinely in flight
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "go again" } });
    await settle();
    expect(reply(s.lines, 5).error.message).toBe("Thread is busy (swapping)");

    releaseDispose();
    await settle();
    expect(reply(s.lines, 3).result).toEqual({ ok: true, sessionId: "sess-1" });
    // and once the swap is done the thread takes turns again
    send(c, { id: 6, method: "turn/start", params: { threadId, input: "now" } });
    await settle();
    expect(reply(s.lines, 6).result.turn.status).toBe("inProgress");
  });

  it("a frame from the SUPERSEDED engine landing after the swap changes nothing — no thread/settings/changed, no mirror write", async () => {
    const oldEngine = mkEngine({ sessionId: "sess-1" });
    const newEngine = mkEngine({});
    const { s, c, threadId, srv } = await bootThread({
      session: () => oldEngine,
      deps: { resumeAtFactory: () => newEngine },
    });

    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();
    s.lines.length = 0;

    // The old engine's router callback, dispatched from a snapshot taken before routerOff() ran (see the
    // file header). Its epoch is one behind the record's, and that is the whole of what makes it inert.
    oldEngine.pushStale({ type: "system", subtype: "status", permissionMode: "acceptEdits" });
    await settle();

    expect(notif(s.lines, "thread/settings/changed")).toBeUndefined();
    expect(srv.registry.get(threadId)!.settings.permissionMode).toBeUndefined();

    // the CURRENT engine's identical frame still routes — the guard is generational, not a blanket mute
    newEngine.push({ type: "system", subtype: "status", permissionMode: "acceptEdits" });
    await settle();
    expect(notif(s.lines, "thread/settings/changed").params.permissionMode).toBe("acceptEdits");
    expect(srv.registry.get(threadId)!.settings.permissionMode).toBe("acceptEdits");
  });

  it("the discarded conversation's per-turn replay buffer does not survive the swap — a client subscribing after the rewind is replayed no items from it", async () => {
    const oldEngine = mkEngine({ sessionId: "sess-1" });
    const { srv, c, threadId } = await bootThread({
      session: () => oldEngine,
      deps: { resumeAtFactory: () => mkEngine({}) },
    });

    // one completed turn, so the buffer holds real item events from the conversation about to be dropped
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "hello" } });
    await settle();
    expect(srv.registry.get(threadId)!.buffer.length).toBeGreaterThan(0);

    send(c, { id: 4, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();

    expect(srv.registry.get(threadId)!.buffer).toEqual([]);
    const late = mkSink(); const lateConn = srv.connect(late.sink);
    init(lateConn, 1, "L");
    send(lateConn, { id: 2, method: "thread/subscribe", params: { threadId } });
    await settle();
    expect(parsed(late.lines).filter((f) => typeof f.method === "string" && f.method.startsWith("item/"))).toEqual([]);
  });

  it("a thread/read cursor minted before the rewind is refused -32602 afterwards; a fresh read mints one at the new epoch", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ type: "assistant", message: { id: `m${i}`, content: [{ type: "text", text: `t${i}` }] } }));
    const getSessionMessages = async (_sid: string, o?: { limit?: number; offset?: number }) => {
      if (!o) return rows;
      const { offset = 0, limit } = o;
      return rows.slice(offset, limit === undefined ? undefined : offset + limit);
    };
    const { s, c, threadId } = await bootThread({
      session: () => mkEngine({ sessionId: "sess-1" }),
      deps: { getSessionMessages, resumeAtFactory: () => mkEngine({}) },
    });

    send(c, { id: 3, method: "thread/read", params: { threadId, limit: 2 } });
    await tick();
    const staleCursor = reply(s.lines, 3).result.nextCursor;
    expect(staleCursor).toBe("0:3");

    send(c, { id: 4, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "both" } });
    await settle();
    expect(reply(s.lines, 4).result.ok).toBe(true);

    send(c, { id: 5, method: "thread/read", params: { threadId, cursor: staleCursor } });
    await tick();
    expect(reply(s.lines, 5).error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply(s.lines, 5).error.message).toBe("cursor invalidated by a rewind; re-read from the start");

    // re-reading from the start works and hands back a cursor qualified by the NEW generation
    send(c, { id: 6, method: "thread/read", params: { threadId, limit: 2 } });
    await tick();
    expect(reply(s.lines, 6).result.nextCursor).toBe("1:3");
  });
});
