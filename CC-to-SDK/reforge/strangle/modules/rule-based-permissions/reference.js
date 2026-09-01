// PARITY LAYER (§2.5 `reference`) — the rules alone, with no mode and no opinion
// of its own (upstream `Gx` / `checkRuleBasedPermissions`, 2.1.251,
// chunk-fy12d89p).
//
// THE PRE-CHECK'S TWIN, AND THE DIFFERENCES ARE THE POINT. Read side by side
// with `permission-precheck`, the two share their first two thirds almost line
// for line and then diverge completely. Four differences, each a decision about
// what this function is FOR:
//
//   IT RETURNS NULL WHEN NOTHING OBJECTS. The pre-check always produces a
//     decision; this produces one only when the rules, the tool or a ceiling
//     say something. `null` means "no rule-based opinion", and every caller
//     treats it as permission to carry on rather than as an allow.
//   IT KNOWS NOTHING ABOUT MODES. No bypass arm, no plan arm, no whole-tool
//     allow arm, no suggestion logging. That is why it can be called from the
//     hook seam and from three other chunks: it answers the same question
//     wherever the session's mode happens to be.
//   IT HAS A CRASH ARM THE PRE-CHECK DOES NOT. When the tool's own check throws
//     and the error classifier does not recognise the error, a caller that
//     passed `crashIsObjection` gets an ASK rather than silence. The pre-check
//     lets the same crash fall through to its passthrough default. Callers that
//     re-check a REWRITTEN input opt in, because a tool that cannot evaluate a
//     hook's rewrite must not thereby approve it.
//   ITS INTERACTION CHECK IS CONDITIONAL. A tool that requires user interaction
//     is exempted when the caller supplied a `hookUpdatedInput` that satisfies
//     it — the port that decides this is the whole reason a PermissionRequest
//     hook can answer for a tool that would otherwise need a human.
//
// THE SANDBOX SUPPRESSION IS ALSO NARROWER. The pre-check suppresses the allow
// rule for an unconfirmed sandboxed Bash call OR for a remote MCP-policy rule;
// this one has only the sandbox half, and it passes the caller's options THROUGH
// to the allow-rule decision (the pre-check does not), so the crash arm reaches
// one level further down.
//
// TWO OWNED PURE HELPERS, `isAskRuleDrivenReason` and `findSafetyCheckReason`,
// are used here and shipped by this wave. Upstream's copies keep their other
// callers, so they stay live, and they are graded against their own upstream
// bytes in `strangle/permissions-parity.test.ts` before this body is built on
// them (C7's rule).
//
// `f?.()` is written `!= null &&`: an optional CALL cannot be branch-recorded
// without detaching the method from its receiver, and the loose null test is its
// exact semantics.
import { isAskRuleDrivenReason } from "../shared/ask-rule-reason.js";
import { findSafetyCheckReason } from "../shared/safety-check-reason.js";

/**
 * @param tool    the tool being decided
 * @param input   its raw input
 * @param context the permission context
 * @param options `crashIsObjection`, `hookUpdatedInput`
 * @returns a decision, or null when no rule has an opinion
 */
export async function checkRuleBasedPermissions(
  tool,
  input,
  context,
  options,
  toolPermissionContext,
  matchedToolDenyRule,
  matchedInputRule,
  matchedToolAllowRule,
  denyRuleMessage,
  permissionMessage,
  allowRuleDecision,
  classifyToolError,
  crashReason,
  bashToolName,
  sandbox,
  bashAutoAllowable,
  sandboxConfirmed,
  interactionSatisfied,
  organizationAskReason,
) {
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
    if (!(sandboxable && !confirmed)) return allowRuleDecision(tool, input, context, allowRule, options);
  }

  let decision = { behavior: "passthrough", message: permissionMessage(tool.name) };
  try {
    const parsed = tool.inputSchema.parse(input);
    decision = await tool.checkPermissions(parsed, context);
  } catch (error) {
    const classified = classifyToolError(error, tool, input, context);
    if (classified !== undefined) {
      decision = classified;
    } else if (options?.crashIsObjection === true) {
      const reason = { type: "other", reason: crashReason };
      return { behavior: "ask", message: permissionMessage(tool.name, reason), decisionReason: reason };
    }
  }
  if (decision?.behavior === "deny") return decision;

  const askRule = matchedInputRule(permissions, tool, input, "ask");
  if (askRule) {
    return decision?.behavior === "ask"
      ? { ...decision, matchedAskRule: askRule }
      : { behavior: "ask", decisionReason: { type: "rule", rule: askRule }, message: permissionMessage(tool.name) };
  }
  if (!interactionSatisfied(tool, options?.hookUpdatedInput) && tool.requiresUserInteraction != null && tool.requiresUserInteraction()) {
    return decision?.behavior === "ask"
      ? decision
      : { behavior: "ask", message: permissionMessage(tool.name), decisionReason: { type: "other", reason: "requiresUserInteraction" } };
  }
  if (decision?.behavior === "ask" && isAskRuleDrivenReason(decision.decisionReason)) return decision;
  if (tool.mcpInfo?.effectiveMaxPermission === "ask") {
    const reason = { type: "other", reason: organizationAskReason };
    return { behavior: "ask", message: permissionMessage(tool.name, reason), decisionReason: reason };
  }
  if (decision?.behavior === "ask" && (findSafetyCheckReason(decision.decisionReason) || decision.decisionReason?.type === "sandboxOverride")) {
    return decision;
  }
  return null;
}
