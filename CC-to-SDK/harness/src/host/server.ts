import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { hostOp } from "./ops.js";
import type { HostStatus } from "./ops.js";
import { decodeFrame, encodeEvent, encodeReply } from "./wire.js";
import type { HostEvent, HostFrame } from "./wire.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { PermissionDecision } from "../permissions/types.js";

export interface HostHandlers {
  status(): HostStatus;
  stop(): Promise<void>;
  pending(): PendingEntry[];
  answer(toolUseID: string, decision: PermissionDecision, by: string): { ok: boolean; alreadyAnsweredBy?: string; error?: string };
  prompt(text: string): Promise<void>;
  interrupt(): Promise<void>;
  /** Register ONE sink for ONE connection; the returned function unregisters it. The sink is what the
   *  server writes to that socket — fan-out lives in the host's follower set, never here. */
  follow(deliver: (ev: HostEvent) => void): () => void;
}

/** A frame with no newline in sight past this is a runaway peer, not an op. Same-user only (the socket
 *  sits under a 0o700 dir), but a detached host outlives its parent, so an unbounded buffer is not free. */
const MAX_FRAME = 256 * 1024;

/** One UDS listener per SESSION (not per fleet). NDJSON frames, one op per line; the connection stays
 *  open so A2 can add a long-lived `follow` stream over the same socket. */
export class HostServer {
  private server: Server;
  private closing = false;
  private open = new Set<Socket>();
  private closeResolve!: () => void;
  readonly closed: Promise<void> = new Promise((r) => { this.closeResolve = r; });

  constructor(private handlers: HostHandlers, private socketPath: string) {
    this.server = createServer((s) => this.onConnection(s));
  }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    rmSync(this.socketPath, { force: true });          // a stale file from a SIGKILLed predecessor
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.server.once("error", onErr);
      this.server.listen(this.socketPath, () => { this.server.off("error", onErr); resolve(); });
    });
    // the startup listener is gone now; an unhandled post-listen 'error' (an accept-time EMFILE, say)
    // throws out of the event loop and kills the whole detached host
    this.server.on("error", () => {});
  }

  async close(): Promise<void> {
    if (this.closing) return this.closed;   // a racing caller waits for the real close, not a bare return
    this.closing = true;
    const done = new Promise<void>((resolve) => this.server.close(() => resolve()));
    for (const s of this.open) s.destroy();   // close() waits for every open connection; the `stop` op
    this.open.clear();                        // is answered over one, so waiting on it would deadlock
    await done;
    rmSync(this.socketPath, { force: true });
    this.closeResolve();
  }

  private onConnection(sock: Socket): void {
    this.open.add(sock);
    // A vanished client releases its host-side subscription too — otherwise a follow() registered by a
    // connection that then disconnects leaks its host-side callback for the life of the host.
    sock.once("close", () => { this.open.delete(sock); this.unfollow(sock); });
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf8");
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        // a throwing handler (or an unserializable snapshot) must answer an error frame, not reject
        // unowned and take the host process down with it. The id is parsed off the frame BEFORE the op
        // is validated, so a malformed op still gets a correlated error reply rather than an orphan the
        // client cannot match.
        const frame = decodeFrame(line);
        const id = typeof frame?.["id"] === "number" ? (frame["id"] as number) : undefined;
        try { sock.write(encodeReply(id, await this.dispatch(frame, sock))); }
        catch (e) { sock.write(encodeReply(id, { ok: false, error: (e as Error).message })); }
      }
      if (buf.length > MAX_FRAME) { buf = ""; sock.destroy(); }
    });
    sock.on("error", () => { /* a client that vanished mid-write is not our failure */ });
  }

  private async dispatch(frame: HostFrame | undefined, sock: Socket): Promise<Record<string, unknown>> {
    if (!frame) return { ok: false, error: "bad json" };
    const op = hostOp.safeParse(frame);
    if (!op.success) return { ok: false, error: "unknown op" };
    switch (op.data.op) {
      case "status": return { ok: true, ...this.handlers.status() };
      case "stop": await this.handlers.stop(); return { ok: true };
      case "pending": return { ok: true, pending: this.handlers.pending() };
      case "answer": return { ...this.handlers.answer(op.data.toolUseID, { kind: op.data.decision }, op.data.by) };
      // A prompt is NOT awaited before replying: a turn runs for minutes, and holding the reply would
      // stall this connection's every other op — including the `interrupt` that ends the very turn it
      // is waiting on. The turn's progress travels as events instead. The busy check is the host's
      // (Task 5 tracks `busy`); a second prompt landing mid-turn would reset the TurnBuffer under the
      // running turn and let turn one's completion finalize the roster while turn two is still going.
      case "prompt": {
        if (this.handlers.status().status === "busy") return { ok: false, error: "busy" };
        void this.handlers.prompt(op.data.text).catch(() => {});
        return { ok: true, accepted: true };
      }
      case "interrupt": await this.handlers.interrupt(); return { ok: true };
      case "follow": {
        // Idempotent per connection: a client that sends `follow` twice must not end up with two
        // sinks writing every event to it twice.
        if (!this.unfollows.has(sock)) {
          this.unfollows.set(sock, this.handlers.follow((ev) => {
            try { sock.write(encodeEvent(ev)); } catch { /* the peer went away mid-write; close handles it */ }
          }));
        }
        return { ok: true, following: true };
      }
      case "unfollow": { this.unfollow(sock); return { ok: true, following: false }; }
    }
  }

  private unfollows = new Map<Socket, () => void>();
  private unfollow(sock: Socket): void {
    const off = this.unfollows.get(sock); this.unfollows.delete(sock); off?.();
  }
}
