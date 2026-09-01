// ADAPTER — the graph-facing seam for the allow-rule decision.
//
// Delegation signature:
//   allowRuleDecision(tool, input, context, matchedRule, options,
//                     permissionMessage, classifyToolError, crashReason)
//
// One `primitive` capture (§2.4): the crash reason a tool's unrecognised
// exception is turned into. It reads like a telemetry token and is user-facing
// prose — the message builder renders it into a permission prompt — so a
// rewording upstream is behaviour, and this assertion is what sees it.
import { assertGraphValue } from "./shared/assert.js";
import { PERMISSION_CHECK_CRASHED_REASON } from "./shared/permission-constants.js";
import { allowRuleDecision } from "./allow-rule-decision/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  allowRuleDecision(tool, input, context, matchedRule, options, permissionMessage, classifyToolError, crashReason) {
    assertGraphValue("allow-rule-decision", "crashReason", crashReason, PERMISSION_CHECK_CRASHED_REASON);
    return allowRuleDecision(tool, input, context, matchedRule, options, permissionMessage, classifyToolError, PERMISSION_CHECK_CRASHED_REASON);
  },
});
