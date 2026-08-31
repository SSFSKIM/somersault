// SABOTAGE wiring — `plain` MUST go red with this built.
import { appendTextDelta } from "./text-delta/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  appendTextDelta(block, delta) {
    return appendTextDelta(block, delta);
  },
});
