// SABOTAGE wiring — every scenario that compacts MUST go red.
import { compactBoundaryWire } from "./compact-boundary-wire/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  compactBoundaryWire(metadata) {
    return compactBoundaryWire(metadata);
  },
});
