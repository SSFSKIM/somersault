import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { hostOp } from "./ops.js";
import type { HostStatus } from "./ops.js";
import { decodeFrame, encodeReply } from "./wire.js";
import type { HostFrame } from "./wire.js";

export interface HostHandlers { status(): HostStatus; stop(): Promise<void> }

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
    sock.once("close", () => this.open.delete(sock));
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
        try { sock.write(encodeReply(id, await this.dispatch(frame))); }
        catch (e) { sock.write(encodeReply(id, { ok: false, error: (e as Error).message })); }
      }
      if (buf.length > MAX_FRAME) { buf = ""; sock.destroy(); }
    });
    sock.on("error", () => { /* a client that vanished mid-write is not our failure */ });
  }

  private async dispatch(frame: HostFrame | undefined): Promise<Record<string, unknown>> {
    if (!frame) return { ok: false, error: "bad json" };
    const op = hostOp.safeParse(frame);
    if (!op.success) return { ok: false, error: "unknown op" };
    switch (op.data.op) {
      case "status": return { ok: true, ...this.handlers.status() };
      case "stop": await this.handlers.stop(); return { ok: true };
    }
  }
}
