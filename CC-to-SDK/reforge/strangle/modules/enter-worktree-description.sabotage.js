// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { enterWorktreeDescription } from "./enter-worktree-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  enterWorktreeDescription() {
    return enterWorktreeDescription();
  },
});
