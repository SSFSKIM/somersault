// SABOTAGE wiring — `hooks-prompt-submit` MUST go red with this built.
import { userPromptSubmitHooks } from "./user-prompt-submit-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *userPromptSubmitHooks() {
    return yield* userPromptSubmitHooks();
  },
});
