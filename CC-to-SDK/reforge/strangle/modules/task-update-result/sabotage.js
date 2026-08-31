// SABOTAGE LAYER (§2.5). `task-family` MUST go red: it completes task #1.
export function taskUpdateResultBlock({ taskId }, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_TASKUPDATE ${taskId}` };
}
