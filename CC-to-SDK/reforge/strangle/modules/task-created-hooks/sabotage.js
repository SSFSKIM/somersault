// SABOTAGE LAYER (§2.5). Any scenario that registers a TaskCreated hook MUST go
// red with this built: the harness records every consult, so a dispatcher that
// yields nothing leaves an events transcript the oracle's does not have — and
// the TaskCreate tool, which reads `blockingError` off the results it never
// receives, can no longer be refused.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* taskCreatedHooks() {
  // no yields, no executor call: the task-created hooks never run
}
