// SABOTAGE LAYER (§2.5). `hooks-precompact` MUST go red with this built: the
// scenario drives a real `/compact` with a PreCompact callback registered and
// the harness records the consult, so a dispatcher that never asks the executor
// for anything leaves an events transcript the oracle's does not have.
//
// The empty verdict is upstream's own zero-results return, so the compaction
// still completes and the recording stays a difference in HOOK DISPATCH rather
// than a crash on the compaction path.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function preCompactHooks() {
  return {};
}
