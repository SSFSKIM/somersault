// SABOTAGE LAYER (§2.5). The compaction recording MUST go red with this built:
// one `/compact` drives `tz` and then `kPe`, so the same run that records the
// PreCompact consult records this one's — and a dispatcher that never asks the
// executor for anything leaves an events transcript the oracle's does not have.
//
// The empty verdict is upstream's own zero-results return, so the compaction
// still completes and the recording stays a difference in HOOK DISPATCH rather
// than a crash after the summary.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function postCompactHooks() {
  return {};
}
