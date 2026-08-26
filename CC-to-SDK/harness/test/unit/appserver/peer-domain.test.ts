// test/unit/appserver/peer-domain.test.ts — the two outbound methods through the REAL AppServer RPC
// surface (the house pattern: mkSink/send/parsed/init, as in settings.test.ts), with the gateway and the
// roster injected so nothing here touches a real socket or a real home directory.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { PeerRow } from "../../../src/peer/roster.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

const ROW = (over: Partial<PeerRow> = {}): PeerRow => ({ address: "uds:/sock/11.sock", pid: 11, sessionId: "s-1", name: "peer-one", alive: true, inboxBound: true, ...over });

/** A gateway stand-in: same shape, records what was written, never opens a socket. */
function fakeGateway(socketPath = "/sock/99.sock") {
  const sent: Array<{ socketPath: string; frames: unknown[] }> = [];
  return {
    sent,
    gw: {
      socketPath,
      address: `uds:${socketPath}`,
      configRoot: "/cfg",
      sendFrames: async (p: string, frames: unknown[]) => { sent.push({ socketPath: p, frames }); return "CLOSED" as const; },
      close: async () => {},
    } as any,
  };
}

function boot(rows: PeerRow[], gwPath = "/sock/99.sock") {
  const { gw, sent } = fakeGateway(gwPath);
  const srv = new AppServer({}, {
    sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" }) as any,
    listSessions: async () => [],
    peerGateway: gw,
    readPeerRows: async () => rows,
    peerEnv: { CLAUDE_CONFIG_DIR: "/cfg" } as NodeJS.ProcessEnv,
  } as any);
  const a = mkSink(); const conn = srv.connect(a.sink);
  init(conn, 1);
  return { srv, a, conn, sent };
}

describe("peer/list", () => {
  it("projects rows and marks status reachability by namespace", async () => {
    const { a, conn } = boot([ROW(), ROW({ address: "uds:/other/12.sock", pid: 12 })]);
    send(conn, { id: 2, method: "peer/list", params: {} });
    await tick();
    const peers = parsed(a.lines).find((f) => f.id === 2).result.peers;
    expect(peers.find((p: any) => p.pid === 11).statusReachable).toBe(true);
    expect(peers.find((p: any) => p.pid === 12).statusReachable).toBe(false);
  });

  it("lists dead rows by default and drops them under aliveOnly", async () => {
    const rows = [ROW(), ROW({ pid: 12, address: "uds:/sock/12.sock", alive: false })];
    const { a, conn } = boot(rows);
    send(conn, { id: 2, method: "peer/list", params: {} });
    send(conn, { id: 3, method: "peer/list", params: { aliveOnly: true } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 2).result.peers).toHaveLength(2);
    expect(parsed(a.lines).find((f) => f.id === 3).result.peers).toHaveLength(1);
  });

  it("marks the rows this server hosts with their threadId", async () => {
    const { srv, a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    srv.registry.get(threadId)!.sessionId = "s-1";
    send(conn, { id: 3, method: "peer/list", params: {} });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).result.peers[0].threadId).toBe(threadId);
  });
});

describe("peer/send", () => {
  it("resolves a target, writes an enveloped frame, and reports written-not-delivered", async () => {
    const { a, conn, sent } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hello there" } });
    await tick();
    const res = parsed(a.lines).find((f) => f.id === 2).result;
    expect(res.delivered).toBe(false);
    expect(res.statusReachable).toBe(true);
    expect(res.msgId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sent[0].socketPath).toBe("/sock/11.sock");
    const user = sent[0].frames.find((f: any) => f.type === "user") as any;
    expect(user.priority).toBe("next");
    expect(user.msg_id).toBe(res.msgId);
    expect(user.message.content).toContain('from-mode="prompting"');
    expect(user.message.content).not.toContain("hop-chain");
  });

  it("passes the requested priority through", async () => {
    const { conn, sent } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hi", priority: "later" } });
    await tick();
    expect((sent[0].frames.find((f: any) => f.type === "user") as any).priority).toBe("later");
  });

  it("asserts prompting even when attributed to a bypassPermissions thread", async () => {
    const { srv, a, conn, sent } = boot([ROW()]);
    send(conn, { id: 2, method: "thread/start", params: { config: { permissionMode: "bypassPermissions" } } });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    const rec = srv.registry.get(threadId)!;
    rec.sessionId = "mine-1"; rec.title = "my thread";
    send(conn, { id: 3, method: "peer/send", params: { target: "s-1", message: "hi", fromThreadId: threadId } });
    await tick();
    const content = (sent[0].frames.find((f: any) => f.type === "user") as any).message.content as string;
    expect(content).toContain('from-mode="prompting"');
    expect(content).toContain('from-session="mine-1"');
    expect(content).not.toContain("bypass");
  });

  it("refuses an ambiguous target and names the matches", async () => {
    const { a, conn } = boot([ROW({ name: "dup", pid: 11 }), ROW({ name: "dup", pid: 12, address: "uds:/sock/12.sock" })]);
    send(conn, { id: 2, method: "peer/send", params: { target: "dup", message: "hi" } });
    await tick();
    const err = parsed(a.lines).find((f) => f.id === 2).error;
    expect(err.code).toBe(ERR.INVALID_PARAMS);
    expect(err.message).toContain("uds:/sock/11.sock");
    expect(err.message).toContain("uds:/sock/12.sock");
  });

  it("refuses an unresolvable target and a bridge: address by name", async () => {
    const { a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "nobody", message: "hi" } });
    send(conn, { id: 3, method: "peer/send", params: { target: "bridge:x", message: "hi" } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 2).error.code).toBe(ERR.INVALID_PARAMS);
    expect(parsed(a.lines).find((f) => f.id === 3).error.message).toContain("bridge:");
  });

  it("refuses an over-cap message, naming the size and the limit", async () => {
    const { a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "x".repeat(70_000) } });
    await tick();
    const err = parsed(a.lines).find((f) => f.id === 2).error;
    expect(err.code).toBe(ERR.INVALID_PARAMS);
    expect(err.message).toMatch(/60000/);
  });

  it("refuses a control character in an attributed thread name rather than downgrading the envelope", async () => {
    const { srv, a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    srv.registry.get(threadId)!.title = "bad\nname";
    send(conn, { id: 3, method: "peer/send", params: { target: "s-1", message: "hi", fromThreadId: threadId } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.INVALID_PARAMS);
  });

  it("answers -33008 when no gateway is bound", async () => {
    const srv = new AppServer({}, { listSessions: async () => [], peerGateway: null, readPeerRows: async () => [ROW()] } as any);
    const a = mkSink(); const conn = srv.connect(a.sink);
    init(conn, 1);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hi" } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 2).error.code).toBe(ERR.ATTACH_FAILED);
  });

  it("routes a later receipt to the sending connection and drops it once that connection is gone", async () => {
    const { srv, a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hi" } });
    await tick();
    const msgId = parsed(a.lines).find((f) => f.id === 2).result.msgId;
    srv.receipts.route({ orig_msg_id: msgId, status: "held", reason: "parity", from: "uds:/sock/11.sock" });
    const note = parsed(a.lines).find((f) => f.method === "peer/messageStatus");
    expect(note.params).toMatchObject({ msgId, status: "held", from: "uds:/sock/11.sock" });
    // A second send whose connection then closes must not throw when its receipt arrives.
    send(conn, { id: 3, method: "peer/send", params: { target: "s-1", message: "hi again" } });
    await tick();
    const msgId2 = parsed(a.lines).find((f) => f.id === 3).result.msgId;
    conn.close();
    expect(() => srv.receipts.route({ orig_msg_id: msgId2, status: "expired", from: "uds:/sock/11.sock" })).not.toThrow();
  });
});
