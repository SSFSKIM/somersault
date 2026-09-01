// SABOTAGE wiring — any scenario that registers a TaskCreated hook MUST go red
// with this built.
import { taskCreatedHooks } from "./task-created-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *taskCreatedHooks() {
    return yield* taskCreatedHooks();
  },
});
