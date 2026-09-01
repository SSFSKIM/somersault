// SABOTAGE wiring — `hooks-session-start` MUST go red with this built.
import { sessionStartHooks } from "./session-start-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *sessionStartHooks() {
    return yield* sessionStartHooks();
  },
});
