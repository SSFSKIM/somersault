// SABOTAGE LAYER (§2.5). `search-tools` MUST go red with this built.
export function globResultBlock(output, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_GLOB ${output.filenames.length}` };
}
