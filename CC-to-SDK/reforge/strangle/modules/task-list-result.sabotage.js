// SABOTAGE wiring — `task-family` MUST go red with this built.
import { taskListResultBlock } from "./task-list-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskListResultBlock(output, toolUseId) {
    return taskListResultBlock(output, toolUseId);
  },
});
