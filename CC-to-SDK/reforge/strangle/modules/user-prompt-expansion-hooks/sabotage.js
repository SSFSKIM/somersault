// SABOTAGE LAYER (§2.5). Any scenario that registers a UserPromptExpansion hook
// MUST go red with this built: the harness records every consult, so a dispatcher
// that yields nothing leaves an events transcript the oracle's does not have, and
// the expander that reads `blockingError` off the results it never receives can
// no longer be refused. Sabotaged as if the guard had found nothing registered,
// which is this dispatcher's own no-op arm and therefore the shape a live
// scenario is most likely to be able to tell apart from a real run.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* userPromptExpansionHooks() {
  // no yields, no executor call: the prompt-expansion hooks never run
}
