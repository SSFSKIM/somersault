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

  private constructor(private sock: Socket, private label: string) {
    sock.on("data", (c) => this.onData(c.toString("utf8")));
    // Every awaited request must settle when the peer goes, or an attached client hangs on a host that
    // already exited — the same parked-promise class this project keeps rediscovering.
    const fail = (e: Error) => { for (const { reject } of this.inflight.values()) reject(e); this.inflight.clear(); };
    sock.on("close", () => fail(new Error("host connection closed")));
    sock.on("error", (e) => fail(e as Error));
  }

  static connect(socketPath: string, opts: { label?: string } = {}): Promise<RemoteChatSession> {
    return new Promise((resolve, reject) => {
      const sock = connect(socketPath);
      sock.once("error", reject);
      sock.once("connect", () => { sock.off("error", reject); resolve(new RemoteChatSession(sock, opts.label ?? `client-${process.pid}`)); });
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
  prompt(text: string): Promise<{ ok: boolean; accepted?: boolean; error?: string }> { return this.send({ op: "prompt", text }); }
  interrupt(): Promise<{ ok: boolean; error?: string }> { return this.send({ op: "interrupt" }); }
  stopHost(): Promise<{ ok: boolean; error?: string }> { return this.send({ op: "stop" }); }

  /** Subscribe to the host's pushed events. The first live subscription sends `follow`; the last one
   *  leaving sends `unfollow`. Followers are keyed by a per-call token, not by the callback reference,
   *  so subscribing the same function twice creates two independent subscriptions (dropping one leaves
   *  the other's events flowing), and the returned unsubscribe is itself idempotent — calling it twice
   *  cannot send a second `unfollow` for a subscriber count that only ever dropped once. */
  follow(cb: (ev: HostEvent) => void): () => void {
    const id = this.nextFollowerId++;
    const first = this.followers.size === 0;
    this.followers.set(id, cb);
    if (first) void this.send({ op: "follow" }).catch(() => {});
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.followers.delete(id);
      if (this.followers.size === 0) void this.send({ op: "unfollow" }).catch(() => {});
    };
  }

  /** Drop this connection. The host keeps running, its turn keeps going, and anything parked stays
   *  parked — that is the whole distinction between detach and stop. */
  detach(): void { this.sock.destroy(); }
}
