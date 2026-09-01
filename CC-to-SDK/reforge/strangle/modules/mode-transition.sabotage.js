// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { transitionPermissionMode } from "./mode-transition/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  transitionPermissionMode(...args) {
    return transitionPermissionMode(...args);
  },
});
