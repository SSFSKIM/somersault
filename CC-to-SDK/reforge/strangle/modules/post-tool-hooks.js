// ADAPTER — the graph-facing seam for the PostToolUse hook dispatcher.
//
// Delegation signature:
//   postToolHooks(toolName, toolUseId, toolInput, toolResponse, context,
//                 permissionMode, signal, timeoutMs, durationMs, options,
//                 createBaseHookInput, cwd, defaultHookTimeoutMs, executeHooks)
//
// It is an async GENERATOR on both sides: the graph delegates with `yield*`, so
// this adapter must forward the iteration rather than a promise.
//
// `defaultHookTimeoutMs` is upstream's `Li`, forwarded only so the assertion
// below can run (§2.4 `primitive`): the owned module uses its own copy, and a
// timeout whose value changes while its name stays put moves no anchor, no
// target hash and no capture hash shape.
import { DEFAULT_HOOK_TIMEOUT_MS, postToolHooks } from "./post-tool-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *postToolHooks(
    toolName,
    toolUseId,
    toolInput,
    toolResponse,
    context,
    permissionMode,
    signal,
    timeoutMs,
    durationMs,
    options,
    createBaseHookInput,
    cwd,
    defaultHookTimeoutMs,
    executeHooks,
  ) {
    if (defaultHookTimeoutMs !== DEFAULT_HOOK_TIMEOUT_MS) {
      throw new Error(
        `reforge post-tool-hooks: upstream's hook timeout is ${defaultHookTimeoutMs}, the owned copy is ${DEFAULT_HOOK_TIMEOUT_MS}`,
      );
    }
    return yield* postToolHooks(
      toolName,
      toolUseId,
      toolInput,
      toolResponse,
      context,
      permissionMode,
      signal,
      timeoutMs,
      durationMs,
      options,
      createBaseHookInput,
      cwd,
      executeHooks,
    );
  },
});
