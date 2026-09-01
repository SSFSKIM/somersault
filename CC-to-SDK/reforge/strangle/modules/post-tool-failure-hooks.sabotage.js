// SABOTAGE wiring — `hooks-tool-failure` MUST go red with this built.
import { postToolFailureHooks } from "./post-tool-failure-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *postToolFailureHooks() {
    return yield* postToolFailureHooks();
  },
});
