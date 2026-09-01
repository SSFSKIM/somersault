// SABOTAGE wiring — every scenario that makes a tool call MUST go red.
import { permissionMessage } from "./permission-message/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionMessage(...args) {
    return permissionMessage(...args);
  },
});
