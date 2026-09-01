// ADAPTER — the graph-facing seam for the compaction summarization prompt.
//
// Delegation signature: summarizationPrompt() -> string, evaluated once when the
// owning chunk's body runs. The reforge module is injected as an `import`, and
// ESM evaluates a module's dependencies before its own body, so the value is
// there by the time the declarator initializes.
import { summarizationPrompt } from "./compaction-prompt/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  summarizationPrompt() {
    return summarizationPrompt();
  },
});
