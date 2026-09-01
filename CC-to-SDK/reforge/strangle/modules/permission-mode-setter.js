// ADAPTER — the graph-facing seam for the set_permission_mode handler.
//
// Delegation signature:
//   applyPermissionModeRequest(request, context, guardPermissionModeChange,
//                              transitionPermissionMode)
//
// Two `effectful-port` captures, both into the permission subsystem W6 owns
// (§2.4): forwarded rather than re-implemented, so this row cannot drift from
// the guard and the transition it composes, and so sabotaging either of those
// still reddens through this delegation.
import { applyPermissionModeRequest } from "./permission-mode-setter/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  applyPermissionModeRequest(request, context, guardPermissionModeChange, transitionPermissionMode) {
    return applyPermissionModeRequest(request, context, guardPermissionModeChange, transitionPermissionMode);
  },
});
