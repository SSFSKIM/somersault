// PARITY LAYER (§2.5 `reference`) — the streaming assembler's `text_delta` arm
// (2.1.251, chunk-fy12d89p): the step that folds one SSE text delta into the
// content block being assembled.
//
// W0a's mechanism spike for the SWITCH-CASE target shape. A case clause has no
// parameter list, so EVERY value it takes from its scope is a manifest-declared
// capture. Three remain as typed ports into W13's query loop / turn driver:
//
//   block                     the content block under assembly; `.text` is appended in place
//   delta                     the SSE delta frame ({ type:"text_delta", text })
//   recordStreamingError(event, payload)   telemetry for a malformed stream
//
// The other two are owned (§2.4 `pure-helper`). Upstream they are `w` and `c`
// from chunk-9rhc0mtn.js — one-line wrappers over `function r(n){return n}`, an
// erased type brand: `w` marks a value as a known enum rather than free text,
// `c` marks one as untrusted and to be stringified. Both are the identity
// function at runtime, and they are still derived and footprinted per build, so
// an upstream change that gave either real behaviour stales this row rather than
// passing silently.
//
// Contract detail: the telemetry call happens BEFORE the throw (upstream writes
// it as `throw record(...), Error(...)`, whose comma operator does exactly
// that), and the mismatch check runs against the block, not the delta.

/** Telemetry brand: this value is a known enum member, not free text. */
export const known = (value) => value;
/** Telemetry brand: this value is untrusted and reported as-is. */
export const describe = (value) => value;

export function appendTextDelta(block, delta, recordStreamingError) {
  if (block.type !== "text") {
    recordStreamingError("tengu_streaming_error", {
      error_type: known("content_block_type_mismatch_text"),
      expected_type: known("text"),
      actual_type: describe(block.type),
    });
    throw Error("Content block is not a text block");
  }
  block.text += delta.text;
}
