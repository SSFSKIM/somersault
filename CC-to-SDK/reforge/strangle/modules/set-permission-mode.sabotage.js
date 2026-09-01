// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { setPermissionModeWithGuards } from "./set-permission-mode/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  setPermissionModeWithGuards(...args) {
    return setPermissionModeWithGuards(...args);
  },
});
