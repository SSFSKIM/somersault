// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { workflowDescription } from "./workflow-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { AGENT_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  workflowDescription(agentToolName) {
    assertGraphValue("workflow-description", "agentToolName", agentToolName, AGENT_TOOL_NAME);
    return workflowDescription();
  },
});
