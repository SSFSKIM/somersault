// ADAPTER — the graph-facing seam for the Read result formatter.
//
// Delegation signature:
//   readToolResultBlock(result, toolUseId, stalenessPrefix, tabAwareSeparator)
//
// Six of the eight upstream captures are owned outright (§2.4 `pure-helper`), so
// the build derives and footprints them but does not forward them. The two that
// remain are the typed ports documented in the reference module's header.
import { readToolResultBlock } from "./read-tool-result/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  readToolResultBlock(result, toolUseId, stalenessPrefix, tabAwareSeparator) {
    return readToolResultBlock(result, toolUseId, stalenessPrefix, tabAwareSeparator);
  },
});
