// SABOTAGE wiring — `hooks-prompt-submit` and `hooks-subagent` MUST go red.
import { stopHooks } from "./stop-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *stopHooks() {
    return yield* stopHooks();
  },
});
