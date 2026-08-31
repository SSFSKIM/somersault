// SABOTAGE LAYER (§2.5). Shape-preserving — a tool_result with string content
// and the same `is_error` flag — so all four covering scenarios (`bash-tool`,
// `hooks`, `partial-tool-args`, `parallel-tools`) redden on the tool_result the
// model then reads back, with no retry storm.
export function bashToolResultBlock({ interrupted, stdout }, toolUseId) {
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: `REFORGE_SABOTAGED_BASH ${String(stdout ?? "").length}`,
    is_error: interrupted,
  };
}
