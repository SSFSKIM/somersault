// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { controlResponseError } from "./control-response-error/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  controlResponseError(...args) {
    return controlResponseError(...args);
  },
});
