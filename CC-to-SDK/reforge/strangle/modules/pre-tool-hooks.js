// ADAPTER — the graph-facing seam for the PreToolUse hook dispatcher.
//
// Delegation signature:
//   preToolHooks(toolName, toolUseId, toolInput, context, permissionMode,
//                signal, timeoutMs, options,
//                stableKeys, moduleHandlers, hasHookForEvent, log,
//                createBaseHookInput, cwd, defaultHookTimeoutMs, executeHooks,
//                preToolChain, stripConfinedHookApproval)
//
// Two of the body's free variables do NOT cross this seam: `hookAgentIds` (the
// fan-out rule) and `isPlainObject` (the chain-eligibility predicate) are
// `pure-helper` captures the owned module implements and uses in both wirings
// (§2.4), so the build footprints the graph's copies and never calls them.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, preToolHooks } from "./pre-tool-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *preToolHooks(
    toolName,
    toolUseId,
    toolInput,
    context,
    permissionMode,
    signal,
    timeoutMs,
    options,
    stableKeys,
    moduleHandlers,
    hasHookForEvent,
    log,
    createBaseHookInput,
    cwd,
    defaultHookTimeoutMs,
    executeHooks,
    preToolChain,
    stripConfinedHookApproval,
  ) {
    assertGraphValue("pre-tool-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* preToolHooks(
      toolName,
      toolUseId,
      toolInput,
      context,
      permissionMode,
      signal,
      timeoutMs,
      options,
      stableKeys,
      moduleHandlers,
      hasHookForEvent,
      log,
      createBaseHookInput,
      cwd,
      executeHooks,
      preToolChain,
      stripConfinedHookApproval,
    );
  },
});
