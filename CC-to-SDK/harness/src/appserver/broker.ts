// appserver/broker.ts — decisions as state (spec Task 7, the M1 keystone): permission requests are
// PARKED, not sent as a reverse-RPC call. ThreadDecisions wraps a thread-scoped inner PendingDecisions
// (expireAfterMs:"never" — a detach-first server parks forever) so a park survives with zero clients
// connected; any client can later answer it via decision/respond. The awaited broker.request() promise
// and the decision/resolved notification settle off the SAME inner.respond() call.
import { PendingDecisions, type PendingDecision } from "../permissions/pending.js";
import type { DecisionKind, DecisionOutcome, PermissionBroker, PermissionRequest } from "../permissions/types.js";

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

/** The wire shape of a PendingDecision (protocol spec §5/§6): every field verbatim except the internal
 *  `toolUseID` (capital ID — src/permissions/pending.ts), which the wire spells `toolUseId` (lowercase
 *  d) to match decision/respond's params and decision/resolved's notification. This is a projection at
 *  the client boundary, not a rename — the internal type and every internal caller keep `toolUseID`. */
export type WireDecision = Omit<PendingDecision, "toolUseID"> & { toolUseId: string };

/** Apply anywhere a PendingDecision reaches a client (spec Testing note: the wire must never leak the
 *  internal spelling). */
export function toWireDecision(entry: PendingDecision): WireDecision {
  const { toolUseID, ...rest } = entry;
  return { ...rest, toolUseId: toolUseID };
}

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

  /** M3 §1b: park a VIEW of a decision the HOST is holding (fleet threads). It joins the same registry a
   *  local park does, so `decision/list` lists it and `decision/requested` announces it exactly as before
   *  — but the promise it parks belongs to nobody here: the host owns the answer, and `decision/respond`
   *  forwards to the host's `answer` op (Task 8), with view removal driven by the host's own
   *  `decision_settled`. The `unattended` deny rule is deliberately NOT consulted: that rule decides
   *  whether THIS server answers on an absent human's behalf, and a fleet park is not ours to answer —
   *  denying it locally would hide a decision the host stays blocked on regardless. The `closed` latch
   *  still holds, for the reason it holds everywhere else: nothing may park into a torn-down thread. */
  parkView(threadId: string, entry: PendingDecision): void {
    if (this.closed) return;
    // Through the same `park()` the broker uses, so the view is a real PendingDecision with real
    // registry semantics; its `sessionId` is the threadId, matching every locally-parked entry on this
    // wire (a client must not have to tell two spellings of the same field apart by origin). `signal` is
    // the one PermissionRequest member a view has no counterpart for — park() reads it optionally.
    void this.inner.brokerFor(threadId).request(entry as unknown as PermissionRequest);
    const parked = this.inner.list().find((e) => e.toolUseID === entry.toolUseID);
    if (!parked) return;
    // The HOST's park time, not this mirror's. `createdAt` is the one PendingDecision field a
    // PermissionRequest has no counterpart for, so `park()` stamps its own — which would date every view
    // from the attach instead of from the park, and a decision the host has been blocked on for an hour
    // would reach every client reading brand new. Written onto the registered entry, which `list()` hands
    // back by reference; every other field survives the trip unchanged (the two vocabularies are 1:1).
    parked.createdAt = entry.createdAt;
    this.emit({ type: "requested", entry: parked });
  }

  /** M3 §1b: the HOST settled a decision this thread holds a view of (`decision_settled` — whoever won,
   *  this server's own `decision/respond` included). The ONLY path that removes a view: the respond path
   *  forwards and nothing more, so one settlement produces exactly one `decision/resolved`, carrying the
   *  `by` the host reported rather than two stories about who answered.
   *
   *  Deliberately NOT `respond()`: there is no kind to check (the host already took the answer), no `by`
   *  to stamp on this server's own authority, and nothing to refuse — this is a REPORT of a settlement,
   *  not a request to make one. A settle naming a decision no view was ever parked for settles nothing and
   *  announces nothing: a `decision/resolved` for a `decision/requested` no client here ever heard is an
   *  unpaired event. */
  settleView(toolUseID: string, by: string, outcome: DecisionOutcome): void {
    if (!this.inner.respond(toolUseID, outcome)) return;
    this.settledBy.set(toolUseID, by);
    this.emit({ type: "resolved", toolUseID, by, outcome });
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

  /** M3 §1f: teardown's silent twin, for a registry that holds VIEWS. Same latch, same settle of the
   *  underlying promises — but NOTHING is announced, because nothing was decided. A view's decision lives
   *  on the host: on a detach the host is still holding it and still blocked on it, and on a socket death
   *  this server cannot tell whether the host died with it. `decision/resolved {by:"system",
   *  answer:{kind:"deny"}}` in either case reports a denial no human gave and no engine performed, which
   *  an audit-logging client records as fact and a UI renders as an answered prompt.
   *
   *  The promises are still settled (`denyAll`) rather than abandoned: `parkView` voids them, so nothing
   *  here awaits one, but leaving them pending would keep every view's resolver alive for the life of the
   *  process. Which is also why this is not `teardown()`'s job with a flag — the two differ only in the
   *  emit, and the emit is the whole distinction worth naming. */
  discard(): void {
    this.closed = true;
    this.inner.denyAll();
  }

  /** M3 §4 (`thread/reopen`): the settle loop WITHOUT the latch — the registry survives, and the very next
   *  request parks for real. That is the whole distinction from `teardown()` below, and it is what makes
   *  this usable mid-life: the broker a reopen would otherwise close is the SAME object `record.config`
   *  carries onto the replacement engine, so latching here would auto-deny every tool call the recovered
   *  thread ever makes, with nothing on the wire saying why.
   *
   *  Settling is not optional cleanup. An engine that died left its parks awaited by a read loop that has
   *  already ended, so nothing will ever consume the answer — but the entries still list on the wire, still
   *  count toward `status.waitingOn`, and still refuse a later `thread/rewind`/`thread/clear`. And once the
   *  thread has a live engine again they become reachable in the WRONG direction: `decision/respond` has
   *  side channels keyed on the record rather than on the engine (server.ts's `armPlanUpgrade` and
   *  `abortTurn`), so answering a ghost would move the replacement's permission mode or interrupt its turn.
   *
   *  `deny` + `by:"system"` is the honest reading here, unlike on `discard()`'s fleet detach: this server
   *  owned these promises, no human answered them, and the tool call they gated is gone with its engine. */
  reset(): void {
    for (const entry of this.inner.denyAll()) {
      this.settledBy.set(entry.toolUseID, "system");
      this.emit({ type: "resolved", toolUseID: entry.toolUseID, by: "system", outcome: { kind: "deny" } });
    }
  }

  /** Deny + settle everything still parked (thread close) — denyAll() bypasses respond()'s own emit, so
   *  `reset()` above is the one place that emits for it (mirrors PendingDecisions.denyAll's documented
   *  contract). Teardown is exactly that loop plus the `closed` latch; the two share the loop so a change
   *  to what a settled entry announces cannot apply to one path and not the other. */
  teardown(): void {
    this.closed = true;
    this.reset();
  }
}
