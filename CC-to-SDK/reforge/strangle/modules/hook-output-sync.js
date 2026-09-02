// ADAPTER — the graph-facing seam for the sync/async hook-output discriminator.
//
// Delegation signature:
//   hookOutputIsSync(json)
//
// No forwarded captures: upstream's body has ZERO free variables, which the
// build machine-checks in both directions. `captures: []` on the manifest row is
// therefore the positive claim "verified zero", not an omission.
import { hookOutputIsSync } from "./hook-output-sync/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookOutputIsSync(...args) {
    return hookOutputIsSync(...args);
  },
});
