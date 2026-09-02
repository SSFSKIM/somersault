// ADAPTER — the graph-facing seam for the "# Doing tasks" section.
//
// Delegation signature:
//   doingTasksSection(featureGate)
//
// One forwarded port. The bullet formatter is a `pure-helper`: the owned module
// ships its own copy and upstream's stays live for its fourteen other callers,
// so it is not forwarded and not compared by identity.
import { doingTasksSection } from "./doing-tasks-section/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  doingTasksSection(featureGate) {
    return doingTasksSection(featureGate);
  },
});
