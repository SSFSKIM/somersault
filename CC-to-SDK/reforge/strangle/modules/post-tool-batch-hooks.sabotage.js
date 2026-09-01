// SABOTAGE wiring — `hooks-batch` MUST go red with this built.
import { postToolBatchHooks } from "./post-tool-batch-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *postToolBatchHooks() {
    return yield* postToolBatchHooks();
  },
});
