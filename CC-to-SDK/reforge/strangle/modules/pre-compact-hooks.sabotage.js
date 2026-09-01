// SABOTAGE wiring — `hooks-precompact` MUST go red with this built.
import { preCompactHooks } from "./pre-compact-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  preCompactHooks() {
    return preCompactHooks();
  },
});
