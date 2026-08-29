import { createServer, connect } from "node:net";
import type { Server, Socket } from "node:net";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { daemonOp, DAEMON_MAX_FRAME_BYTES, DAEMON_PARTIAL_LINE_MS } from "./types.js";
import type { DaemonSupervisor } from "./supervisor.js";
import type { UserTurnInput } from "../session/turnInput.js";

/** Every op literal `daemonOp`'s discriminated union recognizes, read off the schema itself
 *  (`_zod.propValues.op`, the same Set the union's own fast-path discriminator uses) so this can never
 *  drift from the literals actually listed in `types.ts`. What this buys (mirrors host/server.ts's
 *  identical guard): "this daemon's schema has never heard of this op at all" (a genuinely OLDER or
 *  NEWER peer — the wire's own version-skew signal, `connect.ts`'s `DAEMON_IMAGE_SKEW_NOTICE`) is now
 *  distinguishable from "this daemon knows the op but the payload failed some OTHER check" — both used
 *  to collapse to the identical `bad request:` string, which is what let a validation rejection
 *  misreport as skew. NOTE: this split is FOR FUTURE PEERS ONLY — it cannot retroactively change what a
 *  pre-F10 daemon (which never had this split) says; that peer's monolithic `bad request:` shape is
 *  exactly what `test/fixtures/preF10DaemonServer.ts` vendors. */
const KNOWN_OPS: ReadonlySet<string> = new Set(
  [...(daemonOp._zod.propValues?.op ?? [])].filter((v): v is string => typeof v === "string"),
);

/** Injectable clock seam (testing only — the partial-line deadline's boundary matrix needs a fake
 *  clock, not a real 10-second wait per row). Defaults to the real globals. */
export interface DaemonServerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface DaemonServerOpts {
  logger?: (message: string) => void;   // default console.error
  timers?: DaemonServerTimers;          // default the real setTimeout/clearTimeout
}

/** UDS listener speaking the NDJSON op protocol; routes ops to a DaemonSupervisor. */
export class DaemonServer {
  private server: Server;
  private closeResolve!: () => void;
  private closing = false;        // idempotency guard for close()
  private shuttingDown = false;   // stop accepting new ops once a shutdown is in progress
  private logger: (message: string) => void;
  private timers: DaemonServerTimers;
  readonly closed: Promise<void> = new Promise((r) => { this.closeResolve = r; });

  constructor(private supervisor: DaemonSupervisor, private socketPath: string, opts: DaemonServerOpts = {}) {
    this.server = createServer((sock) => this.onConnection(sock));
    this.logger = opts.logger ?? ((m) => console.error(m));
    this.timers = opts.timers ?? { setTimeout, clearTimeout };
  }

  async listen(): Promise<void> {
    await this.ensureFreeSocket();
    mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.server.once("error", onErr);
      this.server.listen(this.socketPath, () => { this.server.off("error", onErr); resolve(); });
    });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
    this.closeResolve();
  }

  /** Single-daemon invariant: refuse if a live daemon answers; clear a stale socket otherwise. */
  private async ensureFreeSocket(): Promise<void> {
    if (!existsSync(this.socketPath)) return;
    const alive = await new Promise<boolean>((resolve) => {
      const c = connect(this.socketPath)
        .on("connect", () => { c.destroy(); resolve(true); })
        .on("error", () => resolve(false));
    });
    if (alive) throw new Error(`daemon already running at ${this.socketPath}`);
    rmSync(this.socketPath, { force: true });
  }

  private onConnection(sock: Socket): void {
    // RAW BYTE CHUNKS, not an incrementally-decoded string. Measured (F10 T-IMGREACH Task 12): a naive
    // `buf += decoder.write(d)` plus a fresh `buf.indexOf("\n")` / `Buffer.byteLength(buf)` PER CHUNK is
    // quadratic in the number of chunks — an 8 KiB-chunked 24 MiB frame took ~11s to assemble that way,
    // eating almost the entire 10s partial-line deadline on a perfectly legitimate max-size frame. The
    // fix does not need `StringDecoder` at all: `0x0A` ('\n') can never appear as a UTF-8 continuation or
    // lead byte, so scanning each RAW chunk for it is byte-safe regardless of where a multi-byte
    // character's bytes happen to fall across chunk boundaries — decoding happens exactly ONCE, on the
    // fully-assembled line, so a split character is never decoded from a partial fragment in the first
    // place (measured fix: the same 24 MiB frame assembles in ~50ms).
    const chunks: Buffer[] = [];
    let byteLen = 0;
    let deadline: unknown;
    const armDeadline = () => {
      if (deadline) return;
      deadline = this.timers.setTimeout(() => {
        // A byte cap alone is not a bound: one byte held forever still exhausts connections (round-2 F11).
        this.logger(`daemon: dropping connection — partial line held over ${DAEMON_PARTIAL_LINE_MS}ms with no newline`);
        sock.destroy();
      }, DAEMON_PARTIAL_LINE_MS + 1);            // STRICTLY older than the cap — see the constant's doc comment
      (deadline as { unref?: () => void }).unref?.();
    };
    const clearDeadline = () => { if (deadline) { this.timers.clearTimeout(deadline); deadline = undefined; } };
    const onData = (d: Buffer) => {
      const nl = d.indexOf(0x0a);   // '\n' — see this method's opening comment for why this is UTF-8-safe
      if (nl < 0) {
        chunks.push(d);
        byteLen += d.length;
        if (byteLen > DAEMON_MAX_FRAME_BYTES) { sock.destroy(); return; }
        armDeadline(); return;
      }
      clearDeadline();
      sock.off("data", onData);              // one op per connection (first line)
      chunks.push(d.subarray(0, nl));
      byteLen += nl;
      if (byteLen > DAEMON_MAX_FRAME_BYTES) { sock.destroy(); return; }
      const line = Buffer.concat(chunks, byteLen).toString("utf8");
      void this.handle(sock, line);
    };
    sock.on("data", onData);
    // EOF with a non-empty partial buffer is a DROP, not a parse: a half-written frame is not an op.
    sock.on("end", () => { clearDeadline(); if (byteLen > 0) sock.destroy(); });
    sock.on("close", clearDeadline);
    sock.on("error", () => {});               // ignore client-side resets
  }

  private async handle(sock: Socket, line: string): Promise<void> {
    const send = (o: unknown) => sock.write(JSON.stringify(o) + "\n");
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(line); }
    catch (e) { send({ ok: false, error: `bad request: ${(e as Error).message}` }); sock.end(); return; }
    const parsed = daemonOp.safeParse(parsedJson);
    if (!parsed.success) {
      // "unknown op" is reserved for a literal this schema has NEVER heard of — the real version-skew
      // signal. A recognized literal whose payload failed some OTHER check gets its own honest reason
      // instead of reusing that string (mirrors host/server.ts's identical split).
      const literal = (parsedJson as Record<string, unknown> | null)?.["op"];
      const recognized = typeof literal === "string" && KNOWN_OPS.has(literal);
      send({ ok: false, error: recognized ? "invalid op payload" : "unknown op" });
      sock.end(); return;
    }
    const op = parsed.data;
    if (this.shuttingDown) { send({ ok: false, error: "daemon shutting down" }); sock.end(); return; }
    try {
      switch (op.op) {
        case "spawn": send({ ok: true, id: this.supervisor.spawn({ model: op.model, restart: op.restart, resume: op.resume, permissionMode: op.permissionMode }) }); sock.end(); break;
        case "list": send({ ok: true, sessions: this.supervisor.list().map((r) => ({ ...r, proactive: this.supervisor.proactiveStatus(r.id) })) }); sock.end(); break;
        case "sessions": send({ ok: true, sessions: await this.supervisor.listPersistedSessions({ cwd: op.cwd, limit: op.limit, offset: op.offset }) }); sock.end(); break;
        case "messages": send({ ok: true, messages: await this.supervisor.getPersistedMessages(op.id, { cwd: op.cwd, limit: op.limit, offset: op.offset }) }); sock.end(); break;
        case "control": send(await this.supervisor.control(op.id, op.frame)); sock.end(); break;
        case "compact": send({ ok: true, outcome: await this.supervisor.compact(op.id) }); sock.end(); break;
        case "fork": send({ ok: true, ...await this.supervisor.fork(op.id) }); sock.end(); break;
        case "rewind": send({ ok: true, ...await this.supervisor.rewind(op.id, op.messageId, { fork: op.fork }) }); sock.end(); break;
        case "usage": send({ ok: true, usage: await this.supervisor.usage(op.id) }); sock.end(); break;
        case "stop_task": await this.supervisor.stopTask(op.id, op.taskId); send({ ok: true }); sock.end(); break;
        case "init": send({ ok: true, init: await this.supervisor.initializationResult(op.id) }); sock.end(); break;
        case "apply_flag_settings": await this.supervisor.applyFlagSettings(op.id, op.settings); send({ ok: true }); sock.end(); break;
        case "rename": await this.supervisor.renamePersisted(op.id, op.title, { cwd: op.cwd }); send({ ok: true }); sock.end(); break;
        case "tag": await this.supervisor.tagPersisted(op.id, op.tag, { cwd: op.cwd }); send({ ok: true }); sock.end(); break;
        case "delete": await this.supervisor.deletePersisted(op.id, { cwd: op.cwd }); send({ ok: true }); sock.end(); break;
        case "start_proactive": send({ ok: true, status: this.supervisor.startProactive(op.id, op.config) }); sock.end(); break;
        case "stop_proactive": send(await this.supervisor.stopProactive(op.id)); sock.end(); break;
        case "stop": await this.supervisor.stop(op.id); send({ ok: true }); sock.end(); break;
        case "mcp_status": send({ ok: true, servers: await this.supervisor.mcpServerStatus(op.id) }); sock.end(); break;
        case "mcp_set_servers": send({ ok: true, result: await this.supervisor.setMcpServers(op.id, op.servers) }); sock.end(); break;
        case "mcp_toggle": await this.supervisor.toggleMcpServer(op.id, op.name, op.enabled); send({ ok: true }); sock.end(); break;
        case "mcp_reconnect": await this.supervisor.reconnectMcpServer(op.id, op.name); send({ ok: true }); sock.end(); break;
        case "mcp_mode_override": send({ ok: true, result: await this.supervisor.setMcpPermissionModeOverride(op.id, op.name, op.mode) }); sock.end(); break;
        case "pending_permissions": send({ ok: true, pending: this.supervisor.pendingPermissions() }); sock.end(); break;
        case "permission_response": { const ok = this.supervisor.respondPermission(op.toolUseID, op.decision); send(ok ? { ok: true } : { ok: false, error: "no pending request" }); sock.end(); break; }
        case "submit": case "submit_content": {
          const prompt: UserTurnInput = op.op === "submit" ? op.prompt : op.input;
          const r = await this.supervisor.submit(op.id, prompt, (m) => send({ type: "chunk", message: m }));
          // Task 14 made a turn that reached a terminal result frame and REPORTED failure resolve with an
          // additive `error` tag instead of rejecting. Before that it threw, and this handler's catch below
          // sent `{ok:false, error}` — so answering `{type:"done"}` here would report a dead API as a
          // completed turn to every UDS client that branches on `ok:false`. Same shape as the catch.
          if (r.error) send({ ok: false, error: r.error.message });
          else send({ type: "done", result: r.result });
          sock.end(); break;
        }
        case "shutdown":
          this.shuttingDown = true; // set before any await → concurrent ops are refused, none escape cleanup
          send({ ok: true }); sock.end();
          await this.supervisor.shutdown();
          await this.close();
          break;
      }
    } catch (e) { send({ ok: false, error: (e as Error).message }); sock.end(); }
  }
}
