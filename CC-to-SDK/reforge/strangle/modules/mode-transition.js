// ADAPTER — the graph-facing seam for the mode transition.
//
// Sixteen arguments: four the callers pass and twelve ports, every one of them a
// side effect whose far side belongs to a subsystem W6 does not own. That count
// is the ledger edge list for this row, written out.
import { transitionPermissionMode } from "./mode-transition/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  transitionPermissionMode(...args) {
    return transitionPermissionMode(...args);
  },
});
