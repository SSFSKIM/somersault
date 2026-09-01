// SABOTAGE wiring — any scenario that registers a PermissionRequest hook MUST go
// red with this built.
import { permissionRequestHooks } from "./permission-request-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *permissionRequestHooks() {
    return yield* permissionRequestHooks();
  },
});
