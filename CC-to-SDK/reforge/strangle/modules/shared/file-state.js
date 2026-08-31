// File-state prose the file tools share, owned outright (§2.4 `primitive`).
//
// Upstream this is a single module-level constant in chunk-hx5r9amq.js (`q6t`
// at 2.1.251) imported by ONE chunk, where it is used TWICE: by the Write tool's
// result formatter and by the Edit tool's. Both formatters are reforge-owned, so
// without a shared home the same string would be transcribed twice and the two
// copies could drift apart silently — the coordination point the W2 scout named
// (reforge/research/2026-08-31-w2-schunk-scout.md §4). One constant, asserted
// from both adapters; a later wave that owns hx5r9amq re-exports this same
// binding rather than transcribing a third copy.
//
// Exact, and exactly as fussy as it looks: one leading space, an em dash
// (U+2014, not a hyphen), no trailing space. Independently confirmed against the
// recorded Write result in the `file-tools` cassette.
export const FRESHNESS_SUFFIX = " (file state is current in your context — no need to Read it back)";
