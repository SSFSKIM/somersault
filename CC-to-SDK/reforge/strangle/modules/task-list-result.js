// ADAPTER — the graph-facing seam for the TaskList result formatter.
// Delegation signature: taskListResultBlock(output, toolUseId). No captures.
import { taskListResultBlock } from "./task-list-result/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskListResultBlock(output, toolUseId) {
    return taskListResultBlock(output, toolUseId);
  },
});
