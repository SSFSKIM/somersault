// src/peer/receipts.ts — the msgId -> connection map a `peer/send` leaves behind so a later status frame
// can be routed back to whoever asked.
//
// Its whole difficulty is that the COMMON outcomes are silent. Measured (probe 117b and the receivers'
// own logs in 117): a delivered message and a refused message produce no receipt at all; only `held` and
// `expired` do. So nothing about the success path ever signals that an entry may be released, and
// "release it when the receipt arrives" would grow this map without bound for any long-lived client.
// Hence three rules, none optional: an absolute retention window, drop-on-connection-close, and caps.
export type ReceiptStatus = "held" | "expired" | "delivered" | "refused" | "denied" | "dropped";

/** Generic over the connection handle so this module never imports an app-server type: it stores what it
 *  was handed and gives it back, which is what keeps ONE map with ONE lifecycle. */
export interface ReceiptSink<C> {
  deliver(conn: C, msgId: string, status: ReceiptStatus, reason: string | undefined, from: string): void;
}

/** Six times the CLI's 5-minute default hold deadline. FIXED here rather than derived from this process's
 *  `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`: the deadline belongs to the RECEIVER, which may run with its own,
 *  so a locally-derived TTL could expire before a status we were still owed. */
export const RETENTION_MS = 30 * 60_000;
export const PER_CONN_CAP = 256;
export const GLOBAL_CAP = 4096;

/** `held` is NOT terminal — an `expired` follows it when the recipient never approves — so it is the one
 *  status that leaves its entry in place. */
const TERMINAL: ReadonlySet<ReceiptStatus> = new Set<ReceiptStatus>(["expired", "delivered", "refused", "denied", "dropped"]);

interface Entry<C> { conn: C; at: number }

export class ReceiptMap<C extends { connId: number }> {
  private entries = new Map<string, Entry<C>>();   // insertion-ordered, which is what makes oldest-first eviction a shift
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly perConn: number;
  private readonly globalCap: number;

  constructor(private sink: ReceiptSink<C>, opts: { now?: () => number; retentionMs?: number; perConn?: number; global?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.retentionMs = opts.retentionMs ?? RETENTION_MS;
    this.perConn = opts.perConn ?? PER_CONN_CAP;
    this.globalCap = opts.global ?? GLOBAL_CAP;
  }

  track(msgId: string, conn: C): void {
    this.entries.set(msgId, { conn, at: this.now() });
    this.evict((e) => e.conn.connId === conn.connId, this.perConn);
    this.evict(() => true, this.globalCap);
  }

  /** Returns whether the frame was ours to route. A frame with no `orig_msg_id` is not — the CLI omits it
   *  for a non-UUID `msg_id`, which is why `peer/send` mints one rather than accepting a client's. */
  route(frame: { orig_msg_id?: unknown; status?: unknown; reason?: unknown; from?: unknown }): boolean {
    const msgId = frame.orig_msg_id;
    if (typeof msgId !== "string") return false;
    const entry = this.entries.get(msgId);
    if (!entry) return false;
    const status = (typeof frame.status === "string" ? frame.status : "dropped") as ReceiptStatus;
    this.sink.deliver(entry.conn, msgId, status, typeof frame.reason === "string" ? frame.reason : undefined, typeof frame.from === "string" ? frame.from : "");
    if (TERMINAL.has(status)) this.entries.delete(msgId);
    return true;
  }

  dropConnection(connId: number): void {
    for (const [msgId, e] of [...this.entries]) if (e.conn.connId === connId) this.entries.delete(msgId);
  }

  /** `retentionMs` is overridable so shutdown can expire everything still tracked rather than leaving
   *  those senders unanswered. */
  sweep(retentionMs: number = this.retentionMs): void {
    const cutoff = this.now() - retentionMs;
    for (const [msgId, e] of [...this.entries]) {
      if (e.at >= cutoff) continue;
      this.entries.delete(msgId);
      // Never a SILENT drop: a client that will never hear about this message again should be told that,
      // not left waiting for a status the map has already forgotten how to route.
      this.sink.deliver(e.conn, msgId, "dropped", "correlation expired", "");
    }
  }

  size(): number { return this.entries.size; }

  private evict(match: (e: Entry<C>) => boolean, cap: number): void {
    let n = 0;
    for (const e of this.entries.values()) if (match(e)) n++;
    for (const [msgId, e] of this.entries) {
      if (n <= cap) break;
      if (!match(e)) continue;
      this.entries.delete(msgId);
      this.sink.deliver(e.conn, msgId, "dropped", "correlation evicted", "");
      n--;
    }
  }
}
