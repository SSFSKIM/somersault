import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const fakeSession = (overrides: Record<string, unknown> = {}) => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1", ...overrides });
const boot = (token?: string) => { const s = mkSink(); const srv = new AppServer({ token }, { sessionFactory: () => fakeSession() }); const c = srv.connect(s.sink); return { ...s, srv, c }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const req = (id: number, method: string, params: object) => ({ id, method, params });
/** An already-initialized connection plus its captured NDJSON frames. `feed` accepts a plain
 *  request/notification object (built by `req`), not a raw string — it stringifies for the caller. */
function connect(srv: AppServer) {
  const s = mkSink();
  const c = srv.connect(s.sink);
  send(c, { id: 0, method: "initialize", params: { clientInfo: { name: "t" } } });
  const peer = { lines: s.lines };
  const feed = (obj: object) => send(c, obj);
  return { peer, feed };
}
async function replyFor(peer: { lines: string[] }, id: number) {
  await tick();
  const f = parsed(peer.lines).find((x) => x.id === id);
  if (!f) throw new Error(`no reply for id ${id}`);
  return f;
}
function threadIdOf(peer: { lines: string[] }, id: number): string {
  return parsed(peer.lines).find((f) => f.id === id).result.thread.id;
}
describe("AppServer dispatch", () => {
  it("gates on initialize; token mismatch is -33003", () => {
    const { lines, c } = boot("secret");
    send(c, { id: 1, method: "thread/start", params: {} });
    expect(parsed(lines)[0].error.code).toBe(-33003);
    send(c, { id: 2, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer wrong" } });
    expect(parsed(lines)[1].error.code).toBe(-33003);
    send(c, { id: 3, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer secret" } });
    expect(parsed(lines)[2].result.userAgent).toBe("cc-harness-appserver");
  });
  it("rejects a request before initialize with invalid-request when no token is configured", () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "thread/start", params: {} });
    expect(parsed(lines)[0].error.code).toBe(-32600);
  });
  it("second initialize is invalid-request", () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "initialize", params: { clientInfo: { name: "t" } } });
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(-32600);
  });
  it("thread/start mints thr_ id and lists it; thread/close disposes", async () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const started = parsed(lines).find((f) => f.id === 2);
    expect(started.result.thread.id).toMatch(/^thr_[0-9a-f]{12}$/);
    expect(started.result.thread.origin).toBe("inProcess");
    send(c, { id: 3, method: "thread/list", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(lines).find((f) => f.id === 3).result.data).toHaveLength(1);
  });
  it("thread/close disposes the session and removes it from the list", async () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(lines).find((f) => f.id === 2).result.thread.id;
    send(c, { id: 3, method: "thread/close", params: { threadId } });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    send(c, { id: 4, method: "thread/list", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(lines).find((f) => f.id === 4).result.data).toHaveLength(0);
  });
  it("unknown method and threadNotFound have distinct codes", async () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "nope/nope", params: {} });
    send(c, { id: 3, method: "thread/close", params: { threadId: "thr_missing000" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(-32601);
    expect(parsed(lines).find((f) => f.id === 3).error.code).toBe(-33004);
  });
  it("bad params on a gated method yields INVALID_PARAMS", () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/close", params: { threadId: 5 } });
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(-32602);
  });
  it("resolves a control-plane decision: unparsable and malformed frames get id:null errors, connection stays open", () => {
    const { lines, c } = boot();
    c.feed("not json at all\n");
    c.feed(JSON.stringify({ foo: "bar" }) + "\n"); // well-formed JSON, but not a valid request/notification/response shape
    const p = parsed(lines);
    expect(p[0]).toEqual({ id: null, error: { code: -32700, message: expect.any(String) } });
    expect(p[1]).toEqual({ id: null, error: { code: -32600, message: expect.any(String) } });
    // connection stays open: a subsequent well-formed request still gets dispatched
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    expect(parsed(lines)[2].id).toBe(1);
  });
  it("a client response frame and an unknown-method notification are ignored silently (no reply emitted)", () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    const before = lines.length;
    c.feed(JSON.stringify({ id: 99, result: { anything: true } }) + "\n");
    c.feed(JSON.stringify({ method: "some/unknown/notification", params: {} }) + "\n");
    expect(lines.length).toBe(before);
  });
  it("a handler that throws (real openSession, invalid config) replies ERR.INTERNAL and never surfaces as an unhandled rejection", async () => {
    const captured: unknown[] = [];
    const onRejection = (e: unknown) => captured.push(e);
    process.on("unhandledRejection", onRejection);
    try {
      const srv = new AppServer(); // no DI fake — exercises the real openSession -> validateHarnessConfig path
      const s = mkSink();
      const c = srv.connect(s.sink);
      send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
      send(c, { id: 2, method: "thread/start", params: { config: { effort: "bogus" } } });
      await new Promise((r) => setTimeout(r, 0));
      const started = parsed(s.lines).find((f) => f.id === 2);
      expect(started.error.code).toBe(ERR.INTERNAL);
      expect(started.error.message).toMatch(/effort/);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(captured).toEqual([]);
  });
  it("thread/close removes the record from the registry even when dispose() rejects (no leak on a failing close)", async () => {
    const s = mkSink();
    const failingSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => { throw new Error("dispose boom"); }, onFrame: () => () => {}, sessionId: "sess-2" });
    const srv = new AppServer({}, { sessionFactory: failingSession });
    const c = srv.connect(s.sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
    send(c, { id: 3, method: "thread/close", params: { threadId } });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(s.lines).find((f) => f.id === 3).error.code).toBe(ERR.INTERNAL);
    send(c, { id: 4, method: "thread/list", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(s.lines).find((f) => f.id === 4).result.data).toHaveLength(0);
  });
  it("a successful initialize replies THEN emits an `initialized` notification; a second initialize on the same conn emits none", () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "initialize", params: { clientInfo: { name: "t" } } });
    const p = parsed(lines);
    expect(p[0].id).toBe(1);
    expect(p[0].result.userAgent).toBe("cc-harness-appserver");
    expect(p[1].method).toBe("initialized");
    expect(p[1].params).toEqual({});
    expect(p[2].id).toBe(2);
    expect(p[2].error.code).toBe(-32600);
    expect(p.filter((f) => f.method === "initialized")).toHaveLength(1); // none from the rejected second initialize
  });
  it("an EMPTY configured token fails closed — it is auth-configured-with-no-secret, never 'no auth configured'", () => {
    // `if (this.opts.token)` read "" as falsy, so an empty --token-file silently disabled authentication:
    // initialize accepted a client sending no authorization at all, and the pre-initialize branch even
    // downgraded -33003 to -32600. Presence of the option, not its truthiness, is what turns auth on.
    const { lines, c } = boot("");
    send(c, { id: 1, method: "thread/start", params: {} });
    expect(parsed(lines)[0].error.code).toBe(-33003); // not -32600
    send(c, { id: 2, method: "initialize", params: { clientInfo: { name: "web" } } });
    expect(parsed(lines)[1].error.code).toBe(-33003);
    send(c, { id: 3, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer " } });
    expect(parsed(lines)[2].error.code).toBe(-33003); // a bare "Bearer " must not match the empty secret either
    expect(parsed(lines).some((f) => f.method === "initialized")).toBe(false);
  });
  it("a method named after an Object.prototype member is METHOD_NOT_FOUND, not a silent hang", async () => {
    // The handler table was a plain object literal, so `handlers["toString"]` answered with the INHERITED
    // Object.prototype function — truthy, so dispatch awaited it as a handler. It replies to nothing, so
    // the caller waited forever for a response that was never coming (`constructor`/`valueOf` likewise).
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    for (const [i, method] of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"].entries()) {
      send(c, { id: 10 + i, method, params: {} });
    }
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 5; i++) {
      const reply = parsed(lines).find((f) => f.id === 10 + i);
      expect(reply, `no reply at all for id ${10 + i}`).toBeTruthy();
      expect(reply.error.code).toBe(ERR.METHOD_NOT_FOUND);
    }
  });
  it("a rejected initialize (bad token) emits no `initialized` notification", () => {
    const { lines, c } = boot("secret");
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer wrong" } });
    expect(parsed(lines).some((f) => f.method === "initialized")).toBe(false);
  });
});

describe("M2 error codes", () => {
  it("thread/start during shutdown answers -33007 shuttingDown, not -32001", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const { peer, feed } = connect(srv); // the file's existing helper: init'd connection + captured frames
    void srv.shutdown();
    feed(req(1, "thread/start", {}));
    const err = await replyFor(peer, 1);
    expect(err.error.code).toBe(-33007);
  });

  it("a method call against a dead engine answers -33005 engineGone", async () => {
    const session = fakeSession();
    (session as any).isEnded = () => true; // engine died (read loop ended) — the lib's real signal
    const srv = new AppServer({}, { sessionFactory: () => session });
    const { peer, feed } = connect(srv);
    feed(req(1, "thread/start", {}));
    await replyFor(peer, 1);
    const threadId = threadIdOf(peer, 1);
    feed(req(2, "turn/start", { threadId, input: "hi" }));
    const err = await replyFor(peer, 2);
    expect(err.error.code).toBe(-33005);
  });

  it("shutdown() waits for a queued thread/close on the same record instead of racing it", async () => {
    // gap 7: shutdown used to bypass record.chain. Engine-faithful fake: dispose resolves on a
    // controllable promise, and counts calls — the race made dispose run twice concurrently.
    let release!: () => void;
    let disposeCalls = 0;
    const session = fakeSession({ dispose: async () => { disposeCalls++; await new Promise<void>((r) => { release = r; }); } });
    const srv = new AppServer({}, { sessionFactory: () => session });
    const { peer, feed } = connect(srv);
    feed(req(1, "thread/start", {}));
    await replyFor(peer, 1);
    const threadId = threadIdOf(peer, 1);
    feed(req(2, "thread/close", { threadId }));   // queues closeRecord on record.chain
    const done = srv.shutdown();                   // must chain AFTER the queued close, not race it
    await Promise.resolve();
    release();
    await done;
    expect(disposeCalls).toBe(1); // memoized-by-ordering, not by luck: the second closer awaited the first
  });
});
