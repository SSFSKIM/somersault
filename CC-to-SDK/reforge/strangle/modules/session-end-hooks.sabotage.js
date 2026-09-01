// SABOTAGE wiring — `hooks-session-end` MUST go red with this built.
import { sessionEndHooks } from "./session-end-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  sessionEndHooks() {
    return sessionEndHooks();
  },
});
