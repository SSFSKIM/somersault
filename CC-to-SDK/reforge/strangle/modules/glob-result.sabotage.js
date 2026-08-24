// Deliberately WRONG variant — proves the glob splice is live: with this
// installed the search-tools scenario must go red.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  globResultBlock(output, toolUseId) {
    return { tool_use_id: toolUseId, type: "tool_result", content: `REFORGE_SABOTAGED_GLOB ${output.filenames.length}` };
  },
});
