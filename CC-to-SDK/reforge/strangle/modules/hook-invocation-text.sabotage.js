// SABOTAGE wiring — a command hook declared with args must run without them
// with this built, so every scenario that executes such a hook goes red.
import { hookInvocationText } from "./hook-invocation-text/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookInvocationText(...args) {
    return hookInvocationText(...args);
  },
});
