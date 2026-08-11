// test/unit/appserver/tasks.test.ts — M2b Task 3: background tasks (task/list, task/stop,
// turn/background) driven through the full AppServer RPC surface, as mcp.test.ts/settings.test.ts do — so
// the un-chained read and the chain-scoped mutations are both proven against real dispatch. Copies those
// files' mkSink/send/parsed/init/tick helpers so this file reads standalone.
//
// Engine-faithful fakes (spec Testing, verbatim): the real Session keeps its background-task set as a
// LEVEL signal replaced wholesale by each `system/background_tasks_changed` frame, and its read loop runs
// the frame callbacks BEFORE it applies that replacement (src/session/session.ts's readLoop, ~:265-272) —
// the fake below does both in that order, so the router-integration case reads the real sequencing rather
// than a convenient one.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

interface Task { task_id: string; task_type: string; description: string }
type Calls = { stop: string[]; background: (string | undefined)[] };
function mkCalls(): Calls { return { stop: [], background: [] }; }

/** A bare-minimum fake engine session — the three task methods are the ONLY optional methods this fixture
 *  adds, mirroring mcp.test.ts's convention (a missing one genuinely means "this engine doesn't implement
 *  it"). `push` is the test's stand-in for the read loop delivering one frame. */
function fakeSession(calls: Calls, opts: { tasks?: Task[]; backgroundReceipt?: boolean; throwStop?: string } = {}) {
  const cbs = new Set<(m: unknown) => void>();
  let bgTasks: Task[] = opts.tasks ?? [];
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: (cb: (m: unknown) => void) => { cbs.add(cb); return () => { cbs.delete(cb); }; },
    sessionId: "sess-1",
    listBackgroundTasks: async () => bgTasks,
    stopTask: async (taskId: string) => { calls.stop.push(taskId); if (opts.throwStop) throw new Error(opts.throwStop); },
    backgroundAll: async (toolUseId?: string) => { calls.background.push(toolUseId); return opts.backgroundReceipt ?? true; },
    /** Read-loop order, verbatim: callbacks first, THEN the wholesale replace (session.ts:265-272). */
    push(frame: unknown) {
      for (const cb of [...cbs]) { try { cb(frame); } catch { /* one subscriber's failure is not another's */ } }
      const f = frame as { type?: string; subtype?: string; tasks?: Task[] };
      if (f?.type === "system" && f.subtype === "background_tasks_changed") bgTasks = f.tasks ?? []; // REPLACE, never merge
    },
  };
}

/** A bare engine — all three task methods are ABSENT, so it is what proves each handler's -32601 branch
 *  (an optional-call `?.()` would reply success for work no engine ever did). */
function bareSession() {
  return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" };
}

/** Boots a server + one thread and SUBSCRIBES the connection to it (mirrors mcp.test.ts's bootOneThread) —
 *  subscription is what makes `srv.broadcast` fan-out observable, so the router-integration assertion below
 *  reads the real subscriber path rather than an internal call. */
async function bootOneThread(sessionFactory: () => any) {
  let session: any;
  const srv = new AppServer({}, { sessionFactory: () => (session = sessionFactory()) });
  const a = mkSink(); const connA = srv.connect(a.sink);
  init(connA, 1, "A");
  send(connA, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
  send(connA, { id: 99, method: "thread/subscribe", params: { threadId } });
  await tick();
  a.lines.length = 0;
  return { srv, a, connA, threadId, session };
}

const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);

describe("appserver background tasks (M2b Task 3)", () => {
  it("task/list replies { data, nextCursor: null } from the engine's snapshot", async () => {
    const tasks: Task[] = [{ task_id: "t-1", task_type: "bash", description: "npm test" }];
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(mkCalls(), { tasks }));

    send(connA, { id: 3, method: "task/list", params: { threadId } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ data: tasks, nextCursor: null });
  });

  it("task/list on an idle thread with no background tasks replies an empty list, not an error", async () => {
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(mkCalls()));

    send(connA, { id: 3, method: "task/list", params: { threadId } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ data: [], nextCursor: null });
  });

  it("task/list for an unknown threadId answers THREAD_NOT_FOUND", async () => {
    const { a, connA } = await bootOneThread(() => fakeSession(mkCalls()));

    send(connA, { id: 3, method: "task/list", params: { threadId: "thr_nope" } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("task/stop passes the taskId to the engine and replies {ok:true}", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "task/stop", params: { threadId, taskId: "t-1" } });
    await tick();

    expect(calls.stop).toEqual(["t-1"]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
  });

  it("task/stop emits NO notification of its own — the engine's own stopped/changed frames are the only ones, and they ride the router", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "task/stop", params: { threadId, taskId: "t-1" } });
    await tick();

    expect(parsed(a.lines).filter((f) => f.method !== undefined)).toEqual([]);
  });

  it("task/stop rejects a missing taskId with INVALID_PARAMS rather than stopping something unnamed", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "task/stop", params: { threadId } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.INVALID_PARAMS);
    expect(calls.stop).toEqual([]);
  });

  it("turn/background with no toolUseId calls the engine with undefined (background them all) and replies the receipt", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "turn/background", params: { threadId } });
    await tick();

    expect(calls.background).toEqual([undefined]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ backgrounded: true });
  });

  it("turn/background passes an explicit toolUseId through unchanged", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "turn/background", params: { threadId, toolUseId: "toolu_42" } });
    await tick();

    expect(calls.background).toEqual(["toolu_42"]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ backgrounded: true });
  });

  it("turn/background relays a FALSE receipt as {backgrounded:false} — nothing was backgroundable, and that is not an error", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => fakeSession(calls, { backgroundReceipt: false }));

    send(connA, { id: 3, method: "turn/background", params: { threadId } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ backgrounded: false });
    expect(reply.error).toBeUndefined();
  });

  it("the two mutations are chain-scoped: a slow task/stop blocks a subsequent turn/background on the same thread until it settles", async () => {
    const calls = mkCalls();
    let releaseStop!: () => void;
    const session = Object.assign(fakeSession(calls), {
      stopTask: (taskId: string) => { calls.stop.push(taskId); return new Promise<void>((r) => { releaseStop = r; }); },
    });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "task/stop", params: { threadId, taskId: "t-1" } });
    send(connA, { id: 4, method: "turn/background", params: { threadId } });
    await tick();

    // the stop is still pending, so its chained background must not have run yet
    expect(calls.background).toEqual([]);
    expect(parsed(a.lines).find((f) => f.id === 3)).toBeUndefined();

    releaseStop();
    await tick();
    expect(calls.background).toEqual([undefined]);
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(parsed(a.lines).find((f) => f.id === 4).result).toEqual({ backgrounded: true });
  });

  it("task/list is UN-chained: a poll answers while a slow mutation still holds the chain", async () => {
    const calls = mkCalls();
    const tasks: Task[] = [{ task_id: "t-1", task_type: "bash", description: "npm test" }];
    const session = Object.assign(fakeSession(calls, { tasks }), {
      stopTask: (taskId: string) => { calls.stop.push(taskId); return new Promise<void>(() => {}); }, // never settles
    });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "task/stop", params: { threadId, taskId: "t-1" } });
    send(connA, { id: 4, method: "task/list", params: { threadId } });
    await tick();

    expect(parsed(a.lines).find((f) => f.id === 3)).toBeUndefined();      // still stuck in the chain
    expect(parsed(a.lines).find((f) => f.id === 4).result).toEqual({ data: tasks, nextCursor: null });
  });

  it("a dead engine (isEnded true) answers -33005 via the dispatch guard, proving it covers these new methods too", async () => {
    let ended = false;
    const session = Object.assign(fakeSession(mkCalls()), { isEnded: () => ended });
    const { a, connA, threadId } = await bootOneThread(() => session);
    ended = true;

    send(connA, { id: 3, method: "task/list", params: { threadId } });
    send(connA, { id: 4, method: "task/stop", params: { threadId, taskId: "t-1" } });
    send(connA, { id: 5, method: "turn/background", params: { threadId } });
    await tick();

    for (const id of [3, 4, 5]) expect(parsed(a.lines).find((f) => f.id === id).error.code).toBe(ERR.ENGINE_GONE);
  });
});

// An engine that does not implement a method must be told apart from one that did the work. `?.()` does
// neither: it replies success for work no engine ever did, and for a value-returning method a bare
// `undefined` — a result-less frame rpc.ts's own classify() scores "invalid", so the caller never settles.
describe("appserver background tasks — absent engine method answers -32601", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["task/list", {}],
    ["task/stop", { taskId: "t-1" }],
    ["turn/background", {}],
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

  it("no absent-method call reports false success: no {ok:true}, no {backgrounded}, no result-less frame", async () => {
    const { a, connA, threadId } = await bootOneThread(bareSession);

    let id = 3;
    for (const [method, extra] of cases) send(connA, { id: id++, method, params: { threadId, ...extra } });
    await tick();

    const replies = parsed(a.lines).filter((f) => f.id !== undefined);
    expect(replies).toHaveLength(cases.length);
    for (const r of replies) {
      expect(r.result).toBeUndefined();   // never {ok:true}/{backgrounded}, and never the bare `{"id":N}` classify() rejects
      expect("error" in r).toBe(true);
    }
  });
});

// The mutations' bodies are DEFERRED into record.chain, so they run after dispatch's arrival-time -33005
// gate has already passed. An engine that dies in between throws, and scoring that -32603 blames the
// server's internals for a dead read loop the caller can see for itself — hence the catch's own isEnded()
// re-check (server.ts's dispatch catch does exactly the same).
describe("appserver background tasks — engine death inside a chain-deferred mutation", () => {
  /** A fake whose engine call throws AND kills the engine, so `isEnded()` is false at dispatch time (the
   *  arrival gate must let the handler run) and true by the time the catch reads it. */
  function dyingSession(calls: Calls) {
    let ended = false;
    return Object.assign(fakeSession(calls), {
      isEnded: () => ended,
      stopTask: async (taskId: string) => { calls.stop.push(taskId); ended = true; throw new Error("Session is not running"); },
      backgroundAll: async (toolUseId?: string) => { calls.background.push(toolUseId); ended = true; throw new Error("Session is not running"); },
    });
  }

  it("task/stop on an engine that died mid-op answers -33005, not -32603", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => dyingSession(calls));

    send(connA, { id: 3, method: "task/stop", params: { threadId, taskId: "t-1" } });
    await tick();

    expect(calls.stop).toEqual(["t-1"]);
    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.ENGINE_GONE);
  });

  it("turn/background on an engine that died mid-op answers -33005, not -32603", async () => {
    const calls = mkCalls();
    const { a, connA, threadId } = await bootOneThread(() => dyingSession(calls));

    send(connA, { id: 3, method: "turn/background", params: { threadId } });
    await tick();

    expect(calls.background).toEqual([undefined]);
    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.ENGINE_GONE);
  });

  it("a throwing engine that is still ALIVE keeps the -32603 mapping — the re-check narrows the class, it does not replace it", async () => {
    const calls = mkCalls();
    const session = Object.assign(fakeSession(calls, { throwStop: "no such task" }), { isEnded: () => false });
    const { a, connA, threadId } = await bootOneThread(() => session);

    send(connA, { id: 3, method: "task/stop", params: { threadId, taskId: "t-nope" } });
    await tick();

    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error.code).toBe(ERR.INTERNAL);
    expect(reply.error.message).toBe("no such task");
  });
});

// The notification half of this cluster already shipped with M2a's frame router (router.ts's
// routeBackgroundTasks / routeTaskNotification). This is the one integration-style case that proves it:
// the REAL router, installed by the real thread/start, over this task's own engine fake — so the cluster is
// complete with no notification code in tasks.ts at all.
describe("appserver background tasks — the M2a router completes the cluster (no new notification code)", () => {
  it("a system/background_tasks_changed frame reaches subscribers as task/changed, and task/list then reports the same set", async () => {
    const tasks: Task[] = [{ task_id: "t-9", task_type: "bash", description: "pytest -q" }];
    const { a, connA, threadId, session } = await bootOneThread(() => fakeSession(mkCalls()));

    session.push({ type: "system", subtype: "background_tasks_changed", tasks });
    await tick();

    expect(notifs(a.lines, "task/changed").map((f) => f.params)).toEqual([{ threadId, tasks }]);

    send(connA, { id: 3, method: "task/list", params: { threadId } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ data: tasks, nextCursor: null });
  });

  it("the engine's own task_notification{stopped} after a task/stop reaches subscribers as task/event", async () => {
    const calls = mkCalls();
    const { a, connA, threadId, session } = await bootOneThread(() => fakeSession(calls));

    send(connA, { id: 3, method: "task/stop", params: { threadId, taskId: "t-9" } });
    await tick();
    const frame = { type: "system", subtype: "task_notification", task_id: "t-9", status: "stopped" };
    session.push(frame);
    session.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await tick();

    expect(calls.stop).toEqual(["t-9"]);
    expect(notifs(a.lines, "task/event").map((f) => f.params)).toEqual([{ threadId, event: frame }]);
    expect(notifs(a.lines, "task/changed").map((f) => f.params)).toEqual([{ threadId, tasks: [] }]);
  });
});
