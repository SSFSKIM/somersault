// SABOTAGE LAYER (§2.5). Every request resolves to a DISABLED config.
//
// Observable for a named reason rather than a plausible one (C9's rule): the
// request builder gates thinking on `type !== "disabled"`, so a disabled config
// is the one answer that removes the `thinking` block from the turn's request
// body entirely. The obvious mutant — returning the requested budget under the
// wrong type — would have been measured INERT, because the builder discards
// `budgetTokens` on an adaptive-capable model and only the display survives.
export function resolveThinkingConfig() {
  return { type: "disabled" };
}
