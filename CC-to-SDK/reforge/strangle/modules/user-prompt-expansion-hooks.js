// ADAPTER — the graph-facing seam for the UserPromptExpansion hook dispatcher.
//
// Delegation signature:
//   userPromptExpansionHooks(expansionType, commandName, commandArgs, commandSource,
//                            prompt, permissionMode, toolUseContext,
//                            hasHookForEvent, createBaseHookInput, cwd, uuid,
//                            executeHooks, defaultHookTimeoutMs)
//
// `defaultHookTimeoutMs` crosses the seam only so the assertion below can run
// (§2.4 `primitive`): this dispatcher takes no timeout parameter, so the owned
// constant is the value the executor is actually given.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, userPromptExpansionHooks } from "./user-prompt-expansion-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *userPromptExpansionHooks(
    expansionType,
    commandName,
    commandArgs,
    commandSource,
    prompt,
    permissionMode,
    toolUseContext,
    hasHookForEvent,
    createBaseHookInput,
    cwd,
    uuid,
    executeHooks,
    defaultHookTimeoutMs,
  ) {
    assertGraphValue(
      "user-prompt-expansion-hooks",
      "defaultHookTimeoutMs",
      defaultHookTimeoutMs,
      DEFAULT_HOOK_TIMEOUT_MS,
    );
    return yield* userPromptExpansionHooks(
      expansionType,
      commandName,
      commandArgs,
      commandSource,
      prompt,
      permissionMode,
      toolUseContext,
      hasHookForEvent,
      createBaseHookInput,
      cwd,
      uuid,
      executeHooks,
    );
  },
});
