// SABOTAGE LAYER (§2.5). The identity sentence opens every system prompt, so
// every corpus scenario must go red — including `sysprompt-append`, whose
// recording carries the OTHER arm's sentence.
export function identityPrompt() {
  return "REFORGE_SABOTAGED_IDENTITY_PROMPT";
}
