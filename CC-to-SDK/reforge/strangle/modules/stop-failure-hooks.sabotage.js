// SABOTAGE wiring — the api-error recording MUST go red with this built.
import { stopFailureHooks } from "./stop-failure-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  stopFailureHooks() {
    return stopFailureHooks();
  },
});
