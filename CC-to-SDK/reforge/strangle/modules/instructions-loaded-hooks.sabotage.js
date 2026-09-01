// SABOTAGE wiring — the memory-load recording MUST go red with this built.
import { instructionsLoadedHooks } from "./instructions-loaded-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  instructionsLoadedHooks() {
    return instructionsLoadedHooks();
  },
});
