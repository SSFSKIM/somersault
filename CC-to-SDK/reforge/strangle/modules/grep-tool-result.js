// ADAPTER — the graph-facing seam for the Grep result formatter.
//
// Delegation signature:
//   grepToolResultBlock(output, toolUseId)
//
// No captures cross: the pagination note and the pluralizer are both owned
// (§2.4 `pure-helper`), so the build derives and footprints them — an upstream
// change to either stales this row — but does not forward them.
import { grepToolResultBlock } from "./grep-tool-result/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  grepToolResultBlock(output, toolUseId) {
    return grepToolResultBlock(output, toolUseId);
  },
});
