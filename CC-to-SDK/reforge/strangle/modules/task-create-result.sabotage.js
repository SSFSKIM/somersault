// Deliberately WRONG variant — proves the task-create splice is live: with this
// installed the todo-tool scenario must go red.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskCreateResultBlock({ task }, toolUseId) {
    return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_TASK ${task.id}` };
  },
});
