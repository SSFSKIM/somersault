// PARITY LAYER (§2.5 `reference`) — the SDK host's answer, turned back into an
// engine permission decision (upstream `Vvt`, 2.1.251, chunk-g1qrzvef).
//
// THE HEADLESS SEAM'S RETURN LEG. The SDK spawns the engine with
// `--permission-prompt-tool stdio`, so every `ask` leaves as a `can_use_tool`
// control_request and comes back as whatever the host's `canUseTool` returned.
// This is the only thing between that answer and the tool executor, which makes
// it the point where a host's decision becomes the engine's — and where two of
// the SDK's documented permission features actually happen.
//
// EVERY ANSWER IS STAMPED WITH WHERE IT CAME FROM. The `permissionPromptTool`
// decisionReason names the prompt tool and carries the host's whole result as
// `toolResult`. It is the eleventh decisionReason kind, and the fixture-derived
// axis records it as the one kind upstream's message builder RENDERS but nothing
// else CONSTRUCTS — because it is built here, as a whole object, rather than
// assigned to a `decisionReason:` key anywhere.
//
// THE ALLOW ARM DOES THREE THINGS, and each is a documented SDK feature:
//
//   updatedPermissions  the host's requested permission updates are FILTERED
//                       (remote scope, whole-tool grants the tool suppresses)
//                       and then applied to the session AND persisted. The
//                       persist is fire-and-forget with its own error sink, so
//                       a storage failure cannot fail the tool call.
//   updatedInput        "approve with edits". Empty is not the same as absent:
//                       an `updatedInput` with no keys falls back to the
//                       engine's own last-known input rather than writing an
//                       empty object into the tool. That is the difference
//                       between a host saying "run it as-is" and a host saying
//                       "run it with nothing".
//   the spread order    `{...answer, updatedInput, decisionReason}` — the host's
//                       own `updatedInput` is OVERWRITTEN by the resolved one,
//                       so the fallback cannot be undone by key order.
//
// THE DENY ARM CARRIES `interrupt`, and it is the SDK's abort channel: a deny
// with `interrupt: true` logs and aborts the whole turn, not just the tool. The
// `&&` short-circuits, so a plain deny neither logs nor aborts.
//
// BOTH NON-ALLOW PATHS FALL THROUGH TO THE SAME RETURN, which is why the deny
// arm's abort happens on the way past rather than in a branch of its own — an
// interrupting deny and an ordinary one produce the same decision object, and
// only the abort distinguishes them.
//
// `decideLocation: "ask-path"` is the counterpart of the `"pre-ask"` stamp the
// chain's deny-stamping link applies (`permission-decision`, C5x's spike): every
// decision in this subsystem records which side of the ask it was made on, and
// the two stamps are the whole vocabulary.

/**
 * @param answer              the host's `canUseTool` result
 * @param promptTool          the tool the prompt was issued for (names the decisionReason)
 * @param input               the engine's own input for the call
 * @param context             the permission context
 * @param inputTool           the tool whose last-known input is the fallback
 * @param suppressAlwaysAllow whether the caller asked for whole-tool grants to be stripped
 * @param filterPermissionUpdates port — scope/suppression filter over the host's updates
 * @param applySessionUpdates port — merge updates into the session permission context
 * @param persistUpdates      port — write them through to storage
 * @param lastKnownInput      port — the engine's own input for this tool, as the fallback
 * @param logError            port — the sink the fire-and-forget persist reports to
 * @param log                 port — the engine log the deny+interrupt path writes to
 */
export function brokerResponseMap(
  answer,
  promptTool,
  input,
  context,
  inputTool,
  suppressAlwaysAllow,
  filterPermissionUpdates,
  applySessionUpdates,
  persistUpdates,
  lastKnownInput,
  logError,
  log,
) {
  const decisionReason = { type: "permissionPromptTool", permissionPromptToolName: promptTool.name, toolResult: answer };
  if (answer.behavior === "allow") {
    const updates = filterPermissionUpdates(answer.updatedPermissions, inputTool, input, context, suppressAlwaysAllow);
    if (updates?.length) {
      context.setSessionToolPermissionContext((previous) => applySessionUpdates(previous, updates));
      persistUpdates(updates, context.storageV5).catch(logError);
    }
    const updatedInput =
      answer.updatedInput && Object.keys(answer.updatedInput).length > 0 ? answer.updatedInput : lastKnownInput(inputTool.name, input);
    return { ...answer, updatedInput, decisionReason };
  } else if (answer.behavior === "deny" && answer.interrupt) {
    log(`SDK permission prompt deny+interrupt: tool=${promptTool.name} message=${answer.message}`);
    context.abortController.abort();
  }
  return { ...answer, decisionReason, decideLocation: "ask-path" };
}
