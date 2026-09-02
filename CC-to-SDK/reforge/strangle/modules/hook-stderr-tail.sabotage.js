// SABOTAGE wiring — `hooks-command` and `hooks-precompact` MUST go red with this
// built.
import { hookStderrTail } from "./hook-stderr-tail/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookStderrTail(...args) {
    return hookStderrTail(...args);
  },
});
