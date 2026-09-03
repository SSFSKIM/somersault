// SABOTAGE wiring — see the twin for what it drops and who would notice.
import { twnClaimShutdown } from "./twn-claim-shutdown/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnClaimShutdown(self) {
    return twnClaimShutdown(self);
  },
});
