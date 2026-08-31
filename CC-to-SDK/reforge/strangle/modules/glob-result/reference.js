// PARITY LAYER (§2.5 `reference`) — the Glob tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the Glob tool's
// object literal (2.1.251, chunk-fy12d89p). Standalone-complete since C4's
// retrofit: the truncation notice it used to call on the graph is owned here and
// used in both wirings.
//
// The truncation branch has ZERO differential coverage — no corpus scenario ever
// truncates a Glob result — so per §2.4 its contract test is not optional. See
// strangle/contracts.test.ts, which partitions the notice's three outputs.

/**
 * Upstream `APn`: the parenthetical that replaces the results the tool dropped.
 *
 * Three outputs, selected in this order:
 *  - no total at all: the tool cannot say how many it dropped.
 *  - a COMPLETE count: it can name the remainder exactly.
 *  - an incomplete count: it can only say "more than".
 */
export function truncationNotice(output) {
  const shown = output.filenames.length;
  if (output.totalMatches === undefined) {
    return "(Results are truncated. Consider using a more specific path or pattern.)";
  }
  if (output.countIsComplete) {
    const remaining = output.totalMatches - shown;
    return `(Showing ${shown} of ${output.totalMatches} matching files; ${remaining} more are not listed. Narrow the pattern or path to see the rest.)`;
  }
  return `(Showing the first ${shown} files; there are more than ${output.totalMatches} matches. Narrow the pattern or path to see the rest.)`;
}

export function globResultBlock(output, toolUseId) {
  if (output.filenames.length === 0) {
    return { tool_use_id: toolUseId, type: "tool_result", content: "No files found" };
  }
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: [...output.filenames, ...(output.truncated ? [truncationNotice(output)] : [])].join("\n"),
  };
}
