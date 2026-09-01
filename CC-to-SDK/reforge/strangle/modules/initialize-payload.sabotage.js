// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { buildInitializeResponsePayload } from "./initialize-payload/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  buildInitializeResponsePayload(...args) {
    return buildInitializeResponsePayload(...args);
  },
});
