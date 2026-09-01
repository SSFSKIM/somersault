// ADAPTER — the graph-facing seam for the SessionStart hook dispatcher.
//
// Delegation signature:
//   sessionStartHooks(session, source, sessionIdOverride, sessionTitleOverride,
//                     agentType, model, signal, timeoutMs, forceSyncExecution,
//                     extraFields, storageV5, credentials,
//                     createBaseHookInput, cwd, sessionId, sessionTitle,
//                     beginActivity, uuid, executeHooks, endActivity,
//                     defaultHookTimeoutMs, activityHold)
//
// Two primitives cross the seam and are equality-asserted rather than used: the
// timeout and the activity-hold reason. Neither moves an anchor or a target hash
// when its VALUE changes, so this assertion is the only cheap thing that sees it.
import { assertGraphValue } from "./shared/assert.js";
import { ACTIVITY_HOLD, DEFAULT_HOOK_TIMEOUT_MS, sessionStartHooks } from "./session-start-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *sessionStartHooks(
    session,
    source,
    sessionIdOverride,
    sessionTitleOverride,
    agentType,
    model,
    signal,
    timeoutMs,
    forceSyncExecution,
    extraFields,
    storageV5,
    credentials,
    createBaseHookInput,
    cwd,
    sessionId,
    sessionTitle,
    beginActivity,
    uuid,
    executeHooks,
    endActivity,
    defaultHookTimeoutMs,
    activityHold,
  ) {
    assertGraphValue("session-start-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    assertGraphValue("session-start-hooks", "activityHold", activityHold, ACTIVITY_HOLD);
    return yield* sessionStartHooks(
      session,
      source,
      sessionIdOverride,
      sessionTitleOverride,
      agentType,
      model,
      signal,
      timeoutMs,
      forceSyncExecution,
      extraFields,
      storageV5,
      credentials,
      createBaseHookInput,
      cwd,
      sessionId,
      sessionTitle,
      beginActivity,
      uuid,
      executeHooks,
      endActivity,
    );
  },
});
