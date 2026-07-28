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
const init = (c: { feed(ch: string): void }, lines: string[], id: number, name: string) => {
  send(c, { id, method: "initialize", params: { clientInfo: { name } } });
};

describe("appserver decisions (Task 7)", () => {
  it("park -> decision/requested -> respond -> resolved; second answer told who won", async () => {
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connA, a.lines, 1, "A");
    init(connB, b.lines, 1, "B");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

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
    expect(secondReply.error.code).toBe(-33002);
    expect(secondReply.error.data.by).toBe(winner);
  });

  it("kind mismatch is invalid params", async () => {
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, a.lines, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    broker.request({ toolName: "Bash", input: {}, toolUseID: "toolu_m", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));

    send(connA, { id: 3, method: "decision/respond", params: { threadId, toolUseId: "toolu_m", answer: { kind: "plan_approve", acceptEdits: true } } });
    await new Promise((r) => setTimeout(r, 0));
    const reply = parsed(a.lines).find((f) => f.id === 3);
    expect(reply.error.code).toBe(-32602);
  });

  it("unattended:'deny' with zero watchers denies immediately", async () => {
    // interim hasWatchers = "at least one initialized connection" (Task 9 tightens to real subscribers).
    // To exercise the zero-watchers path we simulate a full detach: close the only connection after
    // thread/start, then trigger the broker directly (as a live SDK canUseTool callback would).
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, a.lines, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: { unattended: "deny" } });
    await new Promise((r) => setTimeout(r, 0));

    connA.close();
    a.lines.length = 0; // clear the reply/init noise; only care about what happens on request()
    const outcome = await broker.request({ toolName: "Bash", input: {}, toolUseID: "toolu_z", signal: new AbortController().signal });
    expect(outcome).toEqual({ kind: "deny" });
    expect(parsed(a.lines).some((f) => f.method === "decision/requested")).toBe(false);
  });
});
