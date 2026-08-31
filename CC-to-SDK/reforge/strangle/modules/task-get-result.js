// ADAPTER — the graph-facing seam for the TaskGet result formatter.
// Delegation signature: taskGetResultBlock(output, toolUseId). No captures.
import { taskGetResultBlock } from "./task-get-result/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskGetResultBlock(output, toolUseId) {
    return taskGetResultBlock(output, toolUseId);
  },
});
