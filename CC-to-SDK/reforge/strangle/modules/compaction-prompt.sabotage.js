// SABOTAGE wiring — `slash-compact` MUST go red with this built.
import { summarizationPrompt } from "./compaction-prompt/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  summarizationPrompt() {
    return summarizationPrompt();
  },
});
