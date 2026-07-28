import { describe, it, expect } from "vitest";
import { Peer, type PeerSink } from "../../../src/appserver/peer.js";
const arraySink = () => { const lines: string[] = []; let ended = false; const sink: PeerSink = { write: (l) => void lines.push(l), buffered: () => 0, end: () => void (ended = true) }; return { lines, sink, ended: () => ended }; };
describe("Peer", () => {
  it("notify stamps emittedAtMs; reply echoes id", () => {
    const s = arraySink(); const p = new Peer(s.sink);
    p.notify("thread/status/changed", { threadId: "t" }); p.reply(7, { ok: true });
    const n = JSON.parse(s.lines[0]); expect(n.method).toBe("thread/status/changed"); expect(typeof n.emittedAtMs).toBe("number");
    expect(JSON.parse(s.lines[1])).toEqual({ id: 7, result: { ok: true } });
  });
  it("feed splits lines across chunks", () => {
    const s = arraySink(); const p = new Peer(s.sink); const seen: unknown[] = [];
    p.feed('{"id":1,"me', (v) => seen.push(v)); p.feed('thod":"a"}\n{"method":"b"}\n', (v) => seen.push(v));
    expect(seen).toHaveLength(2);
  });
  it("overflow disconnects instead of buffering unboundedly", () => {
    let over = false; const s = arraySink();
    const p = new Peer({ ...s.sink, buffered: () => 64 * 1024 * 1024 }, { onOverflow: () => void (over = true) });
    p.notify("item/agentMessage/delta", { x: 1 });
    expect(over).toBe(true); expect(s.lines).toHaveLength(0);
  });
});
