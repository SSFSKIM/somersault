// SABOTAGE LAYER (§2.5). Shape-preserving, content-corrupting: `search-tools`
// renders the files_with_matches arm, so a wrong file count reddens it at once.
export function grepToolResultBlock({ numFiles }, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_GREP ${numFiles}` };
}
