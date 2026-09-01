// SABOTAGE LAYER (§2.5). Called on every request, but only OBSERVABLE where the
// context map is non-empty — the two preset scenarios. Dropping the caller's own
// blocks is what makes it red everywhere it is graded.
export function contextPromptLines() {
  return ["REFORGE_SABOTAGED_CONTEXT_PROMPT_LINES"];
}
