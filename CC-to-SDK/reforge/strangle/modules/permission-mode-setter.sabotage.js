// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { applyPermissionModeRequest } from "./permission-mode-setter/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  applyPermissionModeRequest(...args) {
    return applyPermissionModeRequest(...args);
  },
});
