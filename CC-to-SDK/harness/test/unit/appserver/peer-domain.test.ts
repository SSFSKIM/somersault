// test/unit/appserver/peer-domain.test.ts — the two outbound methods through the REAL AppServer RPC
// surface (the house pattern: mkSink/send/parsed/init, as in settings.test.ts), with the gateway and the
// roster injected so nothing here touches a real socket or a real home directory.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { PeerRow } from "../../../src/peer/roster.js";
import { buildEnvelope, MAX_FRAME_CHARS } from "../../../src/peer/address.js";

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

// THE DIFFERENTIAL MATRIX (spec criterion 8). The refusal is a TIGHTENING of `peer/send`, so the thing
// that has to be proven is not only that the new refusal fires but that nothing else moved: for every
// input there are exactly two admissible outcomes — the socket write is byte-identical to what the
// un-tightened code wrote, or nothing is written at all and INVALID_PARAMS comes back. Anything between
// (a write that differs by one byte, a refusal that still wrote, a silent acceptance of a truncating body)
// is the failure this table exists to catch. The expected bytes are derived from `buildEnvelope` itself
// rather than pasted, so a deliberate change to the envelope grammar updates both sides at once and only
// an ACCIDENTAL divergence between what we send and what the framer writes can red this.
const WRAP = buildEnvelope({ from: "uds:/sock/99.sock" });

const MATRIX: Array<{ name: string; message: string; verdict: "sent" | "refused"; why: string }> = [
  { name: "an ordinary body", message: "hello there", verdict: "sent", why: "the control: no envelope tag anywhere in it." },
  {
    name: "balanced same-grammar nesting", verdict: "sent",
    message: `quoting a peer:\n<cross-session-message from="uds:/x" from-mode="prompting">\ninner\n</cross-session-message>\nend`,
    why: "depth counting steps over a complete quoted envelope, which is the ordinary traffic the M8 scan found 52 rows of (code reviews of this very work among them) — refusing it would break more than the truncation ever did.",
  },
  {
    name: "balanced mixed-grammar nesting", verdict: "sent",
    message: `forwarding a subagent:\n<agent-message from="sub">\ninner\n</agent-message>\nend`,
    why: "the other grammar, complete: per-tag-name depth never lets it touch our wrapper.",
  },
  {
    name: "an unclosed <cross-session-message> opener", verdict: "refused",
    message: `before <cross-session-message from="uds:/x"> after`,
    why: "alone it decodes back intact (the decoder's last-closing-tag salvage), but BESIDE A SIBLING — the collapsed two-envelope frame probe 121 measured — that salvage swallows the neighbour's opener and both bodies come back merged. Refusing on the pair is what makes the oracle honest about the frames the receiver really builds.",
  },
  {
    name: "a bare unmatched </cross-session-message> closer", verdict: "refused",
    message: "before </cross-session-message> after",
    why: "the tracker's own case: our decoder reads this body as `before ` and drops the rest.",
  },
  {
    name: "an unbalanced <agent-message> opener alone", verdict: "sent",
    message: `before <agent-message from="sub"> after`,
    why: "CROSS-GRAMMAR IMMUNITY: depth is counted per tag name and the outermost open tag is ours, so a foreign grammar's tag — balanced or not — can neither open nor close our envelope. The foreign grammar is irrelevant to our wrapper, and refusing it would be a refusal with no defect behind it.",
  },
  {
    name: "an unbalanced </agent-message> closer alone", verdict: "sent",
    message: "before </agent-message> after",
    why: "the same immunity in the closing direction: a closer that never opened anything of our name is not our terminator.",
  },
  { name: "a body that begins and ends with newlines", message: "\n\nedges\n\n", verdict: "sent", why: "`buildEnvelope` adds one newline each side and the decoder strips exactly one — the caller's own blank lines survive." },
  { name: "a body at the size cap exactly", message: "x".repeat(MAX_FRAME_CHARS - WRAP("").length), verdict: "sent", why: "the cap is a `>` test, so the boundary body is still sent and must still be sent byte-for-byte." },
];

describe("peer/send round-trip refusal — the differential matrix", () => {
  for (const cell of MATRIX) {
    it(`${cell.verdict}: ${cell.name} — ${cell.why}`, async () => {
      const { a, conn, sent } = boot([ROW()]);
      send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: cell.message } });
      await tick();
      const frame = parsed(a.lines).find((f) => f.id === 2);
      if (cell.verdict === "refused") {
        expect(sent).toHaveLength(0);                                  // zero bytes: nothing between the two outcomes
        expect(frame.result).toBeUndefined();
        expect(frame.error.code).toBe(ERR.INVALID_PARAMS);
        expect(frame.error.message).toContain("unbalanced <cross-session-message> tag");
      } else {
        expect(frame.error).toBeUndefined();
        // Byte-identity, whole-frame: the ONLY value that may differ from a derivation is the msg_id, which
        // is a fresh UUID by design, so it is read back off the reply rather than asserted loosely.
        expect(sent).toEqual([{
          socketPath: "/sock/11.sock",
          frames: [{ type: "user", session_id: "s-1", from: "uds:/sock/99.sock", message: { content: WRAP(cell.message) }, priority: "next", msg_id: frame.result.msgId }],
        }]);
      }
    });
  }

  it("still answers the size error, not the round-trip one, for an over-cap body", async () => {
    const { a, conn, sent } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: `${"x".repeat(MAX_FRAME_CHARS)} </cross-session-message>` } });
    await tick();
    // Both refusals apply to this body. Size is answered first: it is the cheaper diagnosis and the one the
    // caller can act on without reading their own text, and it keeps the scan off an unbounded string.
    expect(sent).toHaveLength(0);
    expect(parsed(a.lines).find((f) => f.id === 2).error.message).toMatch(/60000/);
  });
});

// The gateway is the server's OWN reply address, so its lifetime is the server's — not a connection's and
// not a thread's: bound once before the listener accepts anything, torn down inside shutdown() while the
// connections still owed a receipt are there to be told the correlation is gone.
describe("gateway lifecycle", () => {
  it("closes the bound gateway on shutdown", async () => {
    let closed = false;
    const { gw } = fakeGateway();
    gw.close = async () => { closed = true; };
    const srv = new AppServer({}, { listSessions: async () => [], peerGateway: gw, readPeerRows: async () => [] } as any);
    await srv.shutdown();
    expect(closed).toBe(true);
  });

  it("sweeps the receipt map on shutdown rather than leaving a sender unanswered", async () => {
    const { srv, a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hi" } });
    await tick();
    const msgId = parsed(a.lines).find((f) => f.id === 2).result.msgId;
    expect(srv.receipts.size()).toBe(1);
    await srv.shutdown();
    expect(srv.receipts.size()).toBe(0);
    const note = parsed(a.lines).filter((f) => f.method === "peer/messageStatus").at(-1);
    expect(note.params).toMatchObject({ msgId, status: "dropped", reason: "correlation expired" });
  });

  it("leaves a deliberately absent gateway absent — `null` is an answer, not a gap to fill", async () => {
    const srv = new AppServer({}, { listSessions: async () => [], peerGateway: null, readPeerRows: async () => [] } as any);
    await srv.bindGateway();
    expect(srv.gateway()).toBeUndefined();
    expect(srv.deps.peerGateway).toBeNull();
  });
});
