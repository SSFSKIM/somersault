// SABOTAGE wiring — every scenario whose hook answers with a RESULT document
// must go red with this built: the discriminator refuses the documents it exists
// to admit.
import { hookOutputIsSync } from "./hook-output-sync/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookOutputIsSync(...args) {
    return hookOutputIsSync(...args);
  },
});
