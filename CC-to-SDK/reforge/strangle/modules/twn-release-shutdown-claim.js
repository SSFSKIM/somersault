// ADAPTER — the graph-facing seam for releasing the coordinator's claim.
// Delegation signature: twnReleaseShutdownClaim(self). No captures.
import { twnReleaseShutdownClaim } from "./twn-release-shutdown-claim/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnReleaseShutdownClaim(self) {
    return twnReleaseShutdownClaim(self);
  },
});
