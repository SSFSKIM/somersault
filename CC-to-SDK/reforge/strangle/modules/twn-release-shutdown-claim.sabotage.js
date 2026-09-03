// SABOTAGE wiring — see the twin.
import { twnReleaseShutdownClaim } from "./twn-release-shutdown-claim/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnReleaseShutdownClaim(self) {
    return twnReleaseShutdownClaim(self);
  },
});
