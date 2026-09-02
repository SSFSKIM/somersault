// ADAPTER — the graph-facing seam for the task stop description.
//
// Delegation signature:
//   taskStopDescription()
//
// No captures: upstream's body reads nothing from its enclosing scope.
import { taskStopDescription } from "./task-stop-description/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskStopDescription() {
    return taskStopDescription();
  },
});
