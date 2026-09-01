// ADAPTER — the graph-facing seam for the thinking-config resolver.
//
// Delegation signature:
//   resolveThinkingConfig(requestedTokens, display, currentExplicit,
//                         adaptiveThinkingAllowed)
//
// One `effectful-port` capture: whether adaptive thinking is available is a
// question about the session's launch options, so it stays a forwarded typed
// argument and is a ledger edge to the wave that owns those.
import { resolveThinkingConfig } from "./thinking-config/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  resolveThinkingConfig(requestedTokens, display, currentExplicit, adaptiveThinkingAllowed) {
    return resolveThinkingConfig(requestedTokens, display, currentExplicit, adaptiveThinkingAllowed);
  },
});
