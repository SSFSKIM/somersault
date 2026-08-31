// PARITY LAYER (§2.5 `reference`) — the TaskGet tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the TaskGet
// tool's object literal (2.1.251, chunk-fy12d89p). Verified ZERO free variables,
// so it is standalone-complete by construction: the body reads only its own
// parameters.
//
// The blocked-by / blocks lines are appended only when non-empty, so the common
// result is three lines. The `task-family` scenario covers the three-line form;
// the dependency lines are covered by the contract test.
export function taskGetResultBlock({ task }, toolUseId) {
  if (!task) return { tool_use_id: toolUseId, type: "tool_result", content: "Task not found" };
  const lines = [`Task #${task.id}: ${task.subject}`, `Status: ${task.status}`, `Description: ${task.description}`];
  if (task.blockedBy.length > 0) lines.push(`Blocked by: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
  if (task.blocks.length > 0) lines.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(", ")}`);
  return { tool_use_id: toolUseId, type: "tool_result", content: lines.join("\n") };
}
