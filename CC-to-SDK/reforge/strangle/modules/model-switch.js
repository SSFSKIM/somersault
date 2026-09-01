// ADAPTER — the graph-facing seam for the set_model handler.
//
// Delegation signature: the request and the caller's surface, then eighteen
// forwarded `effectful-port` captures (§2.4). All eighteen are ports rather than
// owned helpers for the same reason: every one of them either reads session or
// account state, writes telemetry, or renders a sentence out of a table this
// wave does not own. The two error sentences the handler emits ITSELF are owned
// outright inside the reference module, where they are plain string literals.
import { applyModelSwitchRequest } from "./model-switch/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  applyModelSwitchRequest(request, surface, ...ports) {
    return applyModelSwitchRequest(request, surface, ...ports);
  },
});
