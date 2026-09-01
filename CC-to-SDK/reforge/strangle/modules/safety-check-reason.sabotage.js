// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { findSafetyCheckReason } from "./safety-check-reason/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  findSafetyCheckReason(...args) {
    return findSafetyCheckReason(...args);
  },
});
