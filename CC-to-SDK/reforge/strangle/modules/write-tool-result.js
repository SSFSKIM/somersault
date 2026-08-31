// ADAPTER — the graph-facing seam for the Write result formatter.
//
// Delegation signature (built by strangle/build.ts from the manifest row):
//   writeToolResultBlock(output, toolUseId, freshnessSuffix)
//
// `freshnessSuffix` is a §2.4 `primitive`: the module owns the value and the
// adapter's only job with the graph's copy is to prove they still agree.
import { writeToolResultBlock } from "./write-tool-result/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { FRESHNESS_SUFFIX } from "./shared/file-state.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  writeToolResultBlock(output, toolUseId, freshnessSuffix) {
    assertGraphValue("write-tool-result", "freshnessSuffix", freshnessSuffix, FRESHNESS_SUFFIX);
    return writeToolResultBlock(output, toolUseId);
  },
});
