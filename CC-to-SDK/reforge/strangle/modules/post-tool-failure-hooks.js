// ADAPTER — the graph-facing seam for the PostToolUseFailure hook dispatcher.
//
// Delegation signature:
//   postToolFailureHooks(toolName, toolUseId, toolInput, error, context,
//                        isInterrupt, permissionMode, signal, timeoutMs,
//                        durationMs,
//                        hasHookForEvent, createBaseHookInput, cwd,
//                        defaultHookTimeoutMs, executeHooks)
//
// `hookAgentIds` does NOT cross this seam: it is a `pure-helper` the owned
// module implements and uses in both wirings (§2.4), so the graph's copy is
// footprinted by the build and never called.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, postToolFailureHooks } from "./post-tool-failure-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *postToolFailureHooks(
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
    defaultHookTimeoutMs,
    executeHooks,
  ) {
    assertGraphValue("post-tool-failure-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* postToolFailureHooks(
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
    );
  },
});
