// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { controlResponseSuccess } from "./control-response-success/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  controlResponseSuccess(...args) {
    return controlResponseSuccess(...args);
  },
});
