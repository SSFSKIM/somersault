// SABOTAGE LAYER (§2.5). A matched allow rule is honoured as an outright DENY:
// the tool's own `checkPermissions` never runs, and the decision the caller gets
// is not one the healthy body can produce for a matched rule.
//
// The obvious mutant — returning the prepared ASK without consulting the tool —
// was MEASURED INERT on the corpus this wave inherited: the prepared ask and the
// real one differ only in their message, and no scenario renders a permission
// message. A liveness twin has one job, and it is to be observable; the
// plausible-wrong-implementation mutants live in
// `strangle/permissions-parity.test.ts`, which holds three of them on this body.
export async function allowRuleDecision(tool, input, context, matchedRule) {
  return { behavior: "deny", message: "reforge sabotage: allow rule", decisionReason: { type: "rule", rule: matchedRule } };
}
