// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { resolveThinkingConfig } from "./thinking-config/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  resolveThinkingConfig(...args) {
    return resolveThinkingConfig(...args);
  },
});
