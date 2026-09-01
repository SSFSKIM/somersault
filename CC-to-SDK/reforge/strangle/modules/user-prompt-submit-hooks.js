// ADAPTER — the graph-facing seam for the UserPromptSubmit hook dispatcher.
//
// Delegation signature:
//   userPromptSubmitHooks(prompt, permissionMode, context, unusedFourth, options,
//                         hasHookForEvent, createBaseHookInput, cwd, sessionTitle,
//                         uuid, promptSubmitTimeoutMs, executeHooks)
//
// `promptSubmitTimeoutMs` is upstream's `I_e`, forwarded only so the assertion
// below can run (§2.4 `primitive`). It is the one dispatcher timeout that is not
// the shared 600,000 ms default, and a value that changed while its name stayed
// put would move no anchor and no hash.
import { assertGraphValue } from "./shared/assert.js";
import { PROMPT_SUBMIT_TIMEOUT_MS, userPromptSubmitHooks } from "./user-prompt-submit-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *userPromptSubmitHooks(
    prompt,
    permissionMode,
    context,
    unusedFourth,
    options,
    hasHookForEvent,
    createBaseHookInput,
    cwd,
    sessionTitle,
    uuid,
    promptSubmitTimeoutMs,
    executeHooks,
  ) {
    assertGraphValue("user-prompt-submit-hooks", "promptSubmitTimeoutMs", promptSubmitTimeoutMs, PROMPT_SUBMIT_TIMEOUT_MS);
    return yield* userPromptSubmitHooks(
      prompt,
      permissionMode,
      context,
      unusedFourth,
      options,
      hasHookForEvent,
      createBaseHookInput,
      cwd,
      sessionTitle,
      uuid,
      executeHooks,
    );
  },
});
