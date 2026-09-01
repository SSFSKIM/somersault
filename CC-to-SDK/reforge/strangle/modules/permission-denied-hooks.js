// ADAPTER — the graph-facing seam for the PermissionDenied hook dispatcher.
//
// Delegation signature:
//   permissionDeniedHooks(toolName, toolUseId, toolInput, reason, toolUseContext,
//                         permissionMode, signal, timeoutMs,
//                         hasHookForEvent, createBaseHookInput, cwd, executeHooks,
//                         defaultHookTimeoutMs)
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, permissionDeniedHooks } from "./permission-denied-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *permissionDeniedHooks(
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
    defaultHookTimeoutMs,
  ) {
    assertGraphValue("permission-denied-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* permissionDeniedHooks(
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
    );
  },
});
