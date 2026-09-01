// SABOTAGE wiring — `auto-compact-threshold` MUST go red.
import { autoCompactTrigger } from "./auto-compact-trigger/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  autoCompactTrigger() {
    return autoCompactTrigger();
  },
});
