// Deliberately WRONG variant — used to prove the spliced module is actually in
// the execution path: with this installed, the file-tools scenario MUST go red
// (its tool_result content flows into both the transcript and the next request
// body). If the corpus stays green under sabotage, the splice is dead code.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  writeToolResultBlock({ filePath }, toolUseId) {
    return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED ${filePath}` };
  },
});
