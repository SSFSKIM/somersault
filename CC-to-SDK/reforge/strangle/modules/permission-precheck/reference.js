// PARITY LAYER (§2.5 `reference`) — the permission decision every headless tool
// call actually gets (upstream `Aon`, 2.1.251, chunk-fy12d89p).
//
// THE MOST-EXECUTED FUNCTION THIS WAVE OWNS. One call site — the mode-aware
// decision body — and that body runs on every tool call in every mode, so this
// runs whenever the engine decides anything. It is also the function the
// campaign spec was WRONG about, and the correction is worth stating plainly:
//
//   THE BYPASS MODE DOES NOT SHORT-CIRCUIT THE RULE ENGINE. `bypassPermissions`
//   is checked near the END of this body, after the deny rules, after the allow
//   rules, after the tool's own `checkPermissions`, after the ask rules and
//   after the interaction and MCP-ceiling checks. The scout and the spec both
//   read the Bash tool's mode handler ("Bypass mode is handled in main
//   permission flow") as a short-circuit for the whole chain; it is a
//   short-circuit for the ASK, and only for the ask. A deny rule still bites in
//   bypass mode, and the twenty-two bypass scenarios in the corpus therefore
//   exercise most of this body rather than none of it.
//
// THE ORDER IS THE POLICY, and it reads as a ladder of decreasing authority:
//
//   0  an ABORTED context throws before anything is decided.
//   1  a DENY RULE on the tool itself. Its message is built inline, not by the
//      message builder — the only permission sentence in the subsystem that is.
//   2  a DENY RULE on the input. Different message, built by a port.
//   3  an ALLOW RULE, delegated to the allow-rule decision — which, as that
//      module's header says, still lets the tool deny or ask. Two conditions can
//      SUPPRESS the delegation: a sandboxed auto-allowable Bash call that the
//      sandbox has not confirmed, and an MCP-server-policy rule reaching a
//      remote session already in bypass mode.
//   4  the TOOL'S OWN check, with the plan-mode MCP override layered on top of
//      its answer inside the same `try`.
//   5  a tool DENY wins outright.
//   6  an ASK RULE. It either annotates an existing ask or creates one.
//   7  a tool that REQUIRES USER INTERACTION.
//   8  an ask the user's own ask rule drove, kept as-is.
//   9  an MCP server's ask CEILING.
//  10  the SAFETY FLOOR — the one thing bypass mode may not override, and the
//      condition is asymmetric: under bypass only a bypass-immune safety check
//      holds, while outside it any safety check, a sandbox override or a
//      plan-mode floor does.
//  11  BYPASS or plan-with-bypass-available allows.
//  12  a WHOLE-TOOL ALLOW RULE allows, unless the tool opts out, unless a chrome
//      classifier floor applies, unless the rule is scoped away from this input.
//  13  otherwise a passthrough becomes an ask, and a suggestion list is logged.
//
// THE PLAN-MODE MCP OVERRIDE IS INSIDE THE ASSIGNMENT. Upstream writes
// `if (A = await tool.checkPermissions(...), <five more conditions>) A = {...}`
// — the assignment is the first operand of the `if`, so the tool's answer lands
// in `A` and is then read by the very condition that may replace it. Written out
// here as a statement followed by an `if`, which is the same evaluation order.
//
// `updatedInput` ON BOTH ALLOW ARMS COMES FROM A PORT, not from the raw input:
// the tool's own check may have rewritten it, and the port picks the rewrite
// when there is one. An allow that returned the raw input would silently discard
// a tool's normalisation.
//
// OPTIONAL CALLS ARE WRITTEN AS `!= null &&`. `strangle/branches.ts` refuses
// `f?.()` by name, because wrapping the callee to record it detaches the method
// from its receiver. The loose null test is `?.()`'s exact semantics.
//
// TWO OWNED PURE HELPERS, `isAskRuleDrivenReason` and `findSafetyCheckReason`,
// are used here and shipped by this wave; upstream's copies keep fifteen and
// four other callers respectively, so they stay live and are graded against
// these in `strangle/permissions-parity.test.ts` before this body is built on
// them (C7's rule: never bind an upstream body to the implementation it grades).
import { isAskRuleDrivenReason } from "../shared/ask-rule-reason.js";
import { findSafetyCheckReason } from "../shared/safety-check-reason.js";

/**
 * @param tool     the tool being decided
 * @param input    its raw input
 * @param context  the permission context, already carrying this call's toolUseId
 * @param options  caller options (`crashIsObjection`, `hookUpdatedInput`)
 */
export async function permissionPrecheck(
  tool,
  input,
  context,
  options,
  AbortError,
  toolPermissionContext,
  matchedToolDenyRule,
  matchedInputRule,
  matchedToolAllowRule,
  denyRuleMessage,
  permissionMessage,
  allowRuleDecision,
  classifyToolError,
  bashToolName,
  sandbox,
  bashAutoAllowable,
  sandboxConfirmed,
  env,
  featureGate,
  effectiveMode,
  isReadOnlyMcpInput,
  toolIdentity,
  organizationAskReason,
  bypassImmuneSafetyCheck,
  isPlanModeFloor,
  resolvedInput,
  wholeToolAllowRule,
  isChromeTool,
  chromeClassifierApplies,
  ruleScopedAway,
  log,
  stringify,
) {
  if (context.abortController.signal.aborted) throw new AbortError();
  const permissions = toolPermissionContext(context);

  const toolDeny = matchedToolDenyRule(permissions, tool);
  if (toolDeny) {
    return {
      behavior: "deny",
      decisionReason: { type: "rule", rule: toolDeny },
      message: `Permission to use ${tool.name} has been denied.`,
    };
  }
  const inputDeny = matchedInputRule(permissions, tool, input, "deny");
  if (inputDeny) return { behavior: "deny", decisionReason: { type: "rule", rule: inputDeny }, message: denyRuleMessage(tool.name, inputDeny) };

  const allowRule = matchedToolAllowRule(permissions, tool);
  if (allowRule) {
    const sandboxable =
      tool.name === bashToolName &&
      context.forRemoteExecution !== true &&
      sandbox.isSandboxingEnabled() &&
      sandbox.isAutoAllowBashIfSandboxedEnabled() &&
      bashAutoAllowable(input);
    const confirmed = sandboxable && sandboxConfirmed(permissions);
    const awaitingSandbox = sandboxable && !confirmed;
    const remotePolicyExempt =
      allowRule.source === "mcpServerPolicy" &&
      env.CLAUDE_CODE_REMOTE &&
      effectiveMode(tool, permissions) === "bypassPermissions" &&
      featureGate("tengu_mcp_server_policy_bypass_exempt", true);
    if (!awaitingSandbox && !remotePolicyExempt) return allowRuleDecision(tool, input, context, allowRule);
  }

  let decision = { behavior: "passthrough", message: permissionMessage(tool.name) };
  try {
    const parsed = tool.inputSchema.parse(input);
    decision = await tool.checkPermissions(parsed, context);
    if (
      tool.mcpInfo &&
      !tool.isReadOnly(parsed) &&
      decision.behavior === "passthrough" &&
      toolPermissionContext(context).mode === "plan" &&
      !isReadOnlyMcpInput(toolIdentity(tool), parsed)
    ) {
      decision = { behavior: "ask", message: `Cannot call ${tool.name} while in plan mode.`, decisionReason: { type: "mode", mode: "plan" } };
    }
  } catch (error) {
    const classified = classifyToolError(error, tool, input, context);
    if (classified !== undefined) decision = classified;
  }
  if (decision?.behavior === "deny") return decision;

  const askRule = matchedInputRule(permissions, tool, input, "ask");
  if (askRule) {
    return decision?.behavior === "ask"
      ? { ...decision, matchedAskRule: askRule }
      : { behavior: "ask", decisionReason: { type: "rule", rule: askRule }, message: permissionMessage(tool.name) };
  }
  if (tool.requiresUserInteraction != null && tool.requiresUserInteraction()) {
    return decision?.behavior === "ask"
      ? decision
      : { behavior: "ask", message: permissionMessage(tool.name), decisionReason: { type: "other", reason: "requiresUserInteraction" } };
  }
  if (decision?.behavior === "ask" && isAskRuleDrivenReason(decision.decisionReason)) return decision;
  if (tool.mcpInfo?.effectiveMaxPermission === "ask") {
    const reason = { type: "other", reason: organizationAskReason };
    return { behavior: "ask", message: permissionMessage(tool.name, reason), decisionReason: reason };
  }

  const current = toolPermissionContext(context);
  const mode = effectiveMode(tool, current);
  const bypassing =
    mode === "bypassPermissions" || (mode === "plan" && current.isBypassPermissionsModeAvailable && context.forRemoteExecution !== true);
  const immuneCheck = bypassing && decision?.behavior === "ask" ? findSafetyCheckReason(decision.decisionReason, bypassImmuneSafetyCheck) : undefined;
  if (
    decision?.behavior === "ask" &&
    (immuneCheck ||
      (!bypassing &&
        (findSafetyCheckReason(decision.decisionReason) ||
          decision.decisionReason?.type === "sandboxOverride" ||
          isPlanModeFloor(decision.decisionReason))))
  ) {
    return decision;
  }
  if (bypassing) return { behavior: "allow", updatedInput: resolvedInput(decision, input), decisionReason: { type: "mode", mode } };

  const wholeTool = wholeToolAllowRule(toolPermissionContext(context), tool);
  if (
    wholeTool &&
    !(tool.ignoresWholeToolAllowRule != null && tool.ignoresWholeToolAllowRule(input) === true) &&
    !(isChromeTool(toolIdentity(tool)) && (chromeClassifierApplies(toolIdentity(tool)) || toolPermissionContext(context).chromeClassifierFloorEnabled === true)) &&
    !ruleScopedAway(wholeTool, tool, input, mode)
  ) {
    return { behavior: "allow", updatedInput: resolvedInput(decision, input), decisionReason: { type: "rule", rule: wholeTool } };
  }

  const answer =
    decision.behavior === "passthrough"
      ? { ...decision, behavior: "ask", message: permissionMessage(tool.name, decision.decisionReason) }
      : decision;
  if (answer.behavior === "ask" && answer.suggestions) log(`Permission suggestions for ${tool.name}: ${stringify(answer.suggestions, null, 2)}`);
  return answer;
}
