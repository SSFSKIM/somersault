// SABOTAGE LAYER (§2.5). Shape-preserving: still a tool_result with string
// content, so `file-tools` reddens on the transcript AND the next request body
// without making the engine retry anything.
export function readToolResultBlock(result, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_READ ${result.type}` };
}
