// SABOTAGE LAYER (§2.5). `hooks-prompt-submit` MUST go red with this built, and
// twice over: the scenario registers a UserPromptSubmit callback whose consult
// the harness records, and that callback's `additionalContext` is what the
// model's reply depends on — so a dispatcher that never runs it changes the
// transcript as well as the event log.
export const PROMPT_SUBMIT_TIMEOUT_MS = 30000;

export async function* userPromptSubmitHooks() {
  // no yields, no executor call: the prompt-submit hooks never run
}
