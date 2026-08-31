// reforge-owned reimplementation of the streaming assembler's `text_delta` arm
// (2.1.251, chunk-fy12d89p): the step that folds one SSE text delta into the
// content block being assembled.
//
// W0a mechanism spike for the SWITCH-CASE target shape (campaign spec C1). The
// clause is replaced by a statement-level delegation plus the `break` it ended
// with. A case clause has no parameter list of its own, so EVERY value it takes
// from its scope is a manifest-declared capture, each re-derived per build.
//
// All five are `effectful-port` in the §2.4 sense: two are live mutable state
// belonging to the streaming loop, three are the engine's telemetry plumbing.
// Their far side is W13's query loop / turn driver.
//
//   block                     the content block under assembly; `.text` is appended in place
//   delta                     the SSE delta frame ({ type:"text_delta", text })
//   recordStreamingError(event, payload)   telemetry for a malformed stream
//   known(value)              marks a value as a known enum, not free text, for telemetry
//   describe(value)           coerces an untrusted value for telemetry
//
// Contract detail: the telemetry call happens BEFORE the throw (upstream writes
// it as `throw record(...), Error(...)`, whose comma operator does exactly that),
// and the mismatch check runs against the block, not the delta.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  appendTextDelta(block, delta, recordStreamingError, known, describe) {
    if (block.type !== "text") {
      recordStreamingError("tengu_streaming_error", {
        error_type: known("content_block_type_mismatch_text"),
        expected_type: known("text"),
        actual_type: describe(block.type),
      });
      throw Error("Content block is not a text block");
    }
    block.text += delta.text;
  },
});
