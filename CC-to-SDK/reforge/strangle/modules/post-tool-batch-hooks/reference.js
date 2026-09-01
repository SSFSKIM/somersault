// PARITY LAYER (§2.5 `reference`) — the PostToolBatch hook dispatcher
// (upstream `Fct` / `executePostToolBatchHooks`, 2.1.251, chunk-fy12d89p).
//
// Fires ONCE for a batch of tool calls the engine issued together, after all of
// them have returned. It is the only hook event whose record describes several
// tool calls rather than one, and the only one in the corpus that needs a turn
// SHAPE to reach: `hooks-batch` demands two tool_use blocks in a single
// assistant message, because a batch hook on a sequential turn never fires.
//
// Two things it owns beyond the record's field set:
//
//   the REGISTRATION GUARD. Unlike the PostToolUse dispatcher, this one asks
//       whether any hook is registered for the event before building anything —
//       and it asks under the FAN-OUT agent ids, so a built-in web-fetch
//       subagent's batch is visible to the parent session's registry
//       (`shared/hook-agent-context.js`, owned here). A guard that answered
//       differently would either drop hooks or spawn hook executions on every
//       batch of every session.
//   the executor is given NO `matchQuery`. Every tool-scoped event passes the
//       tool name, so its matchers can select on it; a batch has no single tool
//       name, so matchers for this event match everything.
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

export async function* postToolBatchHooks(
  toolCalls,
  toolUseId,
  context,
  permissionMode,
  signal,
  timeoutMs,
  hasHookForEvent,
  createBaseHookInput,
  cwd,
  executeHooks,
) {
  if (!hasHookForEvent("PostToolBatch", context.sessionHooksRegistry, hookAgentIds(context, "PostToolBatch", context.session.id))) {
    return;
  }
  const hookInput = {
    ...createBaseHookInput(context.session, cwd(), permissionMode, context),
    hook_event_name: "PostToolBatch",
    tool_calls: toolCalls,
  };
  return yield* executeHooks({
    session: context.session,
    hookInput,
    toolUseID: toolUseId,
    signal,
    timeoutMs,
    toolUseContext: context,
  });
}
