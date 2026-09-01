// SABOTAGE LAYER (§2.5). `hooks-prompt-submit` MUST go red with this built: the
// scenario registers a MessageDisplay callback and the harness records every
// consult, so a dispatcher that yields nothing leaves an events transcript the
// oracle's does not have. Still a generator on purpose — sabotaging the
// yield-preserving delegation would prove the shape, not the liveness.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* messageDisplayHooks() {
  // no yields, no executor call: the display hooks the session registered never run
}
