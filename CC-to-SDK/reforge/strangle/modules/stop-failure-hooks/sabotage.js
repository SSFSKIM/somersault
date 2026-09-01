// SABOTAGE LAYER (§2.5). The api-error recording MUST go red with this built:
// the cassette serves an authored 500, the turn ends in an isApiErrorMessage
// arm, and `HPe` dispatches with a StopFailure hook registered — so a dispatcher
// that never asks the executor for anything leaves an events transcript the
// oracle's does not have.
//
// It returns silently, which is upstream's own refusal shape, so the failing turn
// still fails the way it failed and the recording stays a difference in HOOK
// DISPATCH rather than a second error on the error path.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function stopFailureHooks() {
  // as if no StopFailure hook were registered for this session
}
