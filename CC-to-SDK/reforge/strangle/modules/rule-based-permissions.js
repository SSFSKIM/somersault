// ADAPTER — the graph-facing seam for the rule-only permission check.
//
// Nineteen arguments: four the callers pass and fifteen ports. Two further free
// variables — the ask-rule predicate and the safety-check finder — are OWNED
// (§2.4) and do not cross: the module ships them and uses them in both wirings.
//
// Three `primitive` captures, all asserted: the crash reason, the Bash tool name
// (the sandbox arm is Bash-only, so that literal decides which tool gets it) and
// the organisation's ask-ceiling sentence.
import { assertGraphValue } from "./shared/assert.js";
import { BASH_TOOL_NAME } from "./shared/tool-names.js";
import { ORGANIZATION_ASK_REASON, PERMISSION_CHECK_CRASHED_REASON } from "./shared/permission-constants.js";
import { checkRuleBasedPermissions } from "./rule-based-permissions/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  checkRuleBasedPermissions(
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
    assertGraphValue("rule-based-permissions", "crashReason", crashReason, PERMISSION_CHECK_CRASHED_REASON);
    assertGraphValue("rule-based-permissions", "bashToolName", bashToolName, BASH_TOOL_NAME);
    assertGraphValue("rule-based-permissions", "organizationAskReason", organizationAskReason, ORGANIZATION_ASK_REASON);
    return checkRuleBasedPermissions(
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
      PERMISSION_CHECK_CRASHED_REASON,
      BASH_TOOL_NAME,
      sandbox,
      bashAutoAllowable,
      sandboxConfirmed,
      interactionSatisfied,
      ORGANIZATION_ASK_REASON,
    );
  },
});
