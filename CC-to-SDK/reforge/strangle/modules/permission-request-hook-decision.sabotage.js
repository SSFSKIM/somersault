// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { permissionRequestHookDecision } from "./permission-request-hook-decision/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionRequestHookDecision(...args) {
    return permissionRequestHookDecision(...args);
  },
});
