// SABOTAGE LAYER (§2.5). A dispatched agent's whole system prompt comes from
// here, so `subagent` and `background-task` must go red — their recorded request
// bodies carry the four-part shape this replaces with one line.
export async function subagentPrompt() {
  return ["REFORGE_SABOTAGED_SUBAGENT_PROMPT"];
}
