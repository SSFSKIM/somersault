// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { handleInitialize } from "./initialize-handler/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  handleInitialize(...args) {
    return handleInitialize(...args);
  },
});
