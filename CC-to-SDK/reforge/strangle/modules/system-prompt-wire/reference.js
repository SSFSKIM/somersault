// PARITY LAYER (§2.5 `reference`) — scoped prompt blocks to API `text` blocks
// (upstream `U8n`, 2.1.251, chunk-fy12d89p).
//
// The last step before the request body: it takes the partition's
// `{ text, cacheScope }` pairs and produces the `system` array the API sees,
// attaching `cache_control` to every block the partition scoped and to no
// others. Small, and directly cost-bearing — a dropped `cache_control` is a
// cache miss on every turn, and a wrongly-added one is a write the caller did
// not ask for.
//
// TWO CONDITIONS GUARD THE ATTACHMENT, and they are not the same claim:
//   `cachingEnabled` is the caller's switch for this request;
//   `cacheScope !== null` is the partition's per-block decision.
// Upstream spreads a conditional expression (`...t && s !== null && {…}`), which
// spreads `false` — a no-op — when either fails. The explicit conditional below
// is the same behaviour said once.
//
// The partition is reached as a PORT rather than imported directly: it is the
// graph's binding, which this same wave has already delegated to
// `system-prompt-blocks`, so the call still lands in owned code while the
// delegation chain stays honest about where the boundary is. It is a port and
// not a `pure-helper` because it emits telemetry — and because its own six
// captures are the graph's to supply, not this module's.

/**
 * @param blocks         the flat prompt list
 * @param cachingEnabled whether this request may carry cache breakpoints at all
 * @param options        `{ skipGlobalCacheForSystemPrompt, cacheTtl }`, or undefined
 * @param partition      (blocks, opts) -> [{ text, cacheScope }]   (port)
 * @param cacheControl   ({ scope, ttl }) -> object                 (port)
 */
export function systemPromptTextBlocks(blocks, cachingEnabled, options, partition, cacheControl) {
  return partition(blocks, { skipGlobalCacheForSystemPrompt: options?.skipGlobalCacheForSystemPrompt }).map((block) => {
    const wire = { type: "text", text: block.text };
    if (cachingEnabled && block.cacheScope !== null) {
      wire.cache_control = cacheControl({ scope: block.cacheScope, ttl: options?.cacheTtl });
    }
    return wire;
  });
}
