// PARITY LAYER (§2.5 `reference`) — the PostToolUseFailure hook dispatcher
// (upstream `zNt` / `executePostToolUseFailureHooks`, 2.1.251, chunk-fy12d89p).
//
// The OTHER arm of a tool call. Upstream runs the success and error paths
// through two different dispatchers off one call site (`dQ` on the error arm,
// `SL` on the success arm), and they build DIFFERENT records: this one carries
// the error text, the interrupt flag and a duration where its sibling carries a
// tool_response. A corpus whose tools always succeed therefore grades one of the
// two and cannot see the other at all, which is how this event spent a wave
// mistaken for dead (`w5/probe-hook-events.ts`, phase `tool-failure`).
//
// Two things it owns beyond the record's field set:
//
//   the REGISTRATION GUARD, which the PostToolUse dispatcher does not have. This
//       one asks whether any hook is registered before building anything, under
//       the FAN-OUT agent ids (`shared/hook-agent-context.js`, owned here) — and
//       PostToolUseFailure is in the fan-out event set, so a built-in web-fetch
//       subagent's failure is visible to the parent session's registry.
//   the executor request omits `managedHooksOnly` and `managedHooksExcluded`.
//       Its sibling forwards both off an options bag; this one takes no options
//       bag at all, so a managed pass can never narrow a failure dispatch.
//
// Ports (nothing behind them is owned by this wave):
//   hasHookForEvent(event, registry, agentIds) -> boolean   reads the settings
//       layers and the session registry.
//   createBaseHookInput(session, cwd, permissionMode, context)  the common prefix.
//   cwd() -> string                    the working directory.
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li` (§2.4 `primitive`).
import { hookAgentIds } from "../shared/hook-agent-context.js";

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* postToolFailureHooks(
  toolName,
  toolUseId,
  toolInput,
  error,
  context,
  isInterrupt,
  permissionMode,
  signal,
  timeoutMs,
  durationMs,
  hasHookForEvent,
  createBaseHookInput,
  cwd,
  executeHooks,
) {
  if (
    !hasHookForEvent(
      "PostToolUseFailure",
      context.sessionHooksRegistry,
      hookAgentIds(context, "PostToolUseFailure", context.session.id),
    )
  ) {
    return;
  }
  const hookInput = {
    ...createBaseHookInput(context.session, cwd(), permissionMode, context),
    hook_event_name: "PostToolUseFailure",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
    error,
    is_interrupt: isInterrupt,
    duration_ms: durationMs,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does.
  yield* executeHooks({
    session: context.session,
    hookInput,
    toolUseID: toolUseId,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext: context,
  });
}
