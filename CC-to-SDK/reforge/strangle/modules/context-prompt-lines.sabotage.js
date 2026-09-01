// SABOTAGE wiring — the two preset scenarios MUST go red; they are the ones
// whose context map is non-empty, so they are the ones that render this.
import { contextPromptLines } from "./context-prompt-lines/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  contextPromptLines() {
    return contextPromptLines();
  },
});
