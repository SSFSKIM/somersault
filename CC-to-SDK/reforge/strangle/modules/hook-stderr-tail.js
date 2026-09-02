// ADAPTER — the graph-facing seam for the hook output's stderr tail.
//
// Delegation signature:
//   hookStderrTail(stdout, exitCode, stderr)
//
// No forwarded captures: upstream's body has ZERO free variables, which the
// build machine-checks in both directions. `captures: []` on the manifest row is
// therefore the positive claim "verified zero", not an omission.
import { hookStderrTail } from "./hook-stderr-tail/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookStderrTail(...args) {
    return hookStderrTail(...args);
  },
});
