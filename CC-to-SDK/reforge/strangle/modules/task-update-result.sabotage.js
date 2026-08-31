// SABOTAGE wiring — `task-family` MUST go red with this built.
import { taskUpdateResultBlock } from "./task-update-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskUpdateResultBlock(output, toolUseId) {
    return taskUpdateResultBlock(output, toolUseId);
  },
});
