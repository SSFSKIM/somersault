// ADAPTER — the graph-facing seam for the TaskCreate result formatter.
// Delegation signature: taskCreateResultBlock(output, toolUseId). No captures.
import { taskCreateResultBlock } from "./task-create-result/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskCreateResultBlock(output, toolUseId) {
    return taskCreateResultBlock(output, toolUseId);
  },
});
