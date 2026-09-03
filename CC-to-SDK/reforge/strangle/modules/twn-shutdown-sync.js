// ADAPTER — the graph-facing seam for the coordinator's synchronous shutdown
// entry point.
// Delegation signature: twnShutdownSync(self, code, reason, commitShutdown, logError, resetTerminal).
// All three captures are `effectful-port` and none is owned here: the latch
// commit is owned one row over but crosses as the graph's own binding, so the
// edge that runs is the one upstream had.
import { twnShutdownSync } from "./twn-shutdown-sync/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnShutdownSync(self, code, reason, commitShutdown, logError, resetTerminal) {
    return twnShutdownSync(self, code, reason, commitShutdown, logError, resetTerminal);
  },
});
