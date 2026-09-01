// SABOTAGE wiring — every scenario that compacts MUST go red.
import { compactContinuation } from "./compact-continuation/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  compactContinuation(summary, options) {
    return compactContinuation(summary, options);
  },
});
