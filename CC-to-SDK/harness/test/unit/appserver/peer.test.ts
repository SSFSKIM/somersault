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
  it("overflow is idempotent: only the first send() over the cap fires onOverflow/end, later sends short-circuit", () => {
    let overflows = 0; let ends = 0; let bufferedCalls = 0;
    const s = arraySink();
    const sink: PeerSink = { ...s.sink, buffered: () => { bufferedCalls++; return 64 * 1024 * 1024; }, end: () => void ends++ };
    const p = new Peer(sink, { onOverflow: () => void overflows++ });
    p.notify("a", {}); p.notify("b", {}); p.notify("c", {});
    expect(overflows).toBe(1); expect(ends).toBe(1); expect(bufferedCalls).toBe(1); expect(s.lines).toHaveLength(0);
  });
  it("outbound boundary: exactly maxBuffered still writes, one byte over overflows", () => {
    const s1 = arraySink(); const p1 = new Peer({ ...s1.sink, buffered: () => 100 }, { maxBuffered: 100 });
    p1.notify("ok", {});
    expect(s1.lines).toHaveLength(1);
    let over = false; const s2 = arraySink();
    const p2 = new Peer({ ...s2.sink, buffered: () => 101 }, { maxBuffered: 100, onOverflow: () => void (over = true) });
    p2.notify("over", {});
    expect(over).toBe(true); expect(s2.lines).toHaveLength(0);
  });
  it("inbound overflow: an oversized completed line surfaces one parseError, then parses the next valid line", () => {
    const s = arraySink(); const p = new Peer(s.sink, { maxIncomingFrame: 16 }); const seen: unknown[] = [];
    p.feed('{"method":"toolong"}\n{"method":"ok"}\n', (v) => seen.push(v));
    expect(seen).toEqual([{ __parseError: true }, { method: "ok" }]);
  });
  it("inbound cap counts BYTES, not UTF-16 code units: a multi-byte line under the .length cap still overflows", () => {
    // `String.length` counts one CJK character as 1 while the wire spends 3, so a frame of ~240k CJK
    // characters is ~720 KiB on the socket and sailed through a 256 KiB `.length` cap untouched. Scaled
    // down here: 21 code units, 37 bytes, against a 32-byte cap.
    const line = `{"method":"${"가".repeat(8)}"}`;
    expect(line.length).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(line, "utf8")).toBeGreaterThan(32);
    const s = arraySink(); const p = new Peer(s.sink, { maxIncomingFrame: 32 }); const seen: unknown[] = [];
    p.feed(line + '\n{"method":"ok"}\n', (v) => seen.push(v));
    expect(seen).toEqual([{ __parseError: true }, { method: "ok" }]);
  });
  it("the unterminated-buffer cap counts bytes too", () => {
    const s = arraySink(); const p = new Peer(s.sink, { maxIncomingFrame: 32 }); const seen: unknown[] = [];
    const partial = `{"method":"${"가".repeat(9)}`; // 20 code units, 38 bytes, no newline yet
    expect(partial.length).toBeLessThanOrEqual(32);
    p.feed(partial, (v) => seen.push(v));
    expect(seen).toEqual([{ __parseError: true }]);
  });
  it("inbound overflow: an unterminated buffer growing past the cap clears the buffer with exactly one parseError", () => {
    const s = arraySink(); const p = new Peer(s.sink, { maxIncomingFrame: 16 }); const seen: unknown[] = [];
    p.feed('{"method":"stillgoing', (v) => seen.push(v));
    expect(seen).toEqual([{ __parseError: true }]);
  });
});
