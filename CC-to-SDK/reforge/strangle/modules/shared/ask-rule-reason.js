// PARITY LAYER (§2.5 `reference`) — "was this ask FORCED by a user's ask rule?"
// (upstream `Ree` / `isAskRuleDrivenReason`, 2.1.251, chunk-fy12d89p).
//
// Six call sites and zero free variables: the whole body is a shape test over a
// decision reason, which is why it is a `pure-helper` the owned modules use in
// both wirings rather than a port. The copies this wave leaves in place have
// callers of their own (the pre-check, the rule checker, the mode-aware decision
// body), so upstream's stays live and the two are compared in
// `strangle/permissions-parity.test.ts`.
//
// WHAT IT DECIDES, AND WHY IT MATTERS. An `ask` that a user's own
// `permissions.ask` rule produced is a different thing from an `ask` the tool
// asked for: the user has stated an intent, so the decision must survive the
// mode arms that would otherwise upgrade an ask into an allow. Every caller
// uses it as a FLOOR.
//
// THE RECURSION IS THE INTERESTING PART. A compound Bash command decomposes into
// per-subcommand results, and the rule may have matched only one of them — so a
// `subcommandResults` reason is ask-rule-driven if ANY of its parts is BOTH
// asking AND itself ask-rule-driven. Both halves are required: a part that asks
// for a different reason does not make the whole rule-driven, and a part with a
// matching rule that is not asking does not either. Nesting is arbitrary
// (subcommands can decompose again), which is why it recurses rather than
// looping once.
//
// `?.` on the reason and `.rule.ruleBehavior` WITHOUT one is upstream's: a
// missing reason is ordinary, a `rule` reason with no `rule` is not.

/**
 * @param reason a decision's `decisionReason`, possibly undefined
 * @returns true when a `permissions.ask` rule is what forced this ask
 */
export function isAskRuleDrivenReason(reason) {
  if (reason?.type === "rule" && reason.rule.ruleBehavior === "ask") return true;
  if (reason?.type === "subcommandResults") {
    for (const part of reason.reasons.values()) {
      if (part.behavior === "ask" && isAskRuleDrivenReason(part.decisionReason)) return true;
    }
  }
  return false;
}
