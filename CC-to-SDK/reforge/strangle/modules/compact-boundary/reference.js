// PARITY LAYER (§2.5 `reference`) — the internal `compact_boundary` frame
// (upstream `H1`, 2.1.251, chunk-fy12d89p).
//
// EVERY compaction in the engine ends here. Manual `/compact`, the reactive
// path and the automatic one all converge on this one constructor, so this
// object is the whole observable record of a compaction: the SDK re-shapes it
// onto the wire (`compact-boundary-wire`, upstream `rSe`) and the session store
// appends it to the transcript. Three call sites, one shape.
//
// WHAT IS AND IS NOT A DECISION HERE. Almost every field is a constant or a
// straight copy of an argument; the two that carry judgement are the ones a
// reimplementation would get wrong:
//
//   the `logicalParentUuid` SPREAD — the field is present only when the caller
//     has a parent to name. An engine that always emitted the key (as `null`,
//     say) would produce a different transcript entry and a different wire
//     object, since the SDK's mapper keys off `!== undefined`.
//   `compactMetadata` is a FIXED FOUR — trigger, preTokens, userContext and
//     messagesSummarized. The callers then MUTATE the returned object to add
//     `durationMs`, `postTokens`, `precomputed` and
//     `preCompactDiscoveredTools`, so those are deliberately absent here rather
//     than forgotten. Constructing them would double-write fields the caller
//     owns.
//
// The two things this module cannot own are the two nondeterministic ones: the
// uuid (upstream reaches `crypto.randomUUID` directly, so it crosses as a port)
// and the wall clock, which is ambient and which the differ scrubs by key.

/**
 * @param trigger             "manual" | "auto" (and upstream's reactive callers pass "auto")
 * @param preTokens           the context size measured before the compaction ran
 * @param logicalParentUuid   the last pre-compaction message, when there is one
 * @param userContext         the caller's custom `/compact` instructions, when given
 * @param messagesSummarized  how many messages went into the summary
 * @param uuid                () -> string   fresh identifier (port)
 */
export function compactBoundary(trigger, preTokens, logicalParentUuid, userContext, messagesSummarized, uuid) {
  return {
    type: "system",
    subtype: "compact_boundary",
    content: "Conversation compacted",
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: uuid(),
    level: "info",
    compactMetadata: { trigger, preTokens, userContext, messagesSummarized },
    // Spreading a falsy value contributes nothing, which is upstream's own idiom
    // for "omit the key entirely" — not the same as emitting it undefined.
    ...(logicalParentUuid && { logicalParentUuid }),
  };
}
