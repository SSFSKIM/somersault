// SABOTAGE LAYER (§2.5) — the modern contract read ONE LEVEL TOO HIGH.
//
// This twin keeps the legacy flat contract exactly (`continue`, `decision`,
// `systemMessage`, `terminalSequence`, `reason`) and then reads the MODERN
// fields off the document itself rather than out of `hookSpecificOutput`. The
// nesting is the only thing it gets wrong, so it looks like a complete
// interpreter and every field name in it is a real field name.
//
// It is the mistake this function is actually shaped to invite. The two
// contracts share a vocabulary — `decision`, `reason`, `permissionDecision`,
// `updatedInput` all exist at BOTH levels with different meanings, and the
// legacy `reason` is read by the nested arms — so "flatten it, the fields are
// the same" is a simplification a wave under time pressure reaches for and one
// no type in the bundle contradicts.
//
// It is chosen LOUD rather than subtle, which is the doctrine C9's five inert
// twins established and `hook-stderr-tail` restated: a twin observable only on
// the rarer input fails in the quiet direction. Every hook that answers with a
// `hookSpecificOutput` — which is every hook in the corpus that says anything
// at all — loses its answer here. The injected context never reaches the model,
// a PermissionRequest hook's deny never takes, and a rewritten tool input is
// never rewritten.
//
// The subtler mutants live in `strangle/hooks-parity.test.ts` as `mustDiffer`
// controls, one per behaviour family: the truthiness guard that erases
// present-but-undefined, the PreToolUse reason overwrite made conditional, the
// pre-pass throw softened to a fallthrough, the MCP suppression flag dropped,
// and the blocking attachment built as a success one.
export function hookJsonContract(
  { json, command, hookName, toolUseID, hookEvent, expectedHookEvent, stdout, stderr, exitCode, durationMs },
  sanitizeTerminalSequence,
  logDebug,
  stringify,
  probeMcpRewrite,
  hookMessage,
) {
  const result = {};

  if (json.continue === false) {
    result.preventContinuation = true;
    if (json.stopReason) result.stopReason = json.stopReason;
  }

  if (json.decision) {
    switch (json.decision) {
      case "approve":
        result.permissionBehavior = "allow";
        break;
      case "block":
        result.permissionBehavior = "deny";
        result.blockingError = { blockingError: json.reason || "Blocked by hook", command };
        break;
      default:
        throw Error(`Unknown hook decision type: ${json.decision}. Valid types are: approve, block`);
    }
  }

  if (json.systemMessage) result.systemMessage = json.systemMessage;

  if (json.terminalSequence) {
    const sanitized = sanitizeTerminalSequence(json.terminalSequence);
    if (sanitized !== null) result.terminalSequence = sanitized;
    else {
      logDebug(
        `Hook ${hookName} (${hookEvent}) returned a terminalSequence that was rejected by the allowlist ` +
          `(only OSC 0/1/2/9/99/777 and BEL are permitted, and OSC 9 bodies may not begin with a digit ` +
          `unless in the 9;4 progress form)`,
      );
    }
  }

  // …and here the level is lost: `json` where the contract says
  // `json.hookSpecificOutput`.
  if (json.permissionDecision) {
    switch (json.permissionDecision) {
      case "allow":
        result.permissionBehavior = "allow";
        break;
      case "deny":
        result.permissionBehavior = "deny";
        result.blockingError = { blockingError: json.permissionDecisionReason || json.reason || "Blocked by hook", command };
        break;
      case "ask":
        result.permissionBehavior = "ask";
        break;
      case "defer":
        result.permissionBehavior = "defer";
        break;
      default:
        throw Error(
          `Unknown hook permissionDecision type: ${json.permissionDecision}. Valid types are: allow, deny, ask, defer`,
        );
    }
  }

  if (result.permissionBehavior !== undefined && json.reason !== undefined) {
    result.hookPermissionDecisionReason = json.reason;
  }

  if (expectedHookEvent && json.hookEventName !== undefined && json.hookEventName !== expectedHookEvent) {
    throw Error(
      `Hook returned incorrect event name: expected '${expectedHookEvent}' but got '${json.hookEventName}'. ` +
        `Full stdout: ${stringify(json, null, 2)}`,
    );
  }

  result.additionalContext = json.additionalContext;
  if (json.updatedInput) result.updatedInput = json.updatedInput;
  if (json.updatedToolOutput !== undefined) result.updatedToolOutput = json.updatedToolOutput;
  if (json.updatedMCPToolOutput) {
    probeMcpRewrite(json.updatedToolOutput !== undefined);
    result.updatedMCPToolOutput = json.updatedMCPToolOutput;
  }

  return {
    ...result,
    message: result.blockingError
      ? hookMessage({ type: "hook_blocking_error", hookName, toolUseID, hookEvent, blockingError: result.blockingError })
      : hookMessage({
          type: "hook_success",
          hookName,
          toolUseID,
          hookEvent,
          content: "",
          stdout,
          stderr,
          exitCode,
          command,
          durationMs,
        }),
  };
}
