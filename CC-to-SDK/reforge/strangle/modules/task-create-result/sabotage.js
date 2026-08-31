// SABOTAGE LAYER (§2.5). `todo-tool` MUST go red with this built.
export function taskCreateResultBlock({ task }, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_TASK ${task.id}` };
}
