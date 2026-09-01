// PARITY LAYER (§2.5 `reference`) — the context's system-prompt tail (upstream
// `NAt`, 2.1.251, chunk-fy12d89p).
//
// The same ambient-context map `context-reminder` renders as a user message is
// ALSO appended to the system prompt, in a different shape: one `key: value`
// line per entry, all of it as a single extra prompt block. That is where the
// `gitStatus:` paragraph in a Claude Code system prompt comes from.
//
// The two renderings are not redundant — they carry different maps. This one is
// called on every request from the query loop; on the reforge corpus its map is
// empty for the 26 scenarios that pass no `systemPrompt`, which is why
// `.filter(Boolean)` matters: joining an empty map yields `""`, and an empty
// string in the prompt list would become an empty block downstream. The two
// preset scenarios are the ones that give it something to render.
//
// `filter(Boolean)` is applied to the WHOLE list, not just the appended entry,
// so it also drops falsy blocks the caller passed in — behaviour the partition
// downstream would otherwise have to repeat.

/**
 * @param blocks  the prompt blocks assembled so far
 * @param context `{ [key]: value }` — the session's ambient context
 */
export function contextPromptLines(blocks, context) {
  const lines = Object.entries(context)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return [...blocks, lines].filter(Boolean);
}
