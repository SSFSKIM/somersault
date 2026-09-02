// SABOTAGE wiring — every scenario whose hook answers with a RESULT document
// must go red with this built: the answer is discarded as an acknowledgement
// before anything reads it.
import { hookOutputIsAsync } from "./hook-output-async/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookOutputIsAsync(...args) {
    return hookOutputIsAsync(...args);
  },
});
