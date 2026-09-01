// SABOTAGE wiring — every corpus scenario MUST go red: one of the three
// sentences this picks opens every system prompt.
import { identityPrompt } from "./identity-prompt/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  identityPrompt() {
    return identityPrompt();
  },
});
