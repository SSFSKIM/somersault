// ADAPTER — the graph-facing seam for the initialize control handler.
//
// Delegation signature: upstream's fourteen parameters, then thirty forwarded
// `effectful-port` captures (§2.4). Every one is a port and none is owned: this
// handler's job IS effects — it mutates the launch options, registers hook
// callbacks, updates app state, and enqueues frames — so there is no pure helper
// among its closure. The list is the honest price of the row, and it is
// machine-checked in both directions by strangle/scope.ts.
//
// One of the ports is another owned splice: `initialize-payload`. It is
// forwarded rather than imported so the delegation chain stays intact —
// sabotaging the payload alone still reddens through this handler.
import { handleInitialize } from "./initialize-handler/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  handleInitialize(...args) {
    return handleInitialize(...args);
  },
});
