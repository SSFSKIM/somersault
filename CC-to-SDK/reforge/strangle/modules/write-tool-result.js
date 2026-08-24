// reforge-owned reimplementation of the Write tool's
// mapToolResultToToolResultBlockParam (2.1.241, pretty line ~286390).
// Injected as a prelude; the patched bundle delegates here, passing the
// closure-scoped freshness-suffix constant as an argument.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  writeToolResultBlock({ filePath, type, userModified, memdirStamped }, toolUseId, freshnessSuffix) {
    const modified = userModified ? " The user modified your proposed content before accepting it." : "";
    const suffix = userModified || memdirStamped ? "" : freshnessSuffix;
    switch (type) {
      case "create":
        return {
          tool_use_id: toolUseId,
          type: "tool_result",
          content: `File created successfully at: ${filePath}${modified}${suffix}`,
        };
      case "update":
        return {
          tool_use_id: toolUseId,
          type: "tool_result",
          content: `The file ${filePath} has been updated successfully.${modified}${suffix}`,
        };
    }
  },
});
