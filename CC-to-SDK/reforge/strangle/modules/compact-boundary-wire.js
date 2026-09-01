// ADAPTER — the graph-facing seam for the boundary's wire shaping.
//
// Delegation signature: compactBoundaryWire(metadata)
//
// `captures: []` is the verified claim that the excised body reads nothing from
// its scope, so this adapter forwards its one parameter and nothing else.
import { compactBoundaryWire } from "./compact-boundary-wire/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  compactBoundaryWire(metadata) {
    return compactBoundaryWire(metadata);
  },
});
