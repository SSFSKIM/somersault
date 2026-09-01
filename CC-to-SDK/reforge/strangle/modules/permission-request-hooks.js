// ADAPTER — the graph-facing seam for the PermissionRequest hook dispatcher.
//
// Delegation signature:
//   permissionRequestHooks(toolName, toolUseId, toolInput, toolUseContext,
//                          permissionMode, permissionSuggestions, signal, timeoutMs,
//                          log, createBaseHookInput, cwd, executeHooks,
//                          defaultHookTimeoutMs)
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, permissionRequestHooks } from "./permission-request-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *permissionRequestHooks(
    toolName,
    toolUseId,
    toolInput,
    toolUseContext,
    permissionMode,
    permissionSuggestions,
    signal,
    timeoutMs,
    log,
    createBaseHookInput,
    cwd,
    executeHooks,
    defaultHookTimeoutMs,
  ) {
    assertGraphValue("permission-request-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* permissionRequestHooks(
      toolName,
      toolUseId,
      toolInput,
      toolUseContext,
      permissionMode,
      permissionSuggestions,
      signal,
      timeoutMs,
      log,
      createBaseHookInput,
      cwd,
      executeHooks,
    );
  },
});
