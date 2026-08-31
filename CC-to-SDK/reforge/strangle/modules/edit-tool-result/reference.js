// PARITY LAYER (§2.5 `reference`) — the Edit tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the Edit tool's
// object literal (2.1.251, chunk-fy12d89p). Standalone-complete: its one capture
// was the freshness suffix, now the owned constant the Write formatter also uses
// (shared/file-state.js).
//
// Two arms, both covered by the `edit-tool` scenario:
//   replace_all -> "The file <p> has been updated<modified>. All occurrences were successfully replaced.<suffix>"
//   otherwise   -> "The file <p> has been updated successfully<modified>.<suffix>"
//
// Contract details worth stating because they read like typos and are not:
//  - the "user modified" fragment begins with ". " (a period and TWO spaces) and
//    ends with a space, so on the replace_all arm it lands between "updated" and
//    the template's own ".", producing a doubled sentence break. Faithful.
//  - the three suffix states are ORDERED: a stale-recovery note wins over both
//    the empty case and the freshness suffix.
//  - error results ("String to replace not found in file.", "File has not been
//    read yet.") are NOT produced here — they come from the Edit tool's
//    `validateInput`, a separate 3.3k-char validator with filesystem, gate and
//    telemetry captures. It is its own closure-ledger row
//    (subsystem/tool-result-validators), deliberately out of this wave.
import { FRESHNESS_SUFFIX } from "../shared/file-state.js";

const STALE_RECOVERED_NOTE =
  " (note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file " +
  "contains other changes not in your context. Read it before edits that depend on surrounding content.)";

export function editToolResultBlock(output, toolUseId) {
  const { filePath, userModified, replaceAll, staleRecovered, memdirStamped } = output;
  const modified = userModified ? ".  The user modified your proposed changes before accepting them. " : "";
  const suffix = staleRecovered ? STALE_RECOVERED_NOTE : userModified || memdirStamped ? "" : FRESHNESS_SUFFIX;
  if (replaceAll) {
    return {
      tool_use_id: toolUseId,
      type: "tool_result",
      content: `The file ${filePath} has been updated${modified}. All occurrences were successfully replaced.${suffix}`,
    };
  }
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: `The file ${filePath} has been updated successfully${modified}.${suffix}`,
  };
}
