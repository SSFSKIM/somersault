// PARITY LAYER (§2.5 `reference`) — the hook JSON CONTRACT interpreter
// (upstream `Fq`, 2.1.251, chunk-fy12d89p @3016250, 5,993 bytes).
//
// THE WHOLE HOOK PROTOCOL, IN ONE FUNCTION. Everything a hook can say to the
// engine arrives as one parsed JSON document, and this is the only thing that
// reads it. Four call sites in the streaming executor (`Qxt`) — an internal
// callback, an HTTP hook, an MCP hook and a command hook — plus the general
// callback path (`d6n`, whose sole caller is `Qxt` again) all funnel their
// document through here and act on the fields it hands back. So the dispatchers
// W5 owns decide WHICH hooks run; this decides what a hook's answer MEANS.
//
// TWO CONTRACTS, INTERLEAVED, and that is the shape to hold on to. The LEGACY
// one is flat: `continue`, `decision`, `reason`, `systemMessage`,
// `terminalSequence` at the top level. The MODERN one is nested under
// `hookSpecificOutput` and dispatches on its own `hookEventName`, with eighteen
// event arms. They are not alternatives — a single document may use both, they
// are read in a fixed order, and the later read WINS. `permissionBehavior` is
// assigned by the legacy `decision` switch, again by the standalone PreToolUse
// pre-pass, and a third time inside the event switch; `hookPermissionDecisionReason`
// is set from the top-level `reason` and then OVERWRITTEN, unconditionally, by
// the PreToolUse arm's own `permissionDecisionReason` — including with
// `undefined`. Reordering any of that changes behaviour, so the order here is
// upstream's statement order rather than a tidier one.
//
// IT THROWS, ON THREE CONDITIONS, AND THAT IS REPRODUCED RATHER THAN FIXED:
//
//   an unknown legacy `decision` — anything but `approve`/`block`;
//   an unknown PreToolUse `permissionDecision` in the PRE-PASS — anything but
//       allow/deny/ask/defer. Note the asymmetry: the same switch inside the
//       event arm has NO default clause, so the same bad value throws when it
//       arrives with `hookEventName:"PreToolUse"` and is silently ignored when
//       the arm is reached a second time. Two switches, one contract, one
//       guard;
//   an event-name mismatch — a hook that answers `expectedHookEvent` with a
//       different `hookSpecificOutput.hookEventName`. The message embeds the
//       WHOLE document, not just the offending field.
//
// The command, HTTP and MCP call sites sit inside `try`/`catch`. The internal-
// callback fast path does NOT, so a throw there propagates out of the executor
// and into the dispatcher. That is upstream's own asymmetry; an owned copy that
// defended against it would be a different engine.
//
// PRESENT-BUT-UNDEFINED IS A THIRD STATE, and most of the event arms produce it.
// `M.additionalContext = e.hookSpecificOutput.additionalContext` runs whether or
// not the field exists, so a hook that says nothing about context is
// distinguishable from a hook that was never asked — the key is there, holding
// `undefined`. SEVEN of the eighteen case labels do exactly this and nothing
// else — across SIX bodies, because two of them fall through to one — and the
// difference only survives if the assignment stays unconditional. Wrapping
// any of them in a truthiness guard would be invisible to `JSON.stringify` and
// visible to every `in` test downstream.
//
// THE COMMA OPERATORS ARE LOAD-BEARING. Minified, several assignments live
// INSIDE an `if` condition — `if((M.hookPermissionDecisionReason=…, …updatedInput))`
// — so they run unconditionally and only the LAST operand is the test. Read as
// a guard they would look conditional. They are written out here as the
// statements they are.
//
// THE MCP REWRITE HAS A DEAD-PROBE PORT. `updatedMCPToolOutput` is the legacy
// half of a field pair upstream is migrating away from: when it is TRUTHY the
// probe fires (recording whether the modern `updatedToolOutput` was also
// present) and the value is honoured; when it is present but FALSY the rewrite
// is suppressed and a flag says so. `null` and `""` therefore take a different
// path from `undefined`, which is the whole reason the second test is `!== void 0`.
//
// THE TERMINAL SEQUENCE IS FILTERED, NOT TRUSTED. A hook may ask the engine to
// write an escape sequence to the terminal; the allowlist port returns `null`
// for anything outside OSC 0/1/2/9/99/777 and BEL, and a rejection is LOGGED
// rather than raised. So a hook cannot fail a turn by asking for a forbidden
// sequence, and it also cannot tell that it was refused.
//
// EVERY RETURN CARRIES A MESSAGE, and which one is decided by a single field:
// `blockingError` present means the attachment is a `hook_blocking_error` and
// the stdio fields are dropped; absent means `hook_success` with the stdout,
// stderr, exit code, command and duration the executor measured. The spread
// order — `{...result, message}` — puts `message` last on every path.
//
// THE FIVE PORTS ARE ALL §2.4 `effectful-port`, and none of them is owned here.
// The attachment builder mints a uuid and reads a clock; the dead probe reads
// per-host state and emits telemetry; the JSON serialiser opens a trace span;
// the terminal-sequence filter is the head of an unowned parser chain; the log
// is the engine log. Each is a ledger edge to the wave that will own it.

/**
 * @param input.json              the hook's parsed JSON output — the document this reads
 * @param input.command           what produced it (a command line, a URL, or "callback")
 * @param input.hookName          the hook's display name, for the attachment
 * @param input.toolUseID         the tool call the hook was fired around, if any
 * @param input.hookEvent         the event that fired
 * @param input.expectedHookEvent the event the answer must claim, when the caller pins one
 * @param input.stdout            the hook's stdout, as measured by the executor
 * @param input.stderr            its stderr
 * @param input.exitCode          its exit code
 * @param input.durationMs        how long it took (absent on the callback paths)
 * @param sanitizeTerminalSequence port — the OSC/BEL allowlist filter; `null` means rejected
 * @param logDebug                 port — the engine debug log
 * @param stringify                port — the traced `JSON.stringify` the throw message embeds
 * @param probeMcpRewrite          port — the dead-probe telemetry for the legacy MCP rewrite
 * @param hookMessage              port — the attachment builder (mints a uuid, reads a clock)
 * @returns the executor's result fields, plus the `message` attachment
 */
export function hookJsonContract(
  { json, command, hookName, toolUseID, hookEvent, expectedHookEvent, stdout, stderr, exitCode, durationMs },
  sanitizeTerminalSequence,
  logDebug,
  stringify,
  probeMcpRewrite,
  hookMessage,
) {
  const result = {};

  // --- the legacy, flat contract ---------------------------------------------
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

  // --- the PreToolUse PRE-PASS, before the event name is even checked --------
  // The only place an unknown `permissionDecision` throws, and it runs whether
  // or not `expectedHookEvent` agrees with the document.
  if (json.hookSpecificOutput?.hookEventName === "PreToolUse" && json.hookSpecificOutput.permissionDecision) {
    switch (json.hookSpecificOutput.permissionDecision) {
      case "allow":
        result.permissionBehavior = "allow";
        break;
      case "deny":
        result.permissionBehavior = "deny";
        result.blockingError = { blockingError: json.reason || "Blocked by hook", command };
        break;
      case "ask":
        result.permissionBehavior = "ask";
        break;
      case "defer":
        result.permissionBehavior = "defer";
        break;
      default:
        throw Error(
          `Unknown hook permissionDecision type: ${json.hookSpecificOutput.permissionDecision}. Valid types are: allow, deny, ask, defer`,
        );
    }
  }

  // The top-level `reason` becomes the decision reason for whatever behaviour
  // the two passes above settled on — and the PreToolUse arm below overwrites it.
  if (result.permissionBehavior !== undefined && json.reason !== undefined) {
    result.hookPermissionDecisionReason = json.reason;
  }

  // --- the modern, per-event contract ---------------------------------------
  if (json.hookSpecificOutput) {
    const specific = json.hookSpecificOutput;

    if (expectedHookEvent && specific.hookEventName !== expectedHookEvent) {
      throw Error(
        `Hook returned incorrect event name: expected '${expectedHookEvent}' but got '${specific.hookEventName}'. ` +
          `Full stdout: ${stringify(json, null, 2)}`,
      );
    }

    switch (specific.hookEventName) {
      case "PreToolUse":
        if (specific.permissionDecision) {
          // UPSTREAM HAS NO `default` HERE, and that absence is the contract:
          // the standalone pre-pass above already threw on an unknown value, so
          // this switch's no-match path is upstream's own statement that the
          // second read is not a second guard. Written as an if/else chain
          // rather than as a defaultless `switch` because the branch
          // instrumenter refuses one — a no-match path that is an arm of no
          // clause cannot be marked, and §3.1's inventory has to be complete.
          // The chain is behaviourally identical and its final `else` is
          // explicit, which is what makes the no-match path attestable at all.
          const decision = specific.permissionDecision;
          if (decision === "allow") {
            result.permissionBehavior = "allow";
          } else if (decision === "deny") {
            result.permissionBehavior = "deny";
            result.blockingError = {
              blockingError: specific.permissionDecisionReason || json.reason || "Blocked by hook",
              command,
            };
          } else if (decision === "ask") {
            result.permissionBehavior = "ask";
          } else if (decision === "defer") {
            result.permissionBehavior = "defer";
          }
        }
        // Unconditional, and it OVERWRITES the top-level reason above — with
        // `undefined` when the arm carries none.
        result.hookPermissionDecisionReason = specific.permissionDecisionReason;
        if (specific.updatedInput) result.updatedInput = specific.updatedInput;
        result.additionalContext = specific.additionalContext;
        break;

      case "UserPromptSubmit":
        result.additionalContext = specific.additionalContext;
        result.sessionTitle = specific.sessionTitle;
        result.suppressOriginalPrompt = specific.suppressOriginalPrompt;
        break;

      case "UserPromptExpansion":
        result.additionalContext = specific.additionalContext;
        result.suppressOriginalPrompt = specific.suppressOriginalPrompt;
        break;

      case "SessionStart":
        result.additionalContext = specific.additionalContext;
        result.initialUserMessage = specific.initialUserMessage;
        result.sessionTitle = specific.sessionTitle;
        // The only field in the whole function gated on PRESENCE as well as
        // truthiness: a `watchPaths` key that is there and empty is not a
        // request to watch nothing, it is no request at all.
        if ("watchPaths" in specific && specific.watchPaths) result.watchPaths = specific.watchPaths;
        result.reloadSkills = specific.reloadSkills;
        break;

      case "Setup":
        result.additionalContext = specific.additionalContext;
        break;

      case "PreModelSwitch":
        if (specific.permissionDecision) {
          // THREE ARMS, NOT FOUR: a model switch cannot be DEFERRED. And no
          // `default`, for the same reason the PreToolUse arm has none — written
          // as an if/else chain so the no-match path is an explicit clause the
          // branch inventory can carry (§3.1). Here the no-match path is wider
          // than PreToolUse's: `defer` reaches it, so a hook that defers a model
          // switch silently sets no behaviour at all.
          const decision = specific.permissionDecision;
          if (decision === "allow") {
            result.permissionBehavior = "allow";
          } else if (decision === "deny") {
            result.permissionBehavior = "deny";
            result.blockingError = {
              blockingError: specific.permissionDecisionReason || json.reason || "Blocked by hook",
              command,
            };
          } else if (decision === "ask") {
            result.permissionBehavior = "ask";
          }
        }
        // Guarded, unlike PreToolUse's: this arm does not erase the top-level
        // reason when it carries none of its own.
        if (specific.permissionDecisionReason !== undefined) {
          result.hookPermissionDecisionReason = specific.permissionDecisionReason;
        }
        break;

      case "PostModelSwitch":
        result.additionalContext = specific.additionalContext;
        break;

      case "SubagentStart":
        result.additionalContext = specific.additionalContext;
        break;

      case "PostToolUse":
        result.additionalContext = specific.additionalContext;
        result.classifierContext = specific.classifierContext;
        if (specific.updatedToolOutput !== undefined) result.updatedToolOutput = specific.updatedToolOutput;
        if (specific.updatedMCPToolOutput) {
          probeMcpRewrite(specific.updatedToolOutput !== undefined);
          result.updatedMCPToolOutput = specific.updatedMCPToolOutput;
        } else if (specific.updatedMCPToolOutput !== undefined) {
          result.legacyMcpRewriteSuppressed = true;
        }
        break;

      case "PostToolUseFailure":
        result.additionalContext = specific.additionalContext;
        break;

      case "PostToolBatch":
        result.additionalContext = specific.additionalContext;
        break;

      case "Stop":
      case "SubagentStop":
        result.additionalContext = specific.additionalContext;
        break;

      case "PermissionDenied":
        result.retry = specific.retry;
        break;

      case "PermissionRequest":
        if (specific.decision) {
          result.permissionRequestResult = specific.decision;
          // Anything that is not an explicit allow is a deny — there is no
          // third answer a permission hook can give here.
          result.permissionBehavior = specific.decision.behavior === "allow" ? "allow" : "deny";
          if (specific.decision.behavior === "allow" && specific.decision.updatedInput) {
            result.updatedInput = specific.decision.updatedInput;
          }
        }
        break;

      case "Elicitation":
        if (specific.action) {
          result.elicitationResponse = { action: specific.action, content: specific.content };
          if (specific.action === "decline") {
            result.blockingError = { blockingError: json.reason || "Elicitation denied by hook", command };
          }
        }
        break;

      case "ElicitationResult":
        if (specific.action) {
          result.elicitationResultResponse = { action: specific.action, content: specific.content };
          if (specific.action === "decline") {
            result.blockingError = { blockingError: json.reason || "Elicitation result blocked by hook", command };
          }
        }
        break;

      case "MessageDisplay":
        result.displayContent = specific.displayContent;
        break;

      // UPSTREAM HAS NO `default` ON THIS SWITCH EITHER, and the arm is written
      // out here rather than omitted because §3.1's branch inventory has to be
      // complete: a no-match path that is an arm of no clause cannot be marked,
      // so an omitted default is a branch nothing can attest. `default: break`
      // is behaviourally identical to no default in final position, and it makes
      // the path explicit — which matters more than usual here, because the
      // event names arrive from a hook's own JSON and an unrecognised one is a
      // real input rather than a theoretical one.
      default:
        break;
    }
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
