// Deliberately WRONG variant — proves the text-delta splice is live: it stamps
// a marker into every delta it folds in, so the assembled assistant text
// diverges from the oracle's and the `plain` scenario must go red.
//
// It appends the real delta as well, on purpose. Dropping the text outright
// also goes red, but it leaves the turn with an EMPTY assistant message, and
// the engine then retries the turn a dozen times against an exhausted cassette
// — minutes of gate time for the same one-bit answer. A sabotage twin should be
// wrong in a way that is loud and cheap, not wrong in a way that makes the
// engine flail.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  appendTextDelta(block, delta) {
    block.text += `REFORGE_SABOTAGED_DELTA:${delta.text}`;
  },
});
