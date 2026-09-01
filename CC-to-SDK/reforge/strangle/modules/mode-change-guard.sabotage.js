// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { guardPermissionModeChange } from "./mode-change-guard/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  guardPermissionModeChange(...args) {
    return guardPermissionModeChange(...args);
  },
});
