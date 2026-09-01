// SABOTAGE LAYER (§2.5). `search-tools` (full arm) and `search-tools-lean`
// (lean arm) MUST both go red with this built.
export function grepDescription(model, leanPrompt, subagentSteer) {
  leanPrompt(model);
  return "REFORGE_SABOTAGED_GREP_DESCRIPTION";
}
