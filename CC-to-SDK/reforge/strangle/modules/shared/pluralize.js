// English pluralization, owned outright (§2.4 `pure-helper`).
//
// Upstream, at 2.1.251, `k` in chunk-04aem4bh — 41 bytes and used throughout the
// engine, which is why it is a `pure-helper` rather than a fold-in: the copies
// this campaign leaves in place have their own callers, so upstream's stays live
// and the two are compared against each other by the parity oracle.
//
// THE DEFAULT IS THE INTERESTING PART. The plural argument defaults to
// `singular + "s"`, so a caller that passes only two arguments is relying on
// naive suffixing — and the permission-message builder passes THREE for one of
// its two uses (`requires` / `require`) and TWO for the other (`part`). Both are
// behaviour: the sentence a user reads when a compound Bash command needs
// approval says "The following 2 parts require approval", and getting either
// half wrong changes it.
//
// Only `count === 1` is singular. Zero is plural ("0 parts"), which is correct
// English and is also the arm no scenario will ever render.

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural] defaults to `singular + "s"`
 */
export function pluralize(count, singular, plural = singular + "s") {
  return count === 1 ? singular : plural;
}
