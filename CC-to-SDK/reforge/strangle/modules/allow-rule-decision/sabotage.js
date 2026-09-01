// SABOTAGE LAYER (§2.5). A matched allow rule stops consulting the tool: the
// prepared ask is returned without ever running `checkPermissions`, so a tool
// that would have denied or asked for its own reason is silently overruled and
// the message the decision carries is wrong. An inert decision, correctly
// shaped, that grades the tool's veto out of the chain.
export async function allowRuleDecision(tool, input, context, matchedRule, options, permissionMessage, classifyToolError, crashReason) {
  return { behavior: "ask", decisionReason: { type: "rule", rule: matchedRule }, message: "reforge sabotage: allow rule" };
}
