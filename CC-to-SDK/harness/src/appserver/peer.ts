// appserver/peer.ts — per-connection framing. Outbound is PRESSURE-GATED (spec §11): a slow consumer is
// disconnected, never buffered unboundedly — replay-first subscribe makes reconnect cheap by design.
import { encode, type RequestId } from "./rpc.js";
export interface PeerSink { write(line: string): void; buffered(): number; end(): void }
const MAX_IN = 256 * 1024;          // client→server frame cap (mirrors host/server.ts MAX_FRAME)
const MAX_OUT = 32 * 1024 * 1024;   // server→client pressure cap (mirrors client/remote.ts rationale)
export class Peer {
  private buf = "";
  constructor(private sink: PeerSink, private opts: { maxIncomingFrame?: number; maxBuffered?: number; onOverflow?: () => void } = {}) {}
  private send(msg: object): void {
    if (this.sink.buffered() > (this.opts.maxBuffered ?? MAX_OUT)) { this.opts.onOverflow?.(); this.sink.end(); return; }
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
      if (line.length > (this.opts.maxIncomingFrame ?? MAX_IN)) { onFrame({ __parseError: true }); continue; }
      try { onFrame(JSON.parse(line)); } catch { onFrame({ __parseError: true }); }
    }
    if (this.buf.length > (this.opts.maxIncomingFrame ?? MAX_IN)) { this.buf = ""; onFrame({ __parseError: true }); }
  }
}
