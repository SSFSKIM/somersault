// SABOTAGE LAYER (§2.5). `hooks-batch` MUST go red with this built: the scenario
// registers a PostToolBatch callback and the harness records the consult, so a
// dispatcher that refuses every batch leaves an events transcript the oracle's
// does not have. Sabotaged at the GUARD rather than at the yield, because the
// guard is the half of this dispatcher a callback corpus can actually see.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* postToolBatchHooks() {
  // as if no hook were ever registered for the event
}
