// PARITY LAYER (§2.5 `reference`) — the TaskList tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the TaskList
// tool's object literal (2.1.251, chunk-fy12d89p). Verified ZERO free variables.
//
// `task-family` covers BOTH arms deliberately: it calls TaskList once before
// creating anything (the "No tasks found" arm) and again afterwards (the listing
// arm). The owner suffix and the blocked-by suffix are outside the corpus and
// are graded by the contract test.
export function taskListResultBlock({ tasks }, toolUseId) {
  if (tasks.length === 0) return { tool_use_id: toolUseId, type: "tool_result", content: "No tasks found" };
  const lines = tasks.map((task) => {
    const owner = task.owner ? ` (${task.owner})` : "";
    const blocked =
      task.blockedBy.length > 0 ? ` [blocked by ${task.blockedBy.map((id) => `#${id}`).join(", ")}]` : "";
    return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
  });
  return { tool_use_id: toolUseId, type: "tool_result", content: lines.join("\n") };
}
