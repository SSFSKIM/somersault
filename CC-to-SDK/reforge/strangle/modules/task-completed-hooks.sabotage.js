// SABOTAGE wiring — any scenario that registers a TaskCompleted hook MUST go red
// with this built.
import { taskCompletedHooks } from "./task-completed-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *taskCompletedHooks() {
    return yield* taskCompletedHooks();
  },
});
