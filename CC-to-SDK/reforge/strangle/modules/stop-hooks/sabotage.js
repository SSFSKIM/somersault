// SABOTAGE LAYER (§2.5). Both covering scenarios MUST go red with this built:
// `hooks-prompt-submit` registers a Stop callback and `hooks-subagent`
// registers Stop and SubagentStop, and the harness records every consult — so a
// dispatcher that yields nothing leaves an events transcript the oracle's does
// not have, on both arms.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* stopHooks() {
  // no yields, no executor call: the turn-end hooks never run, on either arm
}
