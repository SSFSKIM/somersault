// SABOTAGE LAYER (§2.5). `hooks-subagent` MUST go red with this built: the
// scenario registers a SubagentStart callback and the harness records every
// consult, so a dispatcher that yields nothing leaves an events transcript the
// oracle's does not have.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* subagentStartHooks() {
  // no yields, no executor call: the subagent-start hooks never run
}
