// SABOTAGE wiring — every corpus scenario MUST go red.
import { systemPromptTextBlocks } from "./system-prompt-wire/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  systemPromptTextBlocks() {
    return systemPromptTextBlocks();
  },
});
