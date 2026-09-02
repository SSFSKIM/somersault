// ADAPTER — the graph-facing seam for a hook's invocation text.
//
// Delegation signature:
//   hookInvocationText(hook)
//
// No forwarded captures: upstream's body has ZERO free variables, which the
// build machine-checks in both directions.
import { hookInvocationText } from "./hook-invocation-text/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookInvocationText(...args) {
    return hookInvocationText(...args);
  },
});
