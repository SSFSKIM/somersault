// ADAPTER — the graph-facing seam for the SubagentStart hook dispatcher.
//
// Delegation signature:
//   subagentStartHooks(context, agentId, agentType, signal, timeoutMs,
//                      sessionHooks, agentContext, options,
//                      createBaseHookInput, cwd, defaultHookTimeoutMs, uuid, executeHooks)
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, subagentStartHooks } from "./subagent-start-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *subagentStartHooks(
    context,
    agentId,
    agentType,
    signal,
    timeoutMs,
    sessionHooks,
    agentContext,
    options,
    createBaseHookInput,
    cwd,
    defaultHookTimeoutMs,
    uuid,
    executeHooks,
  ) {
    assertGraphValue("subagent-start-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* subagentStartHooks(
      context,
      agentId,
      agentType,
      signal,
      timeoutMs,
      sessionHooks,
      agentContext,
      options,
      createBaseHookInput,
      cwd,
      uuid,
      executeHooks,
    );
  },
});
