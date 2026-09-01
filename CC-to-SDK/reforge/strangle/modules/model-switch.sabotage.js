// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { applyModelSwitchRequest } from "./model-switch/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  applyModelSwitchRequest(...args) {
    return applyModelSwitchRequest(...args);
  },
});
