// ADAPTER — the graph-facing seam for the streaming assembler's text_delta arm.
// Delegation signature: appendTextDelta(block, delta, recordStreamingError).
// The telemetry brands are owned and not forwarded (§2.4 `pure-helper`).
import { appendTextDelta } from "./text-delta/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  appendTextDelta(block, delta, recordStreamingError) {
    return appendTextDelta(block, delta, recordStreamingError);
  },
});
