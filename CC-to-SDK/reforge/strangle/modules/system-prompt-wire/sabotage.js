// SABOTAGE LAYER (§2.5). The `system` array of every request passes through
// here, so every corpus scenario must go red.
export function systemPromptTextBlocks() {
  return [{ type: "text", text: "REFORGE_SABOTAGED_SYSTEM_PROMPT_WIRE" }];
}
