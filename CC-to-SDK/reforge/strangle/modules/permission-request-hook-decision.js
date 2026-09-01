// ADAPTER — the graph-facing seam for the PermissionRequest hook decision.
//
// The dispatcher it delegates into is `permission-request-hooks`, which W5 owns —
// so this row's port list carries a live edge to another OWNED module rather than
// to the extracted graph. Ownership composing across waves, at a seam.
import { permissionRequestHookDecision } from "./permission-request-hook-decision/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionRequestHookDecision(...args) {
    return permissionRequestHookDecision(...args);
  },
});
