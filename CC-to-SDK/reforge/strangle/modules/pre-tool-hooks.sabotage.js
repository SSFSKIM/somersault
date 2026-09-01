// SABOTAGE wiring — `hooks` MUST go red with this built.
import { preToolHooks } from "./pre-tool-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *preToolHooks() {
    return yield* preToolHooks();
  },
});
