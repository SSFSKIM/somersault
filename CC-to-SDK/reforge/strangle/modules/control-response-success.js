// ADAPTER — the graph-facing seam for the control_response success envelope.
//
// `captures: []` — verified zero free variables. Every headless control_response
// that succeeds passes through here.
import { controlResponseSuccess } from "./control-response-success/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  controlResponseSuccess(...args) {
    return controlResponseSuccess(...args);
  },
});
