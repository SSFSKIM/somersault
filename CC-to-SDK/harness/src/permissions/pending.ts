// harness/src/permissions/pending.ts
import type { PermissionBroker, PermissionDecision, PermissionRequest } from "./types.js";

/** A parked permission request on the wire — the serializable view of a PermissionRequest (no AbortSignal). */
export interface PendingEntry {
  sessionId: string;
  toolUseID: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  createdAt: number;
}

/** How long a parked request may sit before we answer FOR the human, with a deny. `"never"` is the
 *  background case and is spelled out rather than defaulted: a host that parks forever is the entire
 *  point of a worker that outlives its terminal, and a numeric default is how that silently becomes a
 *  30-second auto-deny again. */
export type ExpiryPolicy = number | "never";

export interface PendingPermissionsOpts {
  expireAfterMs: ExpiryPolicy;                           // REQUIRED — no default, deliberately
  now?: () => number;                                    // injectable clock (createdAt + tests)
  schedule?: (fn: () => void, ms: number) => () => void; // timeout scheduler → canceller (testing seam)
}

/** Supervisor-owned registry of parked daemon permission requests. A daemon session's canUseTool parks here
 *  (brokerFor(id).request) until a client answers (respond), the park times out, the request's signal aborts,
 *  or the session/daemon tears down (denyAllForSession / denyAll) — every path settles the awaited promise. */
export class PendingPermissions {
  private pending = new Map<string, { entry: PendingEntry; resolve: (d: PermissionDecision) => void; cancel: () => void }>();
  private expireAfterMs: ExpiryPolicy;
  private now: () => number;
  private schedule: (fn: () => void, ms: number) => () => void;

  constructor(opts: PendingPermissionsOpts) {
    this.expireAfterMs = opts.expireAfterMs;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as any).unref?.(); return () => clearTimeout(t); });
  }

  /** A session-bound broker; its request() parks until settled. */
  brokerFor(sessionId: string): PermissionBroker {
    return { request: (req) => this.park(sessionId, req) };
  }

  private park(sessionId: string, req: PermissionRequest): Promise<PermissionDecision> {
    // Adding an `abort` listener to a signal that is ALREADY aborted never fires it — `gate.ts`'s
    // canUseTool path pre-checks this before ever reaching a broker, but our own tests (and any other
    // direct `broker().request()` caller) go straight to `park`, and without this a pre-aborted request
    // would sit in `list()` forever, awaited by nobody.
    if (req.signal?.aborted) return Promise.resolve({ kind: "deny" });
    return new Promise((resolve) => {
      const entry: PendingEntry = {
        sessionId, toolUseID: req.toolUseID, toolName: req.toolName, input: req.input,
        title: req.title, displayName: req.displayName, description: req.description, createdAt: this.now(),
      };
      const cancelTimer = this.expireAfterMs === "never"
        ? () => {}
        : this.schedule(() => this.settle(req.toolUseID, { kind: "deny" }), this.expireAfterMs);
      const onAbort = () => this.settle(req.toolUseID, { kind: "deny" });
      req.signal?.addEventListener("abort", onAbort, { once: true });
      const cancel = () => { cancelTimer(); req.signal?.removeEventListener("abort", onAbort); };
      this.pending.set(req.toolUseID, { entry, resolve, cancel });
    });
  }

  private settle(toolUseID: string, decision: PermissionDecision): boolean {
    const p = this.pending.get(toolUseID);
    if (!p) return false;
    p.cancel();
    this.pending.delete(toolUseID);
    p.resolve(decision);
    return true;
  }

  /** Answer a parked request. Returns false if none matches (already answered/timed out → idempotent). */
  respond(toolUseID: string, decision: PermissionDecision): boolean { return this.settle(toolUseID, decision); }

  /** The serializable list of currently-parked requests (for the poll). */
  list(): PendingEntry[] { return [...this.pending.values()].map((p) => p.entry); }

  /** Deny + settle every parked request for one session (session stop/teardown). */
  denyAllForSession(sessionId: string): void {
    for (const [id, p] of [...this.pending]) if (p.entry.sessionId === sessionId) this.settle(id, { kind: "deny" });
  }

  /** Deny + settle every parked request (daemon shutdown). */
  denyAll(): void { for (const id of [...this.pending.keys()]) this.settle(id, { kind: "deny" }); }
}
