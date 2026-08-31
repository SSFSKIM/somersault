// reforge-owned reimplementation of the streaming assembler's `text_delta` arm
// (2.1.251, chunk-fy12d89p): the step that folds one SSE text delta into the
// content block being assembled.
//
// W0a mechanism spike for the SWITCH-CASE target shape (campaign spec C1). The
// clause is replaced by a statement-level delegation plus the `break` it ended
// with. A case clause has no parameter list of its own, so EVERY value it takes
// from its scope is a manifest-declared capture, each re-derived per build.
//
// Three of the clause's five free variables cross the adapter as
// `effectful-port` captures — two are live mutable state belonging to the
// streaming loop, one is the telemetry sink. Their far side is W13's query loop
// / turn driver:
//
//   block                     the content block under assembly; `.text` is appended in place
//   delta                     the SSE delta frame ({ type:"text_delta", text })
//   recordStreamingError(event, payload)   telemetry for a malformed stream
//
// The other two are OWNED here (§2.4 `pure-helper`). Upstream they are `w` and
// `c` from chunk-9rhc0mtn.js — a chunk of one-line wrappers over
// `function r(n){return n}`, i.e. an erased type brand: `w` marks a value as a
// known enum rather than free text, `c` marks one as untrusted and to be
// stringified. Both are the identity function at runtime, so per §2.4 the owned
// module ships its own and the graph's are neither called nor identity-compared.
// They are still derived and footprinted per build: an upstream change that
// gave either wrapper real behaviour must stale this row rather than pass
// silently.
//
// Contract detail: the telemetry call happens BEFORE the throw (upstream writes
// it as `throw record(...), Error(...)`, whose comma operator does exactly that),
// and the mismatch check runs against the block, not the delta.

/** Telemetry brand: this value is a known enum member, not free text. */
const known = (value) => value;
/** Telemetry brand: this value is untrusted and reported as-is. */
const describe = (value) => value;

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  appendTextDelta(block, delta, recordStreamingError) {
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
