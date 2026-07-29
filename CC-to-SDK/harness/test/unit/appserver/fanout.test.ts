// test/unit/appserver/fanout.test.ts — Task 5: server-scoped fan-out (watchThreads),
// optOutNotificationMethods, warning, thread/started. Copies server.test.ts's mkSink/send/parsed/req
// helpers so this file reads standalone.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { broadcastToWatchers } from "../../../src/appserver/fanout.js";
import type { Peer, PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const fakeSession = (overrides: Record<string, unknown> = {}) => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1", ...overrides });
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const req = (id: number, method: string, params: object) => ({ id, method, params });

/** A fresh connection plus its captured NDJSON frames — not yet initialized (mirrors server.test.ts's
 *  `connect`, but split from `init` so a test can pass initialize options). Exposes the real `Peer`
 *  instance (`realPeer`) so a test can drive AppServer.warn(peer, ...) directly, the way a handler would. */
function connect(srv: AppServer) {
  const s = mkSink();
  const c = srv.connect(s.sink);
  const peer = { lines: s.lines };
  const feed = (obj: object) => send(c, obj);
  return { peer, feed, close: c.close, realPeer: c.peer, get frames() { return parsed(s.lines); } };
}

async function init(conn: { feed(obj: object): void }, opts: Record<string, unknown> = {}) {
  conn.feed({ id: 0, method: "initialize", params: { clientInfo: { name: "t" }, ...opts } });
  await tick();
}

async function replyFor(peer: { lines: string[] }, id: number) {
  await tick();
  const f = parsed(peer.lines).find((x) => x.id === id);
  if (!f) throw new Error(`no reply for id ${id}`);
  return f;
}

describe("server-scoped fan-out (spec Wave 0)", () => {
  it("a watchThreads connection receives thread/started for a thread it never subscribed to", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const watcher = connect(srv);
    await init(watcher, { watchThreads: true });
    const starter = connect(srv);
    await init(starter, {});
    starter.feed(req(1, "thread/start", {}));
    await replyFor(starter.peer, 1);
    const started = watcher.frames.find((f) => f.method === "thread/started");
    expect(started, "watcher missed thread/started").toBeDefined();
    expect(started.params.thread.id).toMatch(/^thr_/);
  });

  it("a non-watching connection does NOT receive thread/started", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const nonWatcher = connect(srv);
    await init(nonWatcher, {}); // watchThreads omitted
    const starter = connect(srv);
    await init(starter, {});
    starter.feed(req(1, "thread/start", {}));
    await replyFor(starter.peer, 1);
    const started = nonWatcher.frames.find((f) => f.method === "thread/started");
    expect(started).toBeUndefined();
  });

  it("optOutNotificationMethods filters exactly the named methods", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const conn = connect(srv);
    await init(conn, { optOutNotificationMethods: ["thread/status/changed"] });
    conn.feed(req(1, "thread/start", {}));
    const started = await replyFor(conn.peer, 1);
    const threadId = started.result.thread.id;
    conn.feed(req(2, "thread/subscribe", { threadId }));
    await replyFor(conn.peer, 2);
    conn.feed(req(3, "turn/start", { threadId, input: "go" }));
    await replyFor(conn.peer, 3);
    const methods = conn.frames.filter((f: any) => !("id" in f)).map((f: any) => f.method);
    expect(methods).toContain("turn/started");
    expect(methods).not.toContain("thread/status/changed");
  });

  it("thread/closed reaches watchers as well as subscribers", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const watcher = connect(srv);
    await init(watcher, { watchThreads: true }); // NOT subscribed to the thread
    const starter = connect(srv);
    await init(starter, {});
    starter.feed(req(1, "thread/start", {}));
    const started = await replyFor(starter.peer, 1);
    const threadId = started.result.thread.id;
    starter.feed(req(2, "thread/close", { threadId }));
    await replyFor(starter.peer, 2);
    const closed = watcher.frames.filter((f) => f.method === "thread/closed");
    expect(closed).toHaveLength(1);
    expect(closed[0].params).toEqual({ threadId });
  });

  it("a connection that is both a watcher and a subscriber gets thread/closed exactly once (no double-delivery)", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const both = connect(srv);
    await init(both, { watchThreads: true });
    both.feed(req(1, "thread/start", {}));
    const started = await replyFor(both.peer, 1);
    const threadId = started.result.thread.id;
    both.feed(req(2, "thread/subscribe", { threadId }));
    await replyFor(both.peer, 2);
    both.feed(req(3, "thread/close", { threadId }));
    await replyFor(both.peer, 3);
    const closed = both.frames.filter((f) => f.method === "thread/closed");
    expect(closed).toHaveLength(1);
  });

  it("warning is a per-peer notification with {code, message}", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const a = connect(srv);
    await init(a, {});
    const b = connect(srv);
    await init(b, {});
    a.peer.lines.length = 0; // discard init/initialized noise
    b.peer.lines.length = 0;
    srv.warn(a.realPeer as Peer, "limitClamped", "clamped to 10");
    const aWarn = a.frames.filter((f) => f.method === "warning");
    expect(aWarn).toHaveLength(1);
    expect(aWarn[0].params).toEqual({ code: "limitClamped", message: "clamped to 10" });
    const bWarn = b.frames.filter((f) => f.method === "warning");
    expect(bWarn).toHaveLength(0);
  });

  it("a disconnecting watcher is removed from the watcher set and does not receive later thread/started", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const watcher = connect(srv);
    await init(watcher, { watchThreads: true });
    watcher.close();
    const starter = connect(srv);
    await init(starter, {});
    starter.feed(req(1, "thread/start", {}));
    await replyFor(starter.peer, 1); // must not throw even though the watcher's connection is closed
    const started = watcher.frames.find((f) => f.method === "thread/started");
    expect(started).toBeUndefined();
  });

  it("broadcastToWatchers guards one watcher's throwing notify so it doesn't block the rest", () => {
    const calls: string[] = [];
    const badPeer = { notify: () => { throw new Error("dead socket"); } } as unknown as Peer;
    const okPeer = { notify: (m: string) => calls.push(m) } as unknown as Peer;
    const conns = [
      { watchThreads: true, peer: badPeer },
      { watchThreads: true, peer: okPeer },
      { watchThreads: false, peer: okPeer }, // non-watcher: must not be notified either
    ] as any;
    expect(() => broadcastToWatchers(conns, "thread/started", {})).not.toThrow();
    expect(calls).toEqual(["thread/started"]); // exactly once — the failing peer didn't stop the second, the non-watcher was skipped
  });
});
