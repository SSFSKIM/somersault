// SABOTAGE LAYER (§2.5). `hooks` MUST go red with this built: the scenario
// registers a PostToolUse callback and the harness records every consult, so a
// dispatcher that yields nothing produces an events transcript the oracle's does
// not have. Deliberately still a generator — sabotaging the yield-preserving
// delegation into a non-generator would prove the shape, not the liveness.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* postToolHooks() {
  // no yields, no executor call: the hooks the session registered never run
}
