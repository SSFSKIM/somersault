// ADAPTER — the graph-facing seam for the "# Executing actions with care"
// section.
//
// Delegation signature:
//   executingActionsSection()
//
// No arguments and no captures, which is the whole point of the row: upstream's
// body is one template literal with zero free variables, so the delegation is
// the simplest one in the manifest and `captures: []` is a positive claim the
// build re-derives every time.
import { executingActionsSection } from "./executing-actions-section/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  executingActionsSection() {
    return executingActionsSection();
  },
});
