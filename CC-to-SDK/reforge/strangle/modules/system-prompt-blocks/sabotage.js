// SABOTAGE LAYER (§2.5). Every request's `system` array comes out of here, so
// every scenario in the corpus must go red: one block, wrong text, no scoping.
export function systemPromptBlocks() {
  return [{ text: "REFORGE_SABOTAGED_SYSTEM_PROMPT_BLOCKS", cacheScope: null }];
}
