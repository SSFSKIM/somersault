// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { exitWorktreeDescription } from "./exit-worktree-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  exitWorktreeDescription() {
    return exitWorktreeDescription();
  },
});
