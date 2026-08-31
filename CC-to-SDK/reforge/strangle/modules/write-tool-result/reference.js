// PARITY LAYER (§2.5 `reference`) — the Write tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the Write tool's
// object literal (2.1.251, chunk-fy12d89p). Standalone-complete: the freshness
// suffix it used to receive from the graph is now an owned constant
// (shared/file-state.js), and the adapter equality-asserts the graph's against
// it on every delegation.
//
// Contract detail: `type` has no default arm upstream either — a Write result
// that is neither "create" nor "update" produces `undefined`, and reproducing
// that is faithfulness, not an oversight.
import { FRESHNESS_SUFFIX } from "../shared/file-state.js";

export function writeToolResultBlock({ filePath, type, userModified, memdirStamped }, toolUseId) {
  const modified = userModified ? " The user modified your proposed content before accepting it." : "";
  const suffix = userModified || memdirStamped ? "" : FRESHNESS_SUFFIX;
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
}
