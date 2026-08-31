// SABOTAGE wiring — `task-family` MUST go red with this built.
import { taskGetResultBlock } from "./task-get-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskGetResultBlock(output, toolUseId) {
    return taskGetResultBlock(output, toolUseId);
  },
});
