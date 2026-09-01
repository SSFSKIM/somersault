// PARITY LAYER (§2.5 `reference`) — the boundary's metadata on the wire
// (upstream `rSe`, 2.1.251, chunk-fy12d89p).
//
// The only translation between the engine's internal `compactMetadata` (built by
// `compact-boundary`) and the `compact_metadata` object an SDK consumer reads.
// One definition, one call site, and it is what `slash-compact`'s substance
// check has been asserting since the corpus began: `pre_tokens` exists nowhere
// else in the graph.
//
// THE SHAPE IS THE CONTRACT, in three parts, and each is a way to get it wrong:
//
//   camelCase -> snake_case, per field. There is no generic transformer behind
//     this; every name is written out, and `preTokens` -> `pre_tokens` is the
//     only mapping any recording has ever depended on.
//   PRESENCE is `!== undefined`, not truthiness. `post_tokens: 0` and
//     `cumulative_dropped_tokens: 0` are real measurements and must survive; a
//     `value && {…}` rewrite would silently drop every zero.
//   `trigger` and `pre_tokens` are UNCONDITIONAL and lead. Everything after them
//     is optional, so the two that are always there are also the two an engine
//     cannot omit.
//
// The two nested objects are the exception to the per-field rule that matters:
// `preservedSegment` is destructured and rebuilt as a fixed triple, while
// `preservedMessages` rebuilds two fixed fields and then conditionally adds
// `all_uuids`. A reimplementation that spread either object wholesale would leak
// the engine's internal camelCase keys onto the wire.
//
// `captures: []` — verified zero free variables. This module reads nothing but
// its argument, which is why it is the cheapest owned unit in the wave.

/**
 * @param metadata the boundary's own `compactMetadata`, after the callers have
 *                 finished mutating it (durations, post-token counts and the
 *                 discovered-tool list are added by the compaction drivers, not
 *                 by the constructor)
 */
export function compactBoundaryWire(metadata) {
  const { preservedSegment, preservedMessages } = metadata;
  return {
    trigger: metadata.trigger,
    pre_tokens: metadata.preTokens,
    ...(metadata.postTokens !== undefined && { post_tokens: metadata.postTokens }),
    ...(metadata.cumulativeDroppedTokens !== undefined && { cumulative_dropped_tokens: metadata.cumulativeDroppedTokens }),
    ...(metadata.durationMs !== undefined && { duration_ms: metadata.durationMs }),
    ...(metadata.userContext !== undefined && { user_context: metadata.userContext }),
    ...(metadata.messagesSummarized !== undefined && { messages_summarized: metadata.messagesSummarized }),
    ...(metadata.precomputed !== undefined && { precomputed: metadata.precomputed }),
    ...(metadata.preCompactDiscoveredTools !== undefined && { pre_compact_discovered_tools: metadata.preCompactDiscoveredTools }),
    ...(preservedSegment && {
      preserved_segment: {
        head_uuid: preservedSegment.headUuid,
        anchor_uuid: preservedSegment.anchorUuid,
        tail_uuid: preservedSegment.tailUuid,
      },
    }),
    ...(preservedMessages && {
      preserved_messages: {
        anchor_uuid: preservedMessages.anchorUuid,
        uuids: preservedMessages.uuids,
        ...(preservedMessages.allUuids !== undefined && { all_uuids: preservedMessages.allUuids }),
      },
    }),
  };
}
