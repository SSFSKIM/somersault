// The sentence a permission request is rendered as, owned outright (§2.4
// `pure-helper`) — upstream `ql` / `createPermissionRequestMessage`, 2.1.251,
// chunk-fy12d89p.
//
// OWNED BUT NOT SPLICED, and the manifest records why where its row would be:
// forty-five call sites and it runs on every tool call, so reachability is not
// the question — but on every path a headless corpus can create, the sentence it
// builds is absorbed before it reaches an observable. A splice would be a row
// the gate could not prove live.
//
// WHY THIS IS THE SUBSYSTEM'S HIGHEST-LEVERAGE UNIT. Forty-five call sites
// bundle-wide, and every one of them is a decision explaining ITSELF: the
// pre-check builds `{behavior:"passthrough", message: permissionMessage(name)}`
// before it evaluates anything, every ask arm re-renders with the reason it
// found, and the broker seam puts the result on the wire as the `description`
// the SDK host shows a human. So this function runs on every tool call in every
// mode, including the twenty-two `bypassPermissions` scenarios that reach almost
// nothing else in the chain.
//
// IT IS ALSO THE decisionReason AXIS, WRITTEN OUT. `research/fixtures/
// permission-surface-2.1.251.json` derives eleven kinds from this switch and
// finds ten of them constructed elsewhere in the graph; the eleventh
// (`permissionPromptTool`) is only ever assigned as a whole object, by the
// broker's response mapper — which is another module in this same wave. The
// matrix's third axis is this body's case list.
//
// FIVE THINGS THAT ARE BEHAVIOUR AND NOT STYLE:
//
//   `classifier` IS HANDLED BEFORE THE SWITCH. Its sentence has a different
//     shape (it names the classifier AND the reason in one line), and it is
//     checked first, so a rewrite that folded it into the switch would reorder
//     nothing today and would silently change which branch wins if a future
//     reason type ever collided.
//   `hook` BRANCHES ON WHETHER THE HOOK GAVE A REASON. With one it reads
//     "blocked this action: <reason>"; without one it reads "requires approval
//     for this <tool> command". Two different claims about what happened.
//   `safetyCheck` AND `other` SHARE AN ARM. Upstream writes them as a fallthrough
//     pair returning `reason.reason`; `workingDir` and `asyncAgent` return the
//     same field from arms of their own. Four kinds, one expression, and the
//     duplication is upstream's.
//   THE SUBCOMMAND ARM IS TOOL-SENSITIVE. For Bash it strips redirections from
//     each part (but only when the part HAS redirections — otherwise it keeps
//     the original text, redirection-free by definition); for every other tool
//     it keeps the raw part. Then it pluralizes twice, with different plurals.
//   FALLING OFF THE SWITCH IS AN OUTCOME. Upstream's switch has no `default`, so
//     an unrecognised reason type reaches the same trailing sentence a missing
//     reason does. That is preserved here as an explicit `default: break`,
//     which is the same control flow and the only form the branch inventory can
//     mark (`strangle/branches.ts` refuses a `switch` with no `default`, because
//     the no-match path is an arm of no clause).
//
// PORTS AND WHY. `renderRuleValue`, `renderRuleSource` and `splitRedirections`
// are the rule-parsing and Bash-parsing subsystems' — W6 owns neither, so §2.4
// makes them typed ports and ledger edges rather than pretending they are ours.
// `modeTitle` reads the mode-descriptor table, which is the same shape. Only
// `pluralize` is OWNED: 41 bytes, provably pure, and used throughout the engine,
// so upstream's copy keeps its own callers and the two are graded against each
// other in `strangle/permissions-parity.test.ts`.
import { pluralize } from "../shared/pluralize.js";

/**
 * @param toolName        the tool the request is about, as the user sees it
 * @param reason          the decision's `decisionReason`, or undefined
 * @param renderRuleValue port — `Tool(content)` for a permission rule value
 * @param renderRuleSource port — the human label for a rule's source layer
 * @param splitRedirections port — a Bash command split into command + redirections
 * @param modeTitle       port — the display title of a permission mode
 */
export function permissionMessage(toolName, reason, renderRuleValue, renderRuleSource, splitRedirections, modeTitle) {
  if (reason) {
    if (reason.type === "classifier") {
      return `Classifier '${reason.classifier}' requires approval for this ${toolName} command: ${reason.reason}`;
    }
    switch (reason.type) {
      case "hook":
        return reason.reason
          ? `Hook '${reason.hookName}' blocked this action: ${reason.reason}`
          : `Hook '${reason.hookName}' requires approval for this ${toolName} command`;
      case "rule": {
        const value = renderRuleValue(reason.rule.ruleValue);
        const source = renderRuleSource(reason.rule.source);
        return `Permission rule '${value}' from ${source} requires approval for this ${toolName} command`;
      }
      case "subcommandResults": {
        const parts = [];
        for (const [command, result] of reason.reasons) {
          if (result.behavior === "ask" || result.behavior === "passthrough") {
            if (toolName === "Bash") {
              const { commandWithoutRedirections, redirections } = splitRedirections(command);
              parts.push(redirections.length > 0 ? commandWithoutRedirections : command);
            } else {
              parts.push(command);
            }
          }
        }
        if (parts.length > 0) {
          const n = parts.length;
          return (
            `This ${toolName} command contains multiple operations. ` +
            `The following ${pluralize(n, "part")} ${pluralize(n, "requires", "require")} approval: ${parts.join(", ")}`
          );
        }
        return `This ${toolName} command contains multiple operations that require approval`;
      }
      case "permissionPromptTool":
        return `Tool '${reason.permissionPromptToolName}' requires approval for this ${toolName} command`;
      case "sandboxOverride":
        return "Run outside of the sandbox";
      case "workingDir":
        return reason.reason;
      case "safetyCheck":
      case "other":
        return reason.reason;
      case "mode":
        return `Current permission mode (${modeTitle(reason.mode)}) requires approval for this ${toolName} command`;
      case "asyncAgent":
        return reason.reason;
      default:
        // Upstream's switch has no `default`; an unrecognised type falls out of
        // it and reaches the sentence below. Same control flow, marked.
        break;
    }
  }
  return `Claude requested permissions to use ${toolName}, but you haven't granted it yet.`;
}
