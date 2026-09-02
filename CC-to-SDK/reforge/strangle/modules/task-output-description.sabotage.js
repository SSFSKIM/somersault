// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { taskOutputDescription } from "./task-output-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskOutputDescription() {
    return taskOutputDescription();
  },
});
