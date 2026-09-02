// ADAPTER — the graph-facing seam for the task output description.
//
// Delegation signature:
//   taskOutputDescription()
//
// No captures: upstream's body reads nothing from its enclosing scope.
import { taskOutputDescription } from "./task-output-description/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskOutputDescription() {
    return taskOutputDescription();
  },
});
