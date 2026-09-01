// PARITY LAYER (§2.5 `reference`) — the PermissionDenied hook dispatcher
// (upstream `VNt`, 2.1.251, chunk-fy12d89p).
//
// `Tee`'s counterpart on the other side of the decision. PermissionRequest asks
// whether a tool call may proceed; this one reports that one was refused — and
// it reports for exactly one KIND of refusal, which is why the event sat OPEN
// through two waves. Its sole call site is guarded on the denial's
// `decisionReason` being `{type:"classifier", classifier:"auto-mode"}`, so a rule
// denial, a mode denial and a host denial all pass it by. C8 armed both hook
// paths on an ordinary broker deny and measured the event dead while the denial
// itself reached the transcript by another route.
//
// The condition that DOES create it is the auto-mode classifier's fail-closed
// arm: when the classifier's own API call is unavailable, upstream denies with
// that reason rather than guessing, and this dispatcher runs.
//
// Three things set it apart from its siblings:
//
//   the RETRY channel. Its caller reads `retry` off the yielded results and, if
//       any hook asks for one, appends a companion message inviting another
//       attempt. It is the only dispatcher in the family whose results steer the
//       turn rather than annotate it, and the only one whose silence is
//       therefore invisible in the record but visible in the conversation.
//   `reason` in the record. The denial's own sentence travels to the hook. No
//       other event carries one.
//   the tool-use id TWICE. It is in the record as `tool_use_id` and in the
//       executor request as `toolUseID`. `Tee` puts it only in the request and
//       spends the record field on `permission_suggestions` instead — so the two
//       neighbours differ in what they tell a hook about the same call.
//
// It shares the REGISTRATION GUARD with the PostToolBatch dispatcher, including
// the fan-out agent ids (`shared/hook-agent-context.js`, owned there): a session
// with no PermissionDenied hook returns before building anything, which is the
// common case on every session in the world.
//
// Ports (nothing behind them is owned by this wave):
//   hasHookForEvent(event, registry, agentIds) -> boolean   reads the settings
//       layers and the session registry.
//   createBaseHookInput(session, cwd, permissionMode, context)  the common prefix
//       — FOUR arguments, so this record carries the dispatching context's agent
//       id, agent type and effort.
//   cwd() -> string                    the working directory.
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the `timeoutMs` parameter
//       default (§2.4 `primitive`, equality-asserted by the adapter).
import { hookAgentIds } from "../shared/hook-agent-context.js";

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* permissionDeniedHooks(
  toolName,
  toolUseId,
  toolInput,
  reason,
  toolUseContext,
  permissionMode,
  signal,
  timeoutMs,
  hasHookForEvent,
  createBaseHookInput,
  cwd,
  executeHooks,
) {
  if (
    !hasHookForEvent(
      "PermissionDenied",
      toolUseContext.sessionHooksRegistry,
      hookAgentIds(toolUseContext, "PermissionDenied", toolUseContext.session.id),
    )
  ) {
    return;
  }
  const hookInput = {
    ...createBaseHookInput(toolUseContext.session, cwd(), permissionMode, toolUseContext),
    hook_event_name: "PermissionDenied",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
    reason,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — the caller consumes the
  // yielded results and never reads the return — and only the parity oracle does.
  yield* executeHooks({
    session: toolUseContext.session,
    hookInput,
    toolUseID: toolUseId,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
  });
}
