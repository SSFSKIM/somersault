// SABOTAGE wiring — any scenario that registers a UserPromptExpansion hook MUST
// go red with this built.
import { userPromptExpansionHooks } from "./user-prompt-expansion-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *userPromptExpansionHooks() {
    return yield* userPromptExpansionHooks();
  },
});
