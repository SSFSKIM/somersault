// SABOTAGE LAYER (§2.5). `hooks-session-start` MUST go red with this built: the
// scenario registers a SessionStart COMMAND hook that writes the record into the
// sandbox, so a dispatcher that never asks the executor for anything leaves the
// file unwritten — a difference the state surface hashes and the substance check
// names. Sabotaged at the dispatch rather than at the record, because a callback
// cannot reach this dispatcher at all and the file is the only surface it has.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;
export const ACTIVITY_HOLD = "startup-hook-hold";

export async function* sessionStartHooks() {
  // as if the session had started with no hooks to run
}
