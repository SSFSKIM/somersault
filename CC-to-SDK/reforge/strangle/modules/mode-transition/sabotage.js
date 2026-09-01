// SABOTAGE LAYER (§2.5). The transition rebuilds the context from scratch
// instead of carrying the old one forward: every side effect is skipped AND
// every launch fact is dropped, so a session that was launched with
// --dangerously-skip-permissions stops knowing it.
//
// Observable, which the obvious mutant is not: returning the context unchanged
// skips the same side effects and was MEASURED INERT, because nothing a headless
// turn can see reads them. Dropping `isBypassPermissionsModeAvailable` is what a
// naive "return the new context" reimplementation actually does, and it changes
// a real decision — the pre-check's plan-with-bypass-available allow arm turns
// into a refusal.
export function transitionPermissionMode(from, to, context) {
  return { mode: context.mode };
}
