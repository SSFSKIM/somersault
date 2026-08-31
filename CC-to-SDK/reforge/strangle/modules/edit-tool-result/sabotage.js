// SABOTAGE LAYER (§2.5). Corrupts the content while keeping the tool_result
// shape, and keeps the two arms distinguishable so a partial liveness failure
// would still be readable in the diff.
export function editToolResultBlock({ filePath, replaceAll }, toolUseId) {
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: `REFORGE_SABOTAGED_EDIT ${replaceAll ? "all" : "one"} ${filePath}`,
  };
}
