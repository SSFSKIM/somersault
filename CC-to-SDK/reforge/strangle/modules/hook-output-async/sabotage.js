// SABOTAGE LAYER (§2.5).
//
// THE TWIN IS THE INVERTED ONE, on the same argument the sync half makes: a
// truthiness test or a bare presence test differs only on documents no corpus
// hook emits, and would fail in the quiet direction.
//
// This one reads EVERY result document as an async acknowledgement, so the
// backgrounding path is taken for hooks that answered synchronously — the
// result is discarded before anything interprets it.
export function hookOutputIsAsync(json) {
  return !("async" in json && json.async === true);
}
