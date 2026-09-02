// ADAPTER — the graph-facing seam for the async-acknowledgement test.
//
// Delegation signature:
//   hookOutputIsAsync(json)
//
// No forwarded captures: upstream's body has ZERO free variables, which the
// build machine-checks in both directions.
import { hookOutputIsAsync } from "./hook-output-async/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookOutputIsAsync(...args) {
    return hookOutputIsAsync(...args);
  },
});
