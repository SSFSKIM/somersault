// harness/src/permissions/pending.ts
import type { DecisionKind, DecisionOutcome, PermissionBroker, PermissionRequest } from "./types.js";

/** A parked decision on the wire — the serializable view of a PermissionRequest (no AbortSignal). */
export interface PendingDecision {
  sessionId: string;
  toolUseID: string;
  toolName: string;
  kind: DecisionKind;
  input: Record<string, unknown>;
  parentToolUseID?: string;
  subagentType?: string;
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

export interface PendingDecisionsOpts {
  expireAfterMs: ExpiryPolicy;                           // REQUIRED — no default, deliberately
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Fired when the TIMER or the request's ABORT signal settles a park (always with {kind:"deny"}) —
   *  never on respond()/denyAll(): those callers own their own emits. This is how the host learns to
   *  emit decision_settled(by:"system") for an SDK-side abort (spec: "new wiring, not inherited"). */
  onAutoSettle?: (entry: PendingDecision) => void;
}

/** Supervisor-owned registry of parked daemon decisions. A daemon session's canUseTool (or a question/plan
 *  gate) parks here (brokerFor(id).request) until a client answers (respond), the park times out, the
 *  request's signal aborts, or the session/daemon tears down (denyAllForSession / denyAll) — every path
 *  settles the awaited promise. */
export class PendingDecisions {
  private pending = new Map<string, { entry: PendingDecision; resolve: (d: DecisionOutcome) => void; cancel: () => void }>();
  private expireAfterMs: ExpiryPolicy;
  private now: () => number;
  private schedule: (fn: () => void, ms: number) => () => void;
  private onAutoSettle?: (entry: PendingDecision) => void;

  constructor(opts: PendingDecisionsOpts) {
    this.expireAfterMs = opts.expireAfterMs;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as any).unref?.(); return () => clearTimeout(t); });
    this.onAutoSettle = opts.onAutoSettle;
  }

  /** A session-bound broker; its request() parks until settled. */
  brokerFor(sessionId: string): PermissionBroker {
    return { request: (req) => this.park(sessionId, req) };
  }

  private park(sessionId: string, req: PermissionRequest): Promise<DecisionOutcome> {
    // Adding an `abort` listener to a signal that is ALREADY aborted never fires it — `gate.ts`'s
    // canUseTool path pre-checks this before ever reaching a broker, but our own tests (and any other
    // direct `broker().request()` caller) go straight to `park`, and without this a pre-aborted request
    // would sit in `list()` forever, awaited by nobody.
    if (req.signal?.aborted) return Promise.resolve({ kind: "deny" });
    return new Promise((resolve) => {
      const entry: PendingDecision = {
        sessionId, toolUseID: req.toolUseID, toolName: req.toolName, kind: req.kind ?? "permission", input: req.input,
        parentToolUseID: req.parentToolUseID, subagentType: req.subagentType,
        title: req.title, displayName: req.displayName, description: req.description, createdAt: this.now(),
      };
      const cancelTimer = this.expireAfterMs === "never"
        ? () => {}
        : this.schedule(() => this.autoSettle(req.toolUseID), this.expireAfterMs);
      const onAbort = () => this.autoSettle(req.toolUseID);
      req.signal?.addEventListener("abort", onAbort, { once: true });
      const cancel = () => { cancelTimer(); req.signal?.removeEventListener("abort", onAbort); };
      this.pending.set(req.toolUseID, { entry, resolve, cancel });
    });
  }

  private settle(toolUseID: string, decision: DecisionOutcome): boolean {
    const p = this.pending.get(toolUseID);
    if (!p) return false;
    p.cancel();
    this.pending.delete(toolUseID);
    p.resolve(decision);
    return true;
  }

  private autoSettle(toolUseID: string): void {
    const entry = this.pending.get(toolUseID)?.entry;
    if (this.settle(toolUseID, { kind: "deny" }) && entry) this.onAutoSettle?.(entry);
  }

  /** Answer a parked request. Returns false if none matches (already answered/timed out → idempotent). */
  respond(toolUseID: string, decision: DecisionOutcome): boolean { return this.settle(toolUseID, decision); }

  /** The serializable list of currently-parked requests (for the poll). */
  list(): PendingDecision[] { return [...this.pending.values()].map((p) => p.entry); }

  /** Deny + settle every parked request for one session (session stop/teardown). */
  denyAllForSession(sessionId: string): void {
    for (const [id, p] of [...this.pending]) if (p.entry.sessionId === sessionId) this.settle(id, { kind: "deny" });
  }

  /** Deny + settle every parked request (daemon shutdown). Returns the entries that were settled: this
   *  bypasses `respond()`'s caller (SessionHost.answer()) entirely, going straight at the map, so it
   *  carries none of answer()'s `permission_settled`/`state` emits — a caller that needs followers told
   *  the decision is gone (SessionHost.interrupt()/teardown() do) must emit for each entry itself. */
  denyAll(): PendingDecision[] {
    const entries = [...this.pending.values()].map((p) => p.entry);
    for (const id of [...this.pending.keys()]) this.settle(id, { kind: "deny" });
    return entries;
  }
}

/** Legacy names (pre-Goal-B): the daemon and older tests import these — same class, same entry. */
export type PendingEntry = PendingDecision;
export const PendingPermissions = PendingDecisions;
export type PendingPermissions = PendingDecisions;
export type PendingPermissionsOpts = PendingDecisionsOpts;
