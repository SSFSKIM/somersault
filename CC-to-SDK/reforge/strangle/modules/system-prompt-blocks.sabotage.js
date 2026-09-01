// SABOTAGE wiring — every corpus scenario MUST go red with this built: the
// `system` array of every request is this function's output.
import { systemPromptBlocks } from "./system-prompt-blocks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  systemPromptBlocks() {
    return systemPromptBlocks();
  },
});
