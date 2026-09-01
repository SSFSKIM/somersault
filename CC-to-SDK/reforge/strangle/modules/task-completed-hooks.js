// ADAPTER — the graph-facing seam for the TaskCompleted hook dispatcher.
//
// Delegation signature:
//   taskCompletedHooks(taskId, subject, description, teammateName, teamName,
//                      permissionMode, signal, timeoutMs, toolUseContext,
//                      createBaseHookInput, cwd, uuid, executeHooks,
//                      defaultHookTimeoutMs)
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, taskCompletedHooks } from "./task-completed-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *taskCompletedHooks(
    taskId,
    subject,
    description,
    teammateName,
    teamName,
    permissionMode,
    signal,
    timeoutMs,
    toolUseContext,
    createBaseHookInput,
    cwd,
    uuid,
    executeHooks,
    defaultHookTimeoutMs,
  ) {
    assertGraphValue("task-completed-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* taskCompletedHooks(
      taskId,
      subject,
      description,
      teammateName,
      teamName,
      permissionMode,
      signal,
      timeoutMs,
      toolUseContext,
      createBaseHookInput,
      cwd,
      uuid,
      executeHooks,
    );
  },
});
