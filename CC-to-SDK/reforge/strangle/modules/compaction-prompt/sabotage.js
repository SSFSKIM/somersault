// SABOTAGE LAYER (§2.5). `slash-compact` MUST go red: the prompt is sent in the
// summarization request body, so one changed line is a cassette miss on replay.
export const SUMMARIZATION_PROMPT = "REFORGE_SABOTAGED_SUMMARIZATION_PROMPT";

export function summarizationPrompt() {
  return SUMMARIZATION_PROMPT;
}
