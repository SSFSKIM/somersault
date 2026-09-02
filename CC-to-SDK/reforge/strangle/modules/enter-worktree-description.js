// ADAPTER — the graph-facing seam for the enter worktree description.
//
// Delegation signature:
//   enterWorktreeDescription()
//
// No captures: upstream's body reads nothing from its enclosing scope.
import { enterWorktreeDescription } from "./enter-worktree-description/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  enterWorktreeDescription() {
    return enterWorktreeDescription();
  },
});
