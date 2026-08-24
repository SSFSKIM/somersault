// reforge-owned reimplementation of the Glob tool's
// mapToolResultToToolResultBlockParam (2.1.241). Captures one closure value:
// the truncation-notice function, passed in by the patched bundle.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  globResultBlock(output, toolUseId, truncationNotice) {
    if (output.filenames.length === 0) {
      return { tool_use_id: toolUseId, type: "tool_result", content: "No files found" };
    }
    return {
      tool_use_id: toolUseId,
      type: "tool_result",
      content: [...output.filenames, ...(output.truncated ? [truncationNotice(output)] : [])].join("\n"),
    };
  },
});
