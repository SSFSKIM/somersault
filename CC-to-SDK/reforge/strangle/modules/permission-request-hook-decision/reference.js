// PARITY LAYER (§2.5 `reference`) — what a PermissionRequest hook is allowed to
// decide (upstream `Ae`, 2.1.251, chunk-g1qrzvef).
//
// THE OTHER RACER. On the headless seam every `ask` starts two things at once:
// the `can_use_tool` control_request to the SDK host, and this — a dispatch of
// the PermissionRequest hooks. Whichever answers first wins, and this one runs
// on EVERY ask whether or not a hook is registered, which is what makes it live
// on the corpus's broker scenarios rather than only on the hook one.
//
// WITH NO HOOK REGISTERED IT RETURNS UNDEFINED, and the caller reads that as
// "no opinion" and waits for the host. That is the common case in production and
// it is the arm the differential oracle grades, because a run with no hook
// registered produces the same recording as one where this was never called —
// C8's "unrecordable by construction" family, one subsystem over.
//
// THE STREAM IS CONSUMED UNTIL THE FIRST DECISIVE RESULT. A hook that yields
// `{continue: true}`, or a `permissionRequestResult` that is neither allow nor
// deny, is skipped and the loop keeps reading; the first allow or deny returns.
// So a later hook cannot overturn an earlier one, and a hook that abstains does
// not end the dispatch.
//
// AN ALLOW IS NOT THE END OF THE DECISION — THREE THINGS CAN STILL OVERTURN IT:
//
//   a REWRITTEN INPUT is re-checked against the rules. A hook that allows with
//     `updatedInput` has effectively proposed a different tool call, so the rule
//     engine runs again on the new input. If that re-check objects, the hook's
//     allow is replaced: an `ask` becomes a DENY (there is no one to ask — the
//     hook already answered) carrying the re-check's own reason or, failing
//     that, the headless async-agent reason; anything else is passed through
//     with the ask-path stamp. This is the deny-rule-beats-hook-allow rule, and
//     it is the reason this module has an edge to the rule checker.
//   a tool that REQUIRES USER INTERACTION cannot be satisfied by a hook, unless
//     the hook's rewritten input is what satisfies it. `undefined` here is not a
//     decision — it hands the question back to the host.
//   the hook's UPDATED PERMISSIONS are filtered by the tool's own suppression
//     before being applied, and are AWAITED into storage rather than
//     fire-and-forget: a hook-granted permission that failed to persist would
//     silently un-grant itself on the next session.
//
// `permanent` IS COMPUTED FROM THE DESTINATIONS, not from the hook's say-so:
// true only when at least one applied update targets a persisted scope. The
// caller logs on it, so a hook writing a session-scoped grant is recorded as a
// temporary decision even though it wrote something.
//
// THE DENY ARM IS THE `else` OF THE ALLOW TEST, so it also catches a
// `permissionRequestResult` whose behavior is neither — the loop guard already
// narrowed it to allow-or-deny, which is why upstream can write it as an else.
// It defaults the message, stamps the ask-path location, and carries the hook's
// `interrupt` flag out for the caller to act on.

/**
 * @param tool                 the tool being decided
 * @param toolUseId            this call's id
 * @param input                the tool's input
 * @param context              the permission context
 * @param suggestions          the permission suggestions offered to the hook
 * @param toolPermissionContext port — reads the context's current mode
 * @param dispatchHooks        port — the PermissionRequest dispatcher (W5 owns it)
 * @param guardHookUpdatedInput port — narrow a re-check result to an objection
 * @param checkRules           port — the rule-based re-check for a rewritten input
 * @param headlessDenyReason   primitive — the reason a headless rewrite-deny carries
 * @param interactionSatisfied port — does the rewritten input satisfy a tool needing interaction?
 * @param withoutRemoteScope   port — drop grants a remote scope must not receive
 * @param applySessionUpdates  port — merge updates into the session permission context
 * @param persistUpdates       port — write them through to storage
 * @param isPersistedDestination port — does this update's destination outlive the session?
 */
export async function permissionRequestHookDecision(
  tool,
  toolUseId,
  input,
  context,
  suggestions,
  toolPermissionContext,
  dispatchHooks,
  guardHookUpdatedInput,
  checkRules,
  headlessDenyReason,
  interactionSatisfied,
  withoutRemoteScope,
  applySessionUpdates,
  persistUpdates,
  isPersistedDestination,
) {
  const mode = toolPermissionContext(context).mode;
  const dispatch = dispatchHooks(tool.name, toolUseId, input, context, mode, suggestions, context.abortController.signal);
  for await (const frame of dispatch) {
    if (frame.permissionRequestResult && (frame.permissionRequestResult.behavior === "allow" || frame.permissionRequestResult.behavior === "deny")) {
      const result = frame.permissionRequestResult;
      if (result.behavior === "allow") {
        const resolvedInput = result.updatedInput || input;
        if (result.updatedInput) {
          const objection = guardHookUpdatedInput(
            await checkRules(tool, resolvedInput, { ...context, toolUseId }, { hookUpdatedInput: result.updatedInput }),
            tool.name,
          );
          if (objection) {
            return {
              decision:
                objection.behavior === "ask"
                  ? {
                      behavior: "deny",
                      message: objection.message,
                      decisionReason: objection.decisionReason ?? headlessDenyReason,
                      decideLocation: "ask-path",
                    }
                  : { ...objection, decideLocation: "ask-path" },
              interrupt: false,
              permanent: false,
            };
          }
        }
        if (!interactionSatisfied(tool, result.updatedInput) && tool.requiresUserInteraction != null && tool.requiresUserInteraction()) {
          return undefined;
        }
        const updates =
          tool.suppressesAllPermissionUpdates != null && tool.suppressesAllPermissionUpdates(input) === true
            ? withoutRemoteScope(result.updatedPermissions ?? [])
            : result.updatedPermissions ?? [];
        if (updates.length > 0) {
          context.setSessionToolPermissionContext((previous) => applySessionUpdates(previous, updates));
          await persistUpdates(updates, context.storageV5);
        }
        return {
          decision: {
            behavior: "allow",
            updatedInput: resolvedInput,
            userModified: false,
            decisionReason: { type: "hook", hookName: "PermissionRequest" },
          },
          interrupt: false,
          permanent: updates.some((u) => isPersistedDestination(u.destination)),
        };
      }
      return {
        decision: {
          behavior: "deny",
          message: result.message || "Permission denied by PermissionRequest hook",
          decisionReason: { type: "hook", hookName: "PermissionRequest" },
          decideLocation: "ask-path",
        },
        interrupt: result.interrupt === true,
        permanent: false,
      };
    }
  }
  return undefined;
}
