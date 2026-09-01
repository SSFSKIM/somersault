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
//
// EXPECTED: THIS TWIN MAKES THE MODE WALK HANG, and that is its verdict rather
// than a defect. The walk arms no `canUseTool`, because a bypass-available
// session never needs one; strip the launch fact and the plan-mode Write falls
// through to an ASK that nobody in the session can answer, so the turn produces
// no result, the driver's `for await` never advances, and the query never ends.
// The gate reads a sabotaged replay that exceeds its bound as RED — the faithful
// build replays the same cassette in seconds — so this phase costs the gate its
// full sabotage timeout every run. That is the honest price of a twin whose
// divergence is severe enough to stop the session, and it is worth more than a
// milder twin that measures nothing.
export function transitionPermissionMode(from, to, context) {
  return { mode: context.mode };
}
