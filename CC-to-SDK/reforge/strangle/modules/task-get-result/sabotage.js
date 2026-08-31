// SABOTAGE LAYER (§2.5). `task-family` MUST go red: it reads a real task back.
export function taskGetResultBlock({ task }, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_TASKGET ${task ? task.id : "none"}` };
}
