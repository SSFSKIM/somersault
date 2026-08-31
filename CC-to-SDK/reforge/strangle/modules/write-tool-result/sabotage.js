// SABOTAGE LAYER (§2.5) — deliberately wrong, to prove the splice is live.
// Loud and cheap: the shape stays a valid tool_result, only the content is
// corrupted, so `file-tools` goes red immediately instead of making the engine
// retry a turn against an exhausted cassette.
export function writeToolResultBlock({ filePath }, toolUseId) {
  return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_WRITE ${filePath}` };
}
