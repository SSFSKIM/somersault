// ADAPTER — the graph-facing seam for the control_response error envelope.
//
// `captures: []` — verified zero free variables.
import { controlResponseError } from "./control-response-error/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  controlResponseError(...args) {
    return controlResponseError(...args);
  },
});
