// ADAPTER — the graph-facing seam for the coordinator's shutdown claim.
// Delegation signature: twnClaimShutdown(self). No captures.
import { twnClaimShutdown } from "./twn-claim-shutdown/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnClaimShutdown(self) {
    return twnClaimShutdown(self);
  },
});
