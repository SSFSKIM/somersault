// SABOTAGE wiring — `todo-tool` MUST go red with this built.
import { taskCreateResultBlock } from "./task-create-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskCreateResultBlock(output, toolUseId) {
    return taskCreateResultBlock(output, toolUseId);
  },
});
