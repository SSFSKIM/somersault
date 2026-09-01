// SABOTAGE wiring — `hooks-prompt-submit` MUST go red with this built.
import { messageDisplayHooks } from "./message-display-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *messageDisplayHooks() {
    return yield* messageDisplayHooks();
  },
});
