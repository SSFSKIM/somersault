// ADAPTER — the graph-facing seam for the mode-change setter.
//
// Delegation signature:
//   setPermissionModeWithGuards(requested, context, updateState, trigger,
//                               guardModeChange, transitionMode, modeChanged)
import { setPermissionModeWithGuards } from "./set-permission-mode/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  setPermissionModeWithGuards(...args) {
    return setPermissionModeWithGuards(...args);
  },
});
