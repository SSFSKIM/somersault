// ADAPTER — the graph-facing seam for scoped blocks -> API `text` blocks.
//
// Delegation signature:
//   systemPromptTextBlocks(blocks, cachingEnabled, options, partition, cacheControl)
//
// Both captures are ports. `partition` is the graph's binding for the block
// partition, which this same wave delegates to `system-prompt-blocks` — so the
// call lands in owned code by way of the graph rather than by import, and the
// ledger records the edge instead of the chain pretending to be closed.
import { systemPromptTextBlocks } from "./system-prompt-wire/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  systemPromptTextBlocks(blocks, cachingEnabled, options, partition, cacheControl) {
    return systemPromptTextBlocks(blocks, cachingEnabled, options, partition, cacheControl);
  },
});
