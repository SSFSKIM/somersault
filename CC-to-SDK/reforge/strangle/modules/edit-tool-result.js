// ADAPTER — the graph-facing seam for the Edit result formatter.
//
// Delegation signature:
//   editToolResultBlock(output, toolUseId, freshnessSuffix)
//
// The second assertion site for the shared freshness constant (the first is the
// Write adapter): upstream both formatters read the same binding, so both
// adapters must agree with the one owned copy or the divergence is real.
import { editToolResultBlock } from "./edit-tool-result/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { FRESHNESS_SUFFIX } from "./shared/file-state.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  editToolResultBlock(output, toolUseId, freshnessSuffix) {
    assertGraphValue("edit-tool-result", "freshnessSuffix", freshnessSuffix, FRESHNESS_SUFFIX);
    return editToolResultBlock(output, toolUseId);
  },
});
