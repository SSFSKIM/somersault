// PARITY LAYER (§2.5 `reference`) — "is this hook-output document SYNCHRONOUS?"
// (upstream `ip`, 2.1.251, chunk-fy12d89p @653684, 52 bytes).
//
// ONE OF THE TWO SPLICES C10.6's FIX ROUND TAKES TO PROVE A CORRECTED CLAIM.
// The wave reported "the belt is not takeable by anchor" — 84 of 151 with no
// string literal, four of 43 pure ones uniquely anchorable. That measured
// STRING LITERALS OF TWELVE CHARACTERS OR MORE, which is not what an anchor is:
// `strangle/anchor.ts` asks for a true-substring-unique span carrying no
// minified identifier, and says nothing about prose. Re-derived by that rule,
// 125 of the 151 declarations are anchorable and 31 of the 40 pure ones are.
// This helper is one of them, and its anchor — `){return!(("async"in ` — is a
// STRUCTURAL fragment with no literal in it at all.
//
// AND IT IS ADJUDICATED DARK, which is a measurement rather than a
// disappointment. It was spliced expecting liveness and the inverted twin was
// replayed over twelve scenarios; all stayed GREEN, while the sibling row's
// identically-shaped twin reddens two of them. The predicate IS called — the
// branch attestation records its false arm — but every consumer of the answer
// is dominated by a second condition the corpus never satisfies. The manifest
// row carries the population and the argument.
//
// WHAT IT DECIDES. A hook may answer with an ASYNC ACKNOWLEDGEMENT
// (`{"async":true, "asyncTimeout":…}`) instead of a result document; upstream's
// schema is a union of the two. This predicate is the discriminator, and it is
// read as a TYPE GUARD at nineteen call sites before anything reads `decision`,
// `systemMessage`, `metrics`, `hookSpecificOutput` or `terminalSequence` off the
// document. Four consumers use it: the awaiting executor, the streaming
// executor, the terminal-sequence sink and the standalone callback runner.
//
// TWO DECISIONS IN FIFTY-TWO BYTES, and each is a wrong turn a reimplementation
// could take quietly:
//
//   the key is tested with `in`, not by truthiness, so a document is only ever
//       async when it SAYS so — but the presence test alone is not enough,
//       which is the second decision.
//   the value is compared against `true` by identity, so `{"async":false}` and
//       `{"async":"yes"}` are SYNCHRONOUS. A `!("async" in json)` rewrite agrees
//       with this one on every document the corpus produces and disagrees on
//       exactly those two — the quiet direction, which is why the sabotage twin
//       is the inverted one instead.
//
// The negation wraps the whole conjunction, so this is the exact complement of
// `hook-output-async`. They are two separate 47- and 52-byte declarations
// upstream rather than one and its negation, and the copy keeps that shape:
// collapsing them would be a refactor, and this layer reproduces.

/**
 * @param json a parsed hook-output document
 * @returns true when it is a result document rather than an async acknowledgement
 */
export function hookOutputIsSync(json) {
  return !("async" in json && json.async === true);
}
