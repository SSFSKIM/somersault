// SABOTAGE LAYER (§2.5). Any scenario that registers a TaskCompleted hook MUST
// go red with this built: the harness records every consult, so a dispatcher that
// yields nothing leaves an events transcript the oracle's does not have — and it
// silences BOTH dispatch sites at once, the TaskUpdate completion arm and the
// teammate loop.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* taskCompletedHooks() {
  // no yields, no executor call: the task-completed hooks never run
}
