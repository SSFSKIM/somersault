// ADAPTER — the graph-facing seam for the context's system-prompt tail.
//
// Delegation signature: contextPromptLines(blocks, context)
//
// `captures: []` is the verified claim that the excised body reads nothing from
// its scope, so this adapter forwards its two parameters and nothing else.
import { contextPromptLines } from "./context-prompt-lines/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  contextPromptLines(blocks, context) {
    return contextPromptLines(blocks, context);
  },
});
