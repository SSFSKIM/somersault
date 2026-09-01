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
// than a defect. The walk arms no `canUseTool` — the SDK refuses to wire one for
// a session LAUNCHED in bypassPermissions anyway — so strip the launch fact and
// the plan turn's call falls through to an ASK that nobody in the session can
// answer: the turn produces no result, the driver's `for await` never advances,
// and the query never ends.
//
// THE PLAN TURN'S CALL IS A READ OUTSIDE THE ALLOWED DIRECTORIES, not a Write,
// and this header said otherwise for one round. The walk's earlier recording had
// no tool call in that turn at all, so the hang — which is real — was attributed
// to a call the cassette did not contain. Plan mode's injected reminder stops the
// model writing under any framing; a read outside the cwd is both permitted by
// the reminder and ask-worthy, which is what this twin needs.
// The gate reads a sabotaged replay that exceeds its bound as RED — the faithful
// build replays the same cassette in seconds — so this phase costs the gate its
// full sabotage timeout every run. That is the honest price of a twin whose
// divergence is severe enough to stop the session, and it is worth more than a
// milder twin that measures nothing.
export function transitionPermissionMode(from, to, context) {
  return { mode: context.mode };
}
