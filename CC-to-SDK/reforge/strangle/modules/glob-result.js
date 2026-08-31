// ADAPTER — the graph-facing seam for the Glob result formatter.
//
// Delegation signature: globResultBlock(output, toolUseId).
// No captures cross: the truncation notice is owned (§2.4 `pure-helper`), so the
// build derives and footprints the graph's function without forwarding it.
import { globResultBlock } from "./glob-result/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  globResultBlock(output, toolUseId) {
    return globResultBlock(output, toolUseId);
  },
});
