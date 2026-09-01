// ADAPTER — the graph-facing seam for the permission pre-check.
//
// Thirty-two arguments: four the callers pass and twenty-eight ports. Two more
// free variables — the ask-rule predicate and the safety-check finder — are
// OWNED (§2.4): the module ships them, uses them in both wirings, and the
// graph's copies are footprinted but never forwarded.
//
// The port count is this row's honest price, and it is the reason the 11.6 KB
// mode-aware body ABOVE this one is a §2.3 deferral rather than a splice.
//
// Two `primitive` captures, asserted on every delegation: the Bash tool name
// (the sandbox arm is Bash-only) and the organisation's ask-ceiling sentence.
import { assertGraphValue } from "./shared/assert.js";
import { BASH_TOOL_NAME } from "./shared/tool-names.js";
import { ORGANIZATION_ASK_REASON } from "./shared/permission-constants.js";
import { permissionPrecheck } from "./permission-precheck/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionPrecheck(
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
    assertGraphValue("permission-precheck", "bashToolName", bashToolName, BASH_TOOL_NAME);
    assertGraphValue("permission-precheck", "organizationAskReason", organizationAskReason, ORGANIZATION_ASK_REASON);
    return permissionPrecheck(
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
      BASH_TOOL_NAME,
      sandbox,
      bashAutoAllowable,
      sandboxConfirmed,
      env,
      featureGate,
      effectiveMode,
      isReadOnlyMcpInput,
      toolIdentity,
      ORGANIZATION_ASK_REASON,
      bypassImmuneSafetyCheck,
      isPlanModeFloor,
      resolvedInput,
      wholeToolAllowRule,
      isChromeTool,
      chromeClassifierApplies,
      ruleScopedAway,
      log,
      stringify,
    );
  },
});
