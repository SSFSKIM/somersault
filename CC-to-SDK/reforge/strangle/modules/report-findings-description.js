// ADAPTER — the graph-facing seam for the report findings description.
//
// Delegation signature:
//   reportFindingsDescription()
//
// No captures: upstream's body reads nothing from its enclosing scope.
import { reportFindingsDescription } from "./report-findings-description/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  reportFindingsDescription() {
    return reportFindingsDescription();
  },
});
