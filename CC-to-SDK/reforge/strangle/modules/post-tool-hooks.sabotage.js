// SABOTAGE wiring — `hooks` MUST go red with this built.
import { postToolHooks } from "./post-tool-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *postToolHooks() {
    return yield* postToolHooks();
  },
});
