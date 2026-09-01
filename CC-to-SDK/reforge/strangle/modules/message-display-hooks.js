// ADAPTER — the graph-facing seam for the MessageDisplay hook dispatcher.
//
// Delegation signature:
//   messageDisplayHooks(session, message, sessionHooks, signal, timeoutMs,
//                       storageV5, credentials,
//                       createBaseHookInput, cwd, defaultHookTimeoutMs, executeHooks)
//
// An async GENERATOR on both sides: the graph delegates with `yield*`, so this
// adapter forwards the iteration rather than a promise.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, messageDisplayHooks } from "./message-display-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *messageDisplayHooks(
    session,
    message,
    sessionHooks,
    signal,
    timeoutMs,
    storageV5,
    credentials,
    createBaseHookInput,
    cwd,
    defaultHookTimeoutMs,
    executeHooks,
  ) {
    assertGraphValue("message-display-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* messageDisplayHooks(
      session,
      message,
      sessionHooks,
      signal,
      timeoutMs,
      storageV5,
      credentials,
      createBaseHookInput,
      cwd,
      executeHooks,
    );
  },
});
