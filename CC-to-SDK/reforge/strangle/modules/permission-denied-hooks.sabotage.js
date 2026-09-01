// SABOTAGE wiring — any scenario that registers a PermissionDenied hook MUST go
// red with this built.
import { permissionDeniedHooks } from "./permission-denied-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *permissionDeniedHooks() {
    return yield* permissionDeniedHooks();
  },
});
