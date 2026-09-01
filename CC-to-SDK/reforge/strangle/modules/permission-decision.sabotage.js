// SABOTAGE wiring — `permission-broker` and `permission-bag` MUST go red.
import { permissionDecisionWithSink } from "./permission-decision/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionDecisionWithSink(...args) {
    return permissionDecisionWithSink(...args);
  },
});
