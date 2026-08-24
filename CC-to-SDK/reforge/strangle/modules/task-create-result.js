// reforge-owned reimplementation of the TaskCreate tool's
// mapToolResultToToolResultBlockParam (2.1.241). No closure captures — the
// original destructures the tool output and formats one line.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskCreateResultBlock({ task }, toolUseId) {
    return {
      tool_use_id: toolUseId,
      type: "tool_result",
      content: `Task #${task.id} created successfully: ${task.subject}`,
    };
  },
});
