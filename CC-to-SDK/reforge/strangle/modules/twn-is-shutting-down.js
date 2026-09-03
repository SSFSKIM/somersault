// ADAPTER — the graph-facing seam for the coordinator's in-progress predicate.
// Delegation signature: twnIsShuttingDown(self). No captures: the whole body is
// one read off `this`.
import { twnIsShuttingDown } from "./twn-is-shutting-down/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnIsShuttingDown(self) {
    return twnIsShuttingDown(self);
  },
});
