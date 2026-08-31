// ADAPTER — the graph-facing seam for the TaskUpdate result formatter.
//
// Delegation signature:
//   taskUpdateResultBlock(output, toolUseId, agentTeamContext, agentTeamsEnabled)
//
// Both captures are `effectful-port`s: they cross as typed delegation arguments
// and are recorded as ledger edges to the agent-teams subsystem.
import { taskUpdateResultBlock } from "./task-update-result/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  taskUpdateResultBlock(output, toolUseId, agentTeamContext, agentTeamsEnabled) {
    return taskUpdateResultBlock(output, toolUseId, agentTeamContext, agentTeamsEnabled);
  },
});
