// ADAPTER — the graph-facing seam for the WebFetch tool's description function.
//
// Delegation signature:
//   webFetchDescription(model, artifactException, leanPrompt, cacheTtlPhrase)
//
// No primitives cross: the usage-notes block is an owned `pure-helper` (so the
// build footprints the graph's function without forwarding it) and everything
// else here is either an original parameter or a typed port.
import { webFetchDescription } from "./webfetch-description/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  webFetchDescription(model, artifactException, leanPrompt, cacheTtlPhrase) {
    return webFetchDescription(model, artifactException, leanPrompt, cacheTtlPhrase);
  },
});
