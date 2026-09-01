// ADAPTER — the graph-facing seam for the Stop / SubagentStop hook dispatcher.
//
// Delegation signature:
//   stopHooks(permissionMode, signal, timeoutMs, stopHookActive, agentId,
//             context, messages, agentType, phase,
//             defaultHookTimeoutMs, hasHookForEvent, backgroundTasks,
//             sessionCrons, createBaseHookInput, cwd, agentTranscriptPath,
//             uuid, executeHooks)
//
// Four of the body's free variables do NOT cross this seam — the two
// agent-context predicates and the two message-text helpers are `pure-helper`
// captures the owned module implements and uses in both wirings (§2.4), so the
// build footprints the graph's copies and never calls them.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, stopHooks } from "./stop-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *stopHooks(
    permissionMode,
    signal,
    timeoutMs,
    stopHookActive,
    agentId,
    context,
    messages,
    agentType,
    phase,
    defaultHookTimeoutMs,
    hasHookForEvent,
    backgroundTasks,
    sessionCrons,
    createBaseHookInput,
    cwd,
    agentTranscriptPath,
    uuid,
    executeHooks,
  ) {
    assertGraphValue("stop-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* stopHooks(
      permissionMode,
      signal,
      timeoutMs,
      stopHookActive,
      agentId,
      context,
      messages,
      agentType,
      phase,
      hasHookForEvent,
      backgroundTasks,
      sessionCrons,
      createBaseHookInput,
      cwd,
      agentTranscriptPath,
      uuid,
      executeHooks,
    );
  },
});
