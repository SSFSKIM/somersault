// SABOTAGE wiring — `hooks-prompt-submit` and `perm-hook-deny` MUST go red with
// this built.
import { hookJsonContract } from "./hook-json-contract/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookJsonContract(...args) {
    return hookJsonContract(...args);
  },
});
