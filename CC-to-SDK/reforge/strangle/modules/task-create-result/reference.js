// PARITY LAYER (§2.5 `reference`) — the TaskCreate tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the TaskCreate
// tool's object literal (2.1.251, chunk-fy12d89p). Verified ZERO free variables:
// the body destructures the tool output and formats one line, so this module is
// standalone-complete with nothing crossing the adapter.
export function taskCreateResultBlock({ task }, toolUseId) {
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: `Task #${task.id} created successfully: ${task.subject}`,
  };
}
