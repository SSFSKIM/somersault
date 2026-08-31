// SABOTAGE LAYER (§2.5). Corrupts both arms into one wrong line, so whichever
// TaskList call the scenario reaches first turns `task-family` red.
export function taskListResultBlock({ tasks }, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_TASKLIST ${tasks.length}` };
}
