// appserver/peer.ts — per-connection framing. Outbound is PRESSURE-GATED (spec §11): a slow consumer is
// disconnected, never buffered unboundedly — replay-first subscribe makes reconnect cheap by design.
import { encode, type RequestId } from "./rpc.js";
export interface PeerSink { write(line: string): void; buffered(): number; end(): void }
// Exported so transports that sit below this framing layer (e.g. transport/ws.ts's `maxPayload`) can
// size their own guard off the SAME constant instead of re-deriving 256 KiB with a second literal that
// could drift from this one.
export const MAX_IN = 256 * 1024;   // client→server frame cap, in BYTES (mirrors host/server.ts MAX_FRAME)
const MAX_OUT = 32 * 1024 * 1024;   // server→client pressure cap (mirrors client/remote.ts rationale)
export class Peer {
  private buf = "";
  private dead = false;
  constructor(private sink: PeerSink, private opts: { maxIncomingFrame?: number; maxBuffered?: number; onOverflow?: () => void } = {}) {}
  private send(msg: object): void {
    if (this.dead) return;
    if (this.sink.buffered() > (this.opts.maxBuffered ?? MAX_OUT)) { this.dead = true; this.opts.onOverflow?.(); this.sink.end(); return; }
    this.sink.write(encode(msg));
  }
  reply(id: RequestId, result: unknown): void { this.send({ id, result }); }
  replyError(id: RequestId, code: number, message: string, data?: unknown): void { this.send({ id, error: { code, message, ...(data !== undefined ? { data } : {}) } }); }
  notify(method: string, params: Record<string, unknown>): void { this.send({ method, params, emittedAtMs: Date.now() }); }
  feed(chunk: string, onFrame: (v: unknown) => void): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      // BYTES, not UTF-16 code units: String.length counts a CJK character as 1 while the wire spends 3,
      // so a ~240k-character frame is ~720 KiB on the socket yet passed a 256 KiB `.length` cap untouched.
      if (Buffer.byteLength(line, "utf8") > (this.opts.maxIncomingFrame ?? MAX_IN)) { onFrame({ __parseError: true }); continue; }
      try { onFrame(JSON.parse(line)); } catch { onFrame({ __parseError: true }); }
    }
    if (Buffer.byteLength(this.buf, "utf8") > (this.opts.maxIncomingFrame ?? MAX_IN)) { this.buf = ""; onFrame({ __parseError: true }); }
  }
}
