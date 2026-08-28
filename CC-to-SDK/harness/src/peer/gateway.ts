// src/peer/gateway.ts — this server's own reply address in the peer namespace.
//
// It is NOT a session, and the difference is the design: it publishes a KEY FILE and no registry row.
// A key alone vouches a reply address (measured, probe 117b Q3), so publishing a row would put the
// app-server in every session-listing tool on the machine claiming to be something it is not.
//
// Two wire properties are load-bearing and both were learned the hard way:
//   - the socket must live in the RECEIVER's own directory, because the receipt sender refuses any reply
//     address outside it;
//   - the listener must CLOSE the connection once it has consumed a frame. The sender writes one buffer,
//     never reads, and times out idle after five seconds — so a listener that stays open turns every
//     receipt into the sender's error. That is what probe 113b logged, and why 113c received nothing.
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "../config/claudeHome.js";
import { keyFileName } from "./address.js";

export interface GatewayEvents {
  onReceipt(frame: Record<string, unknown>): void;
  onStrayFrame(kind: string): void;
}

const MAX_LINE = 64 * 1024;

/** Where the CLI binds its own inboxes, and therefore the only directory a reply address may sit in. */
export function defaultSocketDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_RUNTIME_DIR || "/tmp", "cc-socks");
}

export class PeerGateway {
  private constructor(
    private server: Server,
    readonly socketPath: string,
    private keyPath: string,
    readonly configRoot: string,
  ) {}

  get address(): string { return `uds:${this.socketPath}`; }

  static async bind(events: GatewayEvents, opts: { env?: NodeJS.ProcessEnv; socketDir?: string; pid?: number } = {}): Promise<PeerGateway | undefined> {
    const env = opts.env ?? process.env;
    const pid = opts.pid ?? process.pid;
    const socketDir = opts.socketDir ?? defaultSocketDir(env);
    const configRoot = claudeConfigDir(env);
    const socketPath = join(socketDir, `${pid}.sock`);
    const sessionsPath = join(configRoot, "sessions");
    const keyPath = join(sessionsPath, keyFileName(pid, socketPath));
    try {
      mkdirSync(socketDir, { recursive: true, mode: 0o700 });
      mkdirSync(sessionsPath, { recursive: true });
      try { unlinkSync(socketPath); } catch { /* nothing stale to clear */ }
      const server = createServer((c) => handleConn(c, events));
      await new Promise<void>((res, rej) => {
        server.once("error", rej);
        server.listen(socketPath, () => res());
      });
      server.unref(); // a listening reply address must never be the reason this process stays alive
      writeFileSync(keyPath, JSON.stringify({ peerToken: randomBytes(16).toString("hex") }), { mode: 0o600 });
      return new PeerGateway(server, socketPath, keyPath, configRoot);
    } catch {
      // A gateway that cannot bind is not fatal: the server runs and every peer method answers
      // unavailable. The whole inbound fabric sits behind a server-side feature gate that can turn off
      // without an SDK release, so degrading is the baseline rather than the error path.
      return undefined;
    }
  }

  /** Write NDJSON to a peer's inbox and resolve when the connection closes. No reply is read: the CLI's
   *  ingress never answers on the same connection. */
  sendFrames(socketPath: string, frames: unknown[]): Promise<"CLOSED" | string> {
    return new Promise((res) => {
      const c = createConnection(socketPath);
      let done = false;
      const fin = (v: "CLOSED" | string) => { if (!done) { done = true; res(v); } };
      c.on("connect", () => { for (const f of frames) c.write(JSON.stringify(f) + "\n"); c.end(); });
      c.on("error", (e) => fin("ERROR:" + ((e as NodeJS.ErrnoException).code ?? "unknown")));
      c.on("close", () => fin("CLOSED"));
      setTimeout(() => fin("TIMEOUT"), 10_000).unref?.();
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((res) => this.server.close(() => res()));
    try { unlinkSync(this.socketPath); } catch { /* already gone */ }
    try { unlinkSync(this.keyPath); } catch { /* already gone */ }
  }
}

function handleConn(c: Socket, events: GatewayEvents): void {
  c.setEncoding("utf8");
  let buf = "";
  c.on("data", (d: string) => {
    buf += d;
    if (buf.length > MAX_LINE) { c.destroy(); return; }
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let frame: Record<string, unknown>;
      try { frame = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const type = typeof frame.type === "string" ? frame.type : "";
      if (type === "auth") continue;   // the sender's courtesy; we are the listener and require nothing
      if (type === "control" && frame.action === "peer_message_status") { events.onReceipt(frame); continue; }
      events.onStrayFrame(type || "unknown");
    }
    c.end();   // the sender never reads; hold this open and its 5s idle timeout kills the receipt
  });
  c.on("error", () => { /* the peer hung up mid-write; nothing to do */ });
}
