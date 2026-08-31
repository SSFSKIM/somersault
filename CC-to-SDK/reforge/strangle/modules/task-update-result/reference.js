// PARITY LAYER (§2.5 `reference`) — the TaskUpdate tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the TaskUpdate
// tool's object literal (2.1.251, chunk-fy12d89p).
//
// TWO TYPED PORTS (§2.4 `effectful-port`), both belonging to the agent-teams
// subsystem a later wave owns:
//
//   agentTeamContext() -> boolean   is there a current agent/team identity
//                                   (upstream reads the session's agent id, then
//                                   the dynamic team context)
//   agentTeamsEnabled() -> boolean  env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS or
//                                   the host predicate, AND the `tengu_amber_flint`
//                                   gate
//
// They gate the completion nudge, and BOTH are false on a headless run, so that
// branch is DARK in the corpus. Stated here rather than implied by a green gate:
// `task-family` covers the formatter, not the nudge. The nudge's text is graded
// by the contract test with the ports stubbed true.
export function taskUpdateResultBlock(output, toolUseId, agentTeamContext, agentTeamsEnabled) {
  const { success, taskId, updatedFields, error, statusChange } = output;
  if (!success) {
    return { tool_use_id: toolUseId, type: "tool_result", content: error || `Task #${taskId} not found` };
  }
  let content = `Updated task #${taskId} ${updatedFields.join(", ")}`;
  if (statusChange?.to === "completed" && agentTeamContext() && agentTeamsEnabled()) {
    content += `\n\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.`;
  }
  return { tool_use_id: toolUseId, type: "tool_result", content };
}
