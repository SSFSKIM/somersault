// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { permissionPrecheck } from "./permission-precheck/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionPrecheck(...args) {
    return permissionPrecheck(...args);
  },
});
