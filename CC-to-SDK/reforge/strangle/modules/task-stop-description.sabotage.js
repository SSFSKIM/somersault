// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { taskStopDescription } from "./task-stop-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskStopDescription() {
    return taskStopDescription();
  },
});
