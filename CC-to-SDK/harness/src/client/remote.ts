import { connect } from "node:net";
import type { Socket } from "node:net";
import { decodeFrame } from "../host/wire.js";
import type { HostEvent } from "../host/wire.js";
import type { HostStatus } from "../host/ops.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { PermissionDecision } from "../permissions/types.js";

/** Long enough that a busy host answering a `status` while streaming a turn is never mistaken for a
 *  dead one; short enough that a client does not sit on a promise that will never settle. */
const REQUEST_TIMEOUT_MS = 10_000;

/** THIS direction's own cap — NOT the server's `MAX_FRAME`. The two directions carry different traffic:
 *  the server bounds small fixed-shape client→host ops (`status`/`answer`/`prompt`), while this buffers
 *  host→client **event** frames, which carry SDK messages including tool results — and follow.ts's own
 *  TurnBuffer is explicitly sized around a single 2 MiB one. Reusing the server's 256 KiB cap here once
 *  destroyed the connection on a legitimate ~500 KiB event before its terminating newline ever arrived —
 *  worse than the runaway-peer case the cap exists to guard. 32 MiB is comfortably above any real single
 *  SDK message while still bounding a peer that never sends a newline at all. */
const MAX_FRAME = 32 * 1024 * 1024;

/** A `ChatSession`-shaped handle on a host running in another process. Held by an attached client in
 *  place of a local Session. `detach()` is NOT `dispose()`: it drops this connection and leaves the
 *  host, its turn and its parked decisions exactly as they were — the only way to end the session is
 *  `stopHost()`, the explicit `stop` op. */
export class RemoteChatSession {
  private nextId = 1;
  private inflight = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private followers = new Map<number, (ev: HostEvent) => void>();
  private nextFollowerId = 1;
  private buf = "";

  private followAck?: Promise<unknown>;
  private closeCbs = new Set<(e: Error) => void>();
  private closedWith?: Error;

  private constructor(private sock: Socket, private label: string, private maxFrame: number) {
    sock.on("data", (c) => this.onData(c.toString("utf8")));
    // Every awaited request must settle when the peer goes, or an attached client hangs on a host that
    // already exited — the same parked-promise class this project keeps rediscovering.
    const fail = (e: Error) => {
      for (const { reject } of this.inflight.values()) reject(e);
      this.inflight.clear();
      if (!this.closedWith) {   // first error wins — a later close/error is not a second event
        this.closedWith = e;
        for (const cb of [...this.closeCbs]) { try { cb(e); } catch { /* one subscriber's failure is not another's */ } }
      }
    };
    sock.on("close", () => fail(new Error("host connection closed")));
    sock.on("error", (e) => fail(e as Error));
  }

  /** Fires once when the connection dies (peer close or socket error), AFTER in-flight requests were
   *  rejected. A subscriber added after the close fires immediately — a late subscriber must not wait
   *  forever on a connection that is already gone. */
  onClose(cb: (e: Error) => void): () => void {
    if (this.closedWith) { try { cb(this.closedWith); } catch { /* ignore */ } return () => {}; }
    this.closeCbs.add(cb);
    return () => { this.closeCbs.delete(cb); };
  }

  /** `maxFrame` overrides MAX_FRAME — test-only, so the over-cap-flood guard test can trip the cap with
   *  a few hundred KiB instead of flooding the real 32 MiB, the same DI escape hatch as SessionHost's
   *  `disposeGraceMs`. Production callers get the real cap by omitting it. */
  static connect(socketPath: string, opts: { label?: string; maxFrame?: number } = {}): Promise<RemoteChatSession> {
    return new Promise((resolve, reject) => {
      const sock = connect(socketPath);
      sock.once("error", reject);
      sock.once("connect", () => { sock.off("error", reject); resolve(new RemoteChatSession(sock, opts.label ?? `client-${process.pid}`, opts.maxFrame ?? MAX_FRAME)); });
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    for (let nl = this.buf.indexOf("\n"); nl >= 0; nl = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      const frame = decodeFrame(line);
      if (!frame) continue;
      // Routed on `t === "event"` before the id is even looked at: a pushed event can never be mistaken
      // for a correlated reply, nor a reply for an event, whatever either happens to carry.
      if (frame.t === "event") { for (const cb of [...this.followers.values()]) { try { cb(frame as HostEvent); } catch { /* one follower's failure is not another's */ } } continue; }
      const id = (frame as Record<string, unknown>)["id"];
      if (typeof id !== "number") continue;   // an id-less reply (a pre-A2a host) has no waiter to find — the deadline below covers it
      const waiter = this.inflight.get(id);
      if (!waiter) continue;
      this.inflight.delete(id);
      waiter.resolve(frame);
    }
    // This direction's own cap (see MAX_FRAME above): a host in a bad state that writes data with no
    // terminating newline must not grow this buffer without bound for the life of a long-lived attached
    // UI. The server destroys such a peer on ITS cap; we destroy such a host on OURS — `close`'s
    // `fail()` handler then rejects every in-flight request rather than leaving them parked on a
    // connection that is gone.
    if (this.buf.length > this.maxFrame) { this.buf = ""; this.sock.destroy(); }
  }

  private send<T>(op: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      // A deadline, because a silent peer is a real case, not a hypothetical: a host started before
      // this stage answers without the `id` we correlate on (its schema strips the unknown key), so
      // its reply is dropped in onData and this promise would never settle without one.
      const timer = setTimeout(() => {
        if (!this.inflight.delete(id)) return;   // already settled by a reply — never reject a promise that already resolved
        reject(new Error(`host did not answer ${String(op["op"])} within ${REQUEST_TIMEOUT_MS}ms (a pre-upgrade host, or a wedged one)`));
      }, REQUEST_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
      this.inflight.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.sock.write(JSON.stringify({ ...op, id }) + "\n");
    });
  }

  // Every reply the server can send — including `status`/`pending`/etc — may also come back as the
  // generic `{ ok:false, error }` a throwing handler produces (server.ts's onConnection wraps every
  // dispatch in try/catch), so `error` is a real field on every one of these, not decoration.
  status(): Promise<HostStatus & { ok: boolean; error?: string }> { return this.send({ op: "status" }); }
  pending(): Promise<{ ok: boolean; pending: PendingEntry[]; error?: string }> { return this.send({ op: "pending" }); }
  answer(toolUseID: string, decision: PermissionDecision): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }> {
    return this.send({ op: "answer", toolUseID, decision: decision.kind, by: this.label });
  }
  prompt(text: string): Promise<{ ok: boolean; accepted?: boolean; seq?: number; error?: string }> { return this.send({ op: "prompt", text }); }
  interrupt(): Promise<{ ok: boolean; error?: string }> { return this.send({ op: "interrupt" }); }
  stopHost(): Promise<{ ok: boolean; error?: string }> { return this.send({ op: "stop" }); }

  // Task 2's control ops — one method per op, `…Op` suffix keeps this raw wire client visibly distinct
  // from the `ChatSession` methods the Task 5 adapter layers on top.
  setModelOp(model?: string) { return this.send<{ ok: boolean; error?: string }>({ op: "set_model", ...(model ? { model } : {}) }); }
  setPermissionModeOp(mode: string) { return this.send<{ ok: boolean; error?: string }>({ op: "set_permission_mode", mode }); }
  setThinkingOp(maxTokens: number | null) { return this.send<{ ok: boolean; error?: string }>({ op: "set_thinking", maxTokens }); }
  capabilitiesOp() { return this.send<{ ok: boolean; error?: string; models?: unknown[]; commands?: unknown[]; mcpServers?: unknown[] }>({ op: "capabilities" }); }
  compactOp() { return this.send<{ ok: boolean; error?: string; outcome?: unknown }>({ op: "compact" }); }
  usageOp() { return this.send<{ ok: boolean; error?: string; usage?: unknown }>({ op: "usage" }); }
  contextUsageOp() { return this.send<{ ok: boolean; error?: string; usage?: unknown }>({ op: "context_usage" }); }
  mcpStatusOp() { return this.send<{ ok: boolean; error?: string; servers?: unknown[] }>({ op: "mcp_status" }); }
  mcpReconnectOp(name: string) { return this.send<{ ok: boolean; error?: string }>({ op: "mcp_reconnect", name }); }
  mcpToggleOp(name: string, enabled: boolean) { return this.send<{ ok: boolean; error?: string }>({ op: "mcp_toggle", name, enabled }); }
  resumeOp(sessionId: string) { return this.send<{ ok: boolean; error?: string }>({ op: "resume", sessionId }); }

  /** Subscribe to the host's pushed events. The first live subscription sends `follow`; the last one
   *  leaving sends `unfollow`. Followers are keyed by a per-call token, not by the callback reference,
   *  so subscribing the same function twice creates two independent subscriptions (dropping one leaves
   *  the other's events flowing), and the returned unsubscribe is itself idempotent — calling it twice
   *  cannot send a second `unfollow` for a subscriber count that only ever dropped once. */
  follow(cb: (ev: HostEvent) => void): () => void {
    const id = this.nextFollowerId++;
    const first = this.followers.size === 0;
    this.followers.set(id, cb);
    if (first) { this.followAck = this.send({ op: "follow" }); this.followAck.catch(() => {}); }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.followers.delete(id);
      if (this.followers.size === 0) { void this.send({ op: "unfollow" }).catch(() => {}); this.followAck = undefined; }
    };
  }

  /** The in-flight (or settled) `follow` ack for the currently-live subscription — `undefined` before
   *  the first `follow()` and again once the last follower leaves; the next `follow()` re-sends and
   *  re-populates it. */
  whenFollowed(): Promise<unknown> | undefined { return this.followAck; }

  /** Drop this connection. The host keeps running, its turn keeps going, and anything parked stays
   *  parked — that is the whole distinction between detach and stop. */
  detach(): void { this.sock.destroy(); }
}
