// ADAPTER — the graph-facing seam for the exit worktree description.
//
// Delegation signature:
//   exitWorktreeDescription()
//
// No captures: upstream's body reads nothing from its enclosing scope.
import { exitWorktreeDescription } from "./exit-worktree-description/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  exitWorktreeDescription() {
    return exitWorktreeDescription();
  },
});
