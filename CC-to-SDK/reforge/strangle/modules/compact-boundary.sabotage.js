// SABOTAGE wiring — every scenario that compacts MUST go red.
import { compactBoundary } from "./compact-boundary/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  compactBoundary() {
    return compactBoundary();
  },
});
