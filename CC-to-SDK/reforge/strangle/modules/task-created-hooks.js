// ADAPTER — the graph-facing seam for the TaskCreated hook dispatcher.
//
// Delegation signature:
//   taskCreatedHooks(taskId, subject, description, teammateName, teamName,
//                    permissionMode, signal, timeoutMs, toolUseContext,
//                    createBaseHookInput, cwd, uuid, executeHooks,
//                    defaultHookTimeoutMs)
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, taskCreatedHooks } from "./task-created-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *taskCreatedHooks(
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
    assertGraphValue("task-created-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return yield* taskCreatedHooks(
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
