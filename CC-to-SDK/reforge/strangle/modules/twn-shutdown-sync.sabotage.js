// SABOTAGE wiring — see the twin for what it drops.
import { twnShutdownSync } from "./twn-shutdown-sync/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnShutdownSync(self, code, reason, commitShutdown, logError, resetTerminal) {
    return twnShutdownSync(self, code, reason, commitShutdown, logError, resetTerminal);
  },
});
