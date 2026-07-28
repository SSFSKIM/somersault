// test/unit/appserver/decisions.test.ts — Task 7: decisions as state end-to-end. Copies Task 6's
// mkSink/boot/send/parsed helpers (test/unit/appserver/server.test.ts) so this file reads standalone.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" });
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const init = (c: { feed(ch: string): void }, id: number, name: string) => {
  send(c, { id, method: "initialize", params: { clientInfo: { name } } });
};

describe("appserver decisions (Task 7)", () => {
  it("park -> decision/requested -> respond -> resolved; second answer told who won", async () => {
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connA, 1, "A");
    init(connB, 1, "B");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    // Task 9 tightened decision fan-out to real per-thread subscribers (was: every initialized conn) —
    // both watchers must subscribe before the park to see decision/requested and decision/resolved.
    send(connA, { id: 90, method: "thread/subscribe", params: { threadId } });
    send(connB, { id: 90, method: "thread/subscribe", params: { threadId } });
    await new Promise((r) => setTimeout(r, 0));
    a.lines.length = 0; b.lines.length = 0; // discard subscribe replies/idle replay noise

    const decision = broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_d", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));

    const reqA = parsed(a.lines).find((f) => f.method === "decision/requested");
    const reqB = parsed(b.lines).find((f) => f.method === "decision/requested");
    expect(reqA).toBeTruthy();
    expect(reqB).toBeTruthy();
    expect(reqA.params.threadId).toBe(threadId);
    expect(reqA.params.decision.kind).toBe("permission");
    expect(reqA.params.decision.toolUseID).toBe("toolu_d");

    send(connB, { id: 9, method: "decision/respond", params: { threadId, toolUseId: "toolu_d", answer: { kind: "allow_once" } } });
    await new Promise((r) => setTimeout(r, 0));
    const respondReply = parsed(b.lines).find((f) => f.id === 9);
    expect(respondReply.result).toEqual({ ok: true });

    const outcome = await decision;
    expect(outcome).toEqual({ kind: "allow_once" });

    const resA = parsed(a.lines).find((f) => f.method === "decision/resolved");
    const resB = parsed(b.lines).find((f) => f.method === "decision/resolved");
    expect(resA.params).toEqual({ threadId, toolUseId: "toolu_d", by: expect.stringMatching(/^B#\d+$/), answer: { kind: "allow_once" } });
    expect(resB.params).toEqual(resA.params);
    const winner = resA.params.by;

    send(connA, { id: 10, method: "decision/respond", params: { threadId, toolUseId: "toolu_d", answer: { kind: "allow_once" } } });
    await new Promise((r) => setTimeout(r, 0));
    const secondReply = parsed(a.lines).find((f) => f.id === 10);
    expect(secondReply.error.code).toBe(ERR.ALREADY_SETTLED);
    expect(secondReply.error.data.by).toBe(winner);
  });

  it("kind mismatch is invalid params", async () => {
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    broker.request({ toolName: "Bash", input: {}, toolUseID: "toolu_m", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));

    send(connA, { id: 3, method: "decision/respond", params: { threadId, toolUseId: "toolu_m", answer: { kind: "plan_approve", acceptEdits: true } } });
    await new Promise((r) => setTimeout(r, 0));
    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error.code).toBe(ERR.INVALID_PARAMS);
  });

  it("unattended:'deny' with zero watchers denies immediately", async () => {
    // hasWatchers = record.subscribers.size > 0 (Task 9): connA never subscribes to this thread, so it
    // is not a watcher even while still connected. Closing it too is just belt-and-suspenders for the
    // "fully detached" scenario this test documents.
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: { unattended: "deny" } });
    await new Promise((r) => setTimeout(r, 0));

    connA.close();
    a.lines.length = 0; // clear the reply/init noise; only care about what happens on request()
    const outcome = await broker.request({ toolName: "Bash", input: {}, toolUseID: "toolu_z", signal: new AbortController().signal });
    expect(outcome).toEqual({ kind: "deny" });
    expect(parsed(a.lines).some((f) => f.method === "decision/requested")).toBe(false);
  });

  it("decision/list returns the parked entries for the requested thread; unknown threadId is -33004", async () => {
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    broker.request({ toolName: "Bash", input: {}, toolUseID: "toolu_p", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));

    send(connA, { id: 3, method: "decision/list", params: { threadId } });
    await new Promise((r) => setTimeout(r, 0));
    const listed = parsed(a.lines).find((f) => f.id === 3);
    expect(listed.result.data).toHaveLength(1);
    expect(listed.result.data[0].toolUseID).toBe("toolu_p");

    send(connA, { id: 4, method: "decision/list", params: { threadId: "thr_unknown0000" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(a.lines).find((f) => f.id === 4).error.code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("decision/respond deny+abortTurn interrupts only that thread's session, not a second thread's", async () => {
    const sessions: any[] = [];
    const makeFake = () => {
      const s: any = { submit: async () => ({ result: {} }), dispose: async () => {}, onFrame: () => () => {}, sessionId: `sess-${sessions.length}` };
      s.interrupt = async () => { s.interrupted = (s.interrupted ?? 0) + 1; return {}; };
      sessions.push(s);
      return s;
    };
    const brokers: any[] = [];
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { brokers.push(cfg.permissionBroker); return makeFake(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    send(connA, { id: 3, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const t1 = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    const t2 = parsed(a.lines).find((f) => f.id === 3).result.thread.id;
    const [session1, session2] = sessions;
    const [broker1, broker2] = brokers;

    broker1.request({ toolName: "Bash", input: {}, toolUseID: "toolu_1", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));
    send(connA, { id: 4, method: "decision/respond", params: { threadId: t1, toolUseId: "toolu_1", answer: { kind: "deny" }, abortTurn: true } });
    await new Promise((r) => setTimeout(r, 0));
    expect(session1.interrupted).toBe(1);
    expect(session2.interrupted).toBeUndefined();

    broker2.request({ toolName: "Bash", input: {}, toolUseID: "toolu_2", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));
    send(connA, { id: 5, method: "decision/respond", params: { threadId: t2, toolUseId: "toolu_2", answer: { kind: "allow_once" }, abortTurn: true } });
    await new Promise((r) => setTimeout(r, 0));
    expect(session2.interrupted).toBeUndefined(); // non-deny answer with abortTurn:true does NOT interrupt
  });

  it("thread/start with an invalid config against the real session factory leaves zero registry threads and zero decision entries (Finding 1 regression)", async () => {
    const srv = new AppServer(); // no DI — exercises the real openSession -> validateHarnessConfig throw path
    const s = mkSink(); const c = srv.connect(s.sink);
    const originalMint = srv.registry.mint.bind(srv.registry);
    let mintedId: string | undefined;
    (srv.registry as any).mint = () => { mintedId = originalMint(); return mintedId; };
    init(c, 1, "t");
    send(c, { id: 2, method: "thread/start", params: { config: { effort: "bogus" } } });
    await new Promise((r) => setTimeout(r, 0));
    const started = parsed(s.lines).find((f) => f.id === 2);
    expect(started.error.code).toBe(ERR.INTERNAL);
    expect(mintedId).toBeTruthy();

    send(c, { id: 3, method: "thread/list", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(s.lines).find((f) => f.id === 3).result.data).toHaveLength(0); // registry: no orphan record

    send(c, { id: 4, method: "decision/list", params: { threadId: mintedId } });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(s.lines).find((f) => f.id === 4).error.code).toBe(ERR.THREAD_NOT_FOUND); // decisions map: no orphan entry for the minted id
  });
});
