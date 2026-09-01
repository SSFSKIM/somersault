// ADAPTER — the graph-facing seam for the safety-check finder.
//
// Delegation signature: findSafetyCheckReason(reason, accept)
//
// The filter parameter has a DEFAULT (`() => true`), which is a free variable of
// the body in the same way any parameter default is — here it is a literal
// arrow, so it contributes no capture.
import { findSafetyCheckReason } from "./safety-check-reason/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  findSafetyCheckReason(...args) {
    return findSafetyCheckReason(...args);
  },
});
