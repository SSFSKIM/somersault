// test/unit/appserver/lifecycle.test.ts — the final-review fix wave's lifecycle half: thread teardown
// ordering (C1), the late-arriving engine sessionId (C3), thread/closed + AppServer.shutdown() (I7) and
// broadcast()'s per-subscriber guard (M2). Copies Task 6's mkSink/send/parsed helpers
// (test/unit/appserver/server.test.ts) so this file reads standalone.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
// The `thread/list` replies below are awaited with `waitReply`, not the bare `tick` the rest of this file
// uses: since M5 Task 10 that handler reads the archive marker directory before replying, so its reply
// lands a filesystem round-trip after the request rather than within one macrotask.
import { waitReply } from "../../helpers/waitReply.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });
const park = (broker: any, toolUseID: string) => broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID, signal: new AbortController().signal });

/** A session whose dispose() models the REAL engine: Session.dispose() is `input.close(); await this.done`,
 *  and `done` is the read loop — which cannot end while the turn is blocked inside canUseTool awaiting a
 *  parked promise. So dispose() here resolves only once every park handed to it has settled. A fake that
 *  resolves dispose() immediately cannot catch the circular wait, which is exactly why the original suite
 *  missed C1. */
function blockingSession(state: { parked: Promise<unknown>[]; disposed: number }) {
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => { state.disposed++; await Promise.all(state.parked); },
    onFrame: () => () => {},
    sessionId: "sess-1",
  };
}

describe("appserver thread teardown (C1/I7)", () => {
  it("thread/close settles the parked decisions BEFORE awaiting dispose(), so a dispose that waits on the parked turn still replies", async () => {
    const state = { parked: [] as Promise<unknown>[], disposed: 0 };
    let broker: any;
    const srv = new AppServer({}, { listSessions: async () => [], sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return blockingSession(state); } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();

    const parked = park(broker, "toolu_c1");
    state.parked.push(parked);
    await tick();
    s.lines.length = 0;

    send(c, { id: 4, method: "thread/close", params: { threadId } });
    await tick(); await tick();

    // pre-fix: no reply at all (dispose() awaits the park, teardown() sits behind that await)
    expect(parsed(s.lines).find((f) => f.id === 4)?.result).toEqual({ ok: true });
    expect(state.disposed).toBe(1);
    expect(await parked).toEqual({ kind: "deny" });
    const resolved = parsed(s.lines).find((f) => f.method === "decision/resolved");
    expect(resolved.params).toMatchObject({ threadId, toolUseId: "toolu_c1", by: "system", answer: { kind: "deny" } });

    // record.chain must not be left pending either — a later thread-scoped request still gets an answer
    send(c, { id: 5, method: "thread/list", params: {} });
    send(c, { id: 6, method: "turn/start", params: { threadId, input: "x" } });
    await tick();
    expect((await waitReply(s.lines, 5)).result.data).toHaveLength(0);
    expect(parsed(s.lines).find((f) => f.id === 6).error.code).toBe(-33004);
  });

  it("a tool the model reaches for AFTER the closing deny is denied too, instead of parking with nobody left to answer", async () => {
    // The re-parking case the first fix wave missed: denying a tool hands control back to the model, and a
    // denied model routinely tries a different tool. If that second request parks, dispose() waits on it
    // forever and the C1 deadlock is back — teardown() has already run and will not run again.
    const state = { parked: [] as Promise<unknown>[], disposed: 0 };
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return blockingSession(state); } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();

    const first = park(broker, "toolu_first");
    // The model's reaction to the deny: ask for a different tool. Chained off the first park so it is
    // raised at exactly the moment the closing deny lands, which is when the real engine would raise it.
    const second = first.then(() => park(broker, "toolu_second"));
    state.parked.push(first, second);
    await tick();

    send(c, { id: 4, method: "thread/close", params: { threadId } });
    await tick(); await tick(); await tick();

    expect(await second).toEqual({ kind: "deny" });                       // pre-fix: parks forever
    expect(parsed(s.lines).find((f) => f.id === 4)?.result).toEqual({ ok: true }); // pre-fix: never replies
    expect(state.disposed).toBe(1);
  });

  it("a decision parked while the thread is idle carries NO turnId, not the finished turn's", async () => {
    // currentTurnId is never cleared at completion (replay wants the last turn's id), so reading it bare
    // stamps an idle-thread park with the id of a turn that already ended — a UI would hang the park off a
    // dead turn row. `busy` is the honest gate.
    const state = { parked: [] as Promise<unknown>[], disposed: 0 };
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return blockingSession(state); } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();

    send(c, { id: 4, method: "turn/start", params: { threadId, input: "x" } });
    await tick(); await tick();
    const turnId = parsed(s.lines).find((f) => f.id === 4).result.turn.id;
    expect(parsed(s.lines).find((f) => f.method === "turn/completed")).toBeTruthy(); // the thread is idle again
    s.lines.length = 0;

    state.parked.push(park(broker, "toolu_idle"));
    await tick();
    const requested = parsed(s.lines).find((f) => f.method === "decision/requested");
    expect(requested.params.threadId).toBe(threadId);
    expect(requested.params.turnId, `stamped the finished turn ${turnId}`).toBeUndefined();
  });

  it("thread/close broadcasts thread/closed to that thread's subscribers before the record is removed", async () => {
    const state = { parked: [] as Promise<unknown>[], disposed: 0 };
    const srv = new AppServer({}, { sessionFactory: () => blockingSession(state) });
    const a = mkSink(); const connA = srv.connect(a.sink);
    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connA, 1, "A"); init(connB, 1, "B");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    send(connB, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    b.lines.length = 0;

    send(connA, { id: 4, method: "thread/close", params: { threadId } });
    await tick(); await tick();

    const closed = parsed(b.lines).filter((f) => f.method === "thread/closed");
    expect(closed).toHaveLength(1);
    expect(closed[0].params).toEqual({ threadId });
  });

  it("thread/close latches record.closing SYNCHRONOUSLY, so a compact/reinitialize/turn arriving while the dispose is still in flight is refused -33001 (closing) and never reaches the engine", async () => {
    // The dispose sits behind record.chain, and none of these three gates consult the chain — they gate on
    // threadBusyReason. Without the latch each was admitted against a record already being torn down: the
    // engine call ran, and its reply raced closeRecord's own.
    let compactCalls = 0, reinitCalls = 0, submitCalls = 0;
    const hanging = () => ({
      submit: async () => { submitCalls++; return { result: {} }; },
      interrupt: async () => ({}),
      dispose: () => new Promise<void>(() => {}), // never resolves — the close stays in flight
      onFrame: () => () => {},
      compact: async () => { compactCalls++; return { ok: true }; },
      reinitialize: async () => { reinitCalls++; return {}; },
      sessionId: "sess-1",
    });
    const srv = new AppServer({}, { sessionFactory: hanging });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;

    send(c, { id: 3, method: "thread/close", params: { threadId } });
    send(c, { id: 4, method: "thread/compact/start", params: { threadId } });
    send(c, { id: 5, method: "thread/reinitialize", params: { threadId } });
    send(c, { id: 6, method: "turn/start", params: { threadId, input: "go" } });
    await tick(); await tick();

    for (const id of [4, 5, 6]) {
      const err = parsed(s.lines).find((f) => f.id === id).error;
      expect(err.code, `request ${id}`).toBe(-33001);
      expect(err.message, `request ${id}`).toMatch(/closing/);
    }
    expect([compactCalls, reinitCalls, submitCalls]).toEqual([0, 0, 0]);
  });

  it("thread/close still broadcasts thread/closed and drops the record when dispose() rejects", async () => {
    const failing = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => { throw new Error("dispose boom"); }, onFrame: () => () => {}, sessionId: "sess-x" });
    const srv = new AppServer({}, { sessionFactory: failing });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();

    send(c, { id: 4, method: "thread/close", params: { threadId } });
    await tick(); await tick();
    expect(parsed(s.lines).find((f) => f.id === 4).error.message).toMatch(/dispose boom/);
    expect(parsed(s.lines).some((f) => f.method === "thread/closed")).toBe(true);
    expect(srv.registry.list()).toHaveLength(0);
  });

  it("shutdown() settles every parked decision, disposes every live thread and empties the registry", async () => {
    const state1 = { parked: [] as Promise<unknown>[], disposed: 0 };
    const state2 = { parked: [] as Promise<unknown>[], disposed: 0 };
    const states = [state1, state2];
    const brokers: any[] = [];
    let n = 0;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { brokers.push(cfg.permissionBroker); return blockingSession(states[n++]); } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    send(c, { id: 3, method: "thread/start", params: {} });
    await tick();
    const t1 = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
    send(c, { id: 4, method: "thread/subscribe", params: { threadId: t1 } });
    await tick();

    const parked = park(brokers[0], "toolu_sd");
    state1.parked.push(parked);
    await tick();
    s.lines.length = 0;

    await srv.shutdown(); // same ordering lesson as C1: this must not hang on thread 1's parked decision

    expect(await parked).toEqual({ kind: "deny" });
    expect(state1.disposed).toBe(1);
    expect(state2.disposed).toBe(1);
    expect(srv.registry.list()).toHaveLength(0);
    expect(parsed(s.lines).some((f) => f.method === "thread/closed" && f.params.threadId === t1)).toBe(true);
  });

  it("a thread/start landing WHILE shutdown() awaits a slow dispose is refused, so nothing outlives the shutdown", async () => {
    // shutdown() snapshots registry.list() once and then awaits disposal — but the listener is still open
    // the whole time, so a thread admitted inside that window was never in the Promise.all and survived the
    // shutdown: a leaked SDK session (and its `claude` child) with nothing left to close it.
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    let created = 0;
    const srv = new AppServer({}, { sessionFactory: () => { created++; return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => { await slow; }, onFrame: () => () => {}, sessionId: "sess-1" }; } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    expect(created).toBe(1);

    const done = srv.shutdown();          // parked on the slow dispose above
    await tick();
    send(c, { id: 3, method: "thread/start", params: {} });
    send(c, { id: 4, method: "thread/resume", params: { sessionId: "sess-old" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 3).error.code).toBe(-33007);  // SHUTTING_DOWN: the SERVER is done taking work
    expect(parsed(s.lines).find((f) => f.id === 4).error.code).toBe(-33007);
    expect(created).toBe(1);                                                  // no engine was ever opened for them

    release();
    await done;
    expect(srv.registry.list()).toHaveLength(0);                              // pre-fix: the late thread is still here
  });

  it("shutdown() disposes the remaining threads even when one thread's dispose() rejects", async () => {
    const ok = { parked: [] as Promise<unknown>[], disposed: 0 };
    let first = true;
    const srv = new AppServer({}, { sessionFactory: () => {
      if (first) { first = false; return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => { throw new Error("boom"); }, onFrame: () => () => {}, sessionId: "s" }; }
      return blockingSession(ok);
    } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    send(c, { id: 3, method: "thread/start", params: {} });
    await tick();

    await srv.shutdown();
    expect(ok.disposed).toBe(1);
    expect(srv.registry.list()).toHaveLength(0);
  });
});

describe("appserver record.sessionId (C3)", () => {
  it("latches the engine's sessionId once it appears (it is undefined until the first turn's init frame), so thread/read stops answering an empty page", async () => {
    const frames = [{ type: "user", uuid: "u-p", message: { content: "hi" } }];
    const cbs = new Set<(m: unknown) => void>();
    const late: any = {
      sessionId: undefined, // exactly like the real getter before the init frame lands
      submit: async () => {
        // the real read loop fires frame callbacks BEFORE recording the id, so the id is visible from the
        // frame that follows init — model that with one silent frame, then a second one
        for (const cb of [...cbs]) cb({ type: "system", subtype: "init", session_id: "sess-late" });
        late.sessionId = "sess-late";
        for (const cb of [...cbs]) cb({ type: "assistant", message: { id: "m1", content: [] } });
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: (cb: (m: unknown) => void) => { cbs.add(cb); return () => cbs.delete(cb); },
    };
    let seenSessionId: string | undefined;
    const srv = new AppServer({}, { listSessions: async () => [], sessionFactory: () => late, getSessionMessages: async (sid: string) => { seenSessionId = sid; return frames; } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
    expect(parsed(s.lines).find((f) => f.id === 2).result.thread.sessionId).toBeUndefined(); // not known yet — honest

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    // pre-fix: record.sessionId stayed undefined forever -> thread/read's early return, empty page
    send(c, { id: 4, method: "thread/read", params: { threadId } });
    await tick();
    const read = parsed(s.lines).find((f) => f.id === 4).result;
    expect(seenSessionId).toBe("sess-late");
    expect(read.data.map((i: any) => i.id)).toEqual(["u-p"]);

    // ...and thread/list now reports an id a client can hand to thread/resume
    send(c, { id: 5, method: "thread/list", params: {} });
    expect((await waitReply(s.lines, 5)).result.data[0].sessionId).toBe("sess-late");
  });

  it("latches the id even when system/init is the LAST frame of the turn", async () => {
    // The getter-only latch needed a SECOND frame to fire, because the read loop invokes frame callbacks
    // before it records the id. A first turn whose iterator ends right after init therefore never fired the
    // callback again and the record's sessionId stayed undefined FOREVER — thread/read answered an empty
    // page and nothing could ever resume the session, even though the engine itself knew the id all along.
    const cbs = new Set<(m: unknown) => void>();
    const frames = [{ type: "user", uuid: "u-p", message: { content: "hi" } }];
    const initOnly: any = {
      sessionId: undefined,
      submit: async () => {
        for (const cb of [...cbs]) cb({ type: "system", subtype: "init", session_id: "sess-initlast" });
        initOnly.sessionId = "sess-initlast"; // the real read loop records it AFTER the callbacks, then ends
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: (cb: (m: unknown) => void) => { cbs.add(cb); return () => cbs.delete(cb); },
    };
    let seenSessionId: string | undefined;
    const srv = new AppServer({}, { listSessions: async () => [], sessionFactory: () => initOnly, getSessionMessages: async (sid: string) => { seenSessionId = sid; return frames; } });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick(); await tick();

    send(c, { id: 4, method: "thread/read", params: { threadId } });
    await tick();
    expect(seenSessionId).toBe("sess-initlast");                                    // pre-fix: undefined
    expect(parsed(s.lines).find((f) => f.id === 4).result.data.map((i: any) => i.id)).toEqual(["u-p"]);
    send(c, { id: 5, method: "thread/list", params: {} });
    expect((await waitReply(s.lines, 5)).result.data[0].sessionId).toBe("sess-initlast");
  });
});

describe("appserver broadcast fan-out (M2)", () => {
  it("one throwing sink does not abort the fan-out to the remaining subscribers, nor wedge the thread's chain", async () => {
    const sessionFactory = () => ({
      submit: async (_p: string, onMessage: (m: unknown) => void) => { onMessage({ type: "assistant", message: { id: "msg1", content: [{ type: "text", text: "hi" }] } }); return { result: {} }; },
      interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
    });
    const srv = new AppServer({}, { sessionFactory });
    let boom = false;
    const badLines: string[] = [];
    const badSink: PeerSink = { write: (l) => { if (boom) throw new Error("sink boom"); badLines.push(l); }, buffered: () => 0, end: () => {} };
    const connBad = srv.connect(badSink);
    const good = mkSink(); const connGood = srv.connect(good.sink);
    init(connBad, 1, "bad"); init(connGood, 1, "good");
    send(connBad, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(badLines).find((f) => f.id === 2).result.thread.id;
    // the bad peer subscribes FIRST — an unguarded fan-out aborts on it before the good peer is reached
    send(connBad, { id: 3, method: "thread/subscribe", params: { threadId } });
    send(connGood, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    good.lines.length = 0;
    boom = true;

    send(connGood, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    const methods = parsed(good.lines).filter((f) => !("id" in f)).map((f) => f.method);
    expect(methods).toContain("turn/started");
    expect(methods).toContain("item/started");
    expect(methods).toContain("turn/completed");

    // the throw must not have escaped into record.chain (pre-fix it did, from turnStart's statusChanged,
    // outside the try that wraps only submit) — a later thread-scoped request still replies
    send(connGood, { id: 5, method: "thread/close", params: { threadId } });
    await tick(); await tick();
    expect(parsed(good.lines).find((f) => f.id === 5)?.result).toEqual({ ok: true });
  });
});
