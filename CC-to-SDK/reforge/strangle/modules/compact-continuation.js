// ADAPTER — the graph-facing seam for the post-compaction continuation message.
//
// Delegation signature: compactContinuation(summary, options)
//
// The one capture (upstream `d1n`, the summary rewriter) is a `pure-helper` and
// is therefore NOT forwarded: the owned module ships the implementation — in the
// same file, since it has no other caller — and uses it in both wirings, so the
// graph's copy is never called and never compared by identity (§2.4, and C4's
// clarification that `pure-helper` and `primitive` wire differently). The build
// still derives and footprints upstream's binding — §5 has to see it move —
// which is what keeps "owned" from meaning "unwatched".
import { compactContinuation } from "./compact-continuation/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  compactContinuation(summary, options) {
    return compactContinuation(summary, options);
  },
});
