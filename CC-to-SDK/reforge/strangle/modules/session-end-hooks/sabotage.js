// SABOTAGE LAYER (§2.5). `hooks-session-end` MUST go red with this built: the
// scenario drives `/clear`, which is upstream's one headlessly reachable call
// site, and registers a SessionEnd callback whose consult the harness records —
// so a dispatcher that never asks the executor for anything leaves an events
// transcript the oracle's does not have.
export const SESSION_END_TIMEOUT_MS = 1500;

export async function sessionEndHooks() {
  // as if the session had ended with no hooks to run and nothing to clear
}
