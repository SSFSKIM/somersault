// PARITY LAYER (§2.5 `reference`) — find the safety-check reason inside a
// decision reason (upstream `Fy` / `findSafetyCheckReason`, 2.1.251,
// chunk-fy12d89p).
//
// SEVENTEEN call sites, spread over four chunks — the most-called function this
// wave owns — and zero free variables. It is the predicate every mode arm
// consults before it is allowed to upgrade an ask into an allow: a safety check
// is the one objection no permission mode may override, so "is there a safety
// check anywhere in this reason, and does it satisfy my filter?" is asked at the
// pre-check, at the mode-aware body, and three times inside the broker seam.
//
// IT RETURNS THE REASON, NOT A BOOLEAN, and that is load-bearing. Three call
// sites read `.reason` off the result to put it on the wire as the SDK host's
// `decision_reason`, and one reads `.classifierApprovable` to decide whether the
// host may auto-approve. A predicate-shaped reimplementation would compile, pass
// every truthiness test, and lose the payload.
//
// THE FILTER IS A PARAMETER WITH A DEFAULT. `() => true` means "any safety
// check"; callers pass narrower ones — `not classifier-approvable`, and one that
// also excludes a reason a chrome floor has already handled. When a filter
// REJECTS a `safetyCheck` reason the answer is `undefined`, not "keep looking":
// upstream returns `t(e) ? e : void 0` and does not fall through to the
// subcommand walk, because a `safetyCheck` reason has no subcommands to walk.
//
// THREE `undefined` RETURNS, ONE MEANING. Upstream writes `return` (no value)
// for the falsy-reason arm, for a filtered-out safety check, and for the end of
// the function. Written out here as `undefined` for readability; the value on
// the wire is the same in all three.
//
// The recursion mirrors `ask-rule-reason`'s and for the same reason: a compound
// Bash command's objection can be nested arbitrarily deep, and the FIRST match
// in iteration order wins — the loop returns as soon as a nested walk answers,
// so a later part's safety check never displaces an earlier one.

/**
 * @param reason a decision's `decisionReason`, possibly undefined
 * @param accept filter over a candidate safety-check reason; defaults to "any"
 * @returns the matching safety-check reason, or undefined
 */
export function findSafetyCheckReason(reason, accept = () => true) {
  if (!reason) return undefined;
  if (reason.type === "safetyCheck") return accept(reason) ? reason : undefined;
  if (reason.type === "subcommandResults") {
    for (const part of reason.reasons.values()) {
      const found = findSafetyCheckReason(part.decisionReason, accept);
      if (found) return found;
    }
  }
  return undefined;
}
