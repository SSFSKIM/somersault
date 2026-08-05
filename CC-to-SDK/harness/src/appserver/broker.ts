// appserver/broker.ts — decisions as state (spec Task 7, the M1 keystone): permission requests are
// PARKED, not sent as a reverse-RPC call. ThreadDecisions wraps a thread-scoped inner PendingDecisions
// (expireAfterMs:"never" — a detach-first server parks forever) so a park survives with zero clients
// connected; any client can later answer it via decision/respond. The awaited broker.request() promise
// and the decision/resolved notification settle off the SAME inner.respond() call.
import { PendingDecisions, type PendingDecision } from "../permissions/pending.js";
import type { DecisionKind, DecisionOutcome, PermissionBroker } from "../permissions/types.js";

/** Which answer kinds are valid for a parked decision of a given kind — mirrors the real host wire
 *  (host/ops.ts): a flat 3-way for `permission`, structured answers for `question`/`plan`, `deny` is
 *  always the universal escape hatch. */
export const ANSWER_KINDS: Record<DecisionKind, ReadonlyArray<DecisionOutcome["kind"]>> = {
  permission: ["allow_once", "allow_with_updates", "allow_always", "deny"],
  question: ["question_answer", "deny"],
  plan: ["plan_approve", "plan_reject", "deny"],
};

export type DecisionEvent =
  | { type: "requested"; entry: PendingDecision }
  | { type: "resolved"; toolUseID: string; by: string; outcome: DecisionOutcome };

/** One instance per thread. `unattended`/`hasWatchers` are read lazily on every request — the caller's
 *  thread state (unattended mode, live connections) can change between parks. */
export class ThreadDecisions {
  private inner: PendingDecisions;
  private settledBy = new Map<string, string>(); // toolUseID -> who/what settled it, for a late second answer's alreadySettled.data.by
  private closed = false;                        // set by teardown(); see broker() for why this must latch

  constructor(
    private emit: (ev: DecisionEvent) => void,
    private unattended: () => "park" | "deny",
    private hasWatchers: () => boolean,
  ) {
    this.inner = new PendingDecisions({
      expireAfterMs: "never",
      onAutoSettle: (entry) => {
        this.settledBy.set(entry.toolUseID, "system");
        this.emit({ type: "resolved", toolUseID: entry.toolUseID, by: "system", outcome: { kind: "deny" } });
      },
    });
  }

  /** The PermissionBroker injected into this thread's engine config. */
  broker(threadId: string): PermissionBroker {
    return {
      request: (req) => {
        // Closing is a LATCH, not a one-shot sweep: denying a tool hands control back to the model, which
        // routinely reaches for a different tool — and that second call would park with nobody left to
        // answer it, re-opening the very deadlock teardown() exists to prevent (dispose() awaits the read
        // loop, the read loop awaits this promise). While closed, every request denies immediately.
        if (this.closed) return Promise.resolve({ kind: "deny" });
        if (this.unattended() === "deny" && !this.hasWatchers()) return Promise.resolve({ kind: "deny" });
        const settled = this.inner.brokerFor(threadId).request(req); // parks synchronously (Promise executor runs sync) before returning
        const entry = this.inner.list().find((e) => e.toolUseID === req.toolUseID);
        if (entry) this.emit({ type: "requested", entry });
        return settled;
      },
    };
  }

  pending(): PendingDecision[] { return this.inner.list(); }

  respond(toolUseID: string, outcome: DecisionOutcome, by: string): { ok: true } | { ok: false; code: "alreadySettled" | "kindMismatch"; by?: string } {
    const entry = this.inner.list().find((e) => e.toolUseID === toolUseID);
    if (!entry) return { ok: false, code: "alreadySettled", by: this.settledBy.get(toolUseID) };
    if (!ANSWER_KINDS[entry.kind].includes(outcome.kind)) return { ok: false, code: "kindMismatch" };
    this.inner.respond(toolUseID, outcome);
    this.settledBy.set(toolUseID, by);
    this.emit({ type: "resolved", toolUseID, by, outcome });
    return { ok: true };
  }

  /** Deny + settle everything still parked (thread close) — denyAll() bypasses respond()'s own emit, so
   *  this is the one place that emits for it (mirrors PendingDecisions.denyAll's documented contract). */
  teardown(): void {
    this.closed = true;
    for (const entry of this.inner.denyAll()) {
      this.settledBy.set(entry.toolUseID, "system");
      this.emit({ type: "resolved", toolUseID: entry.toolUseID, by: "system", outcome: { kind: "deny" } });
    }
  }
}
