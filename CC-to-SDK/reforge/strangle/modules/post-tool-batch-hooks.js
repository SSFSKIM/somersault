// ADAPTER — the graph-facing seam for the PostToolBatch hook dispatcher.
//
// Delegation signature:
//   postToolBatchHooks(toolCalls, toolUseId, context, permissionMode, signal,
//                      timeoutMs,
//                      hasHookForEvent, createBaseHookInput, cwd,
//                      defaultHookTimeoutMs, executeHooks)
//
// `hookAgentIds` does NOT cross this seam: it is a `pure-helper` the owned
// module implements and uses in both wirings (§2.4), so the graph's copy is
// footprinted by the build and never called.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, postToolBatchHooks } from "./post-tool-batch-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *postToolBatchHooks(
    toolCalls,
    toolUseId,
    context,
    permissionMode,
    signal,
    timeoutMs,
    hasHookForEvent,
    createBaseHookInput,
    cwd,
    defaultHookTimeoutMs,
    executeHooks,
  ) {
    assertGraphValue("post-tool-batch-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* postToolBatchHooks(
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
    );
  },
});
