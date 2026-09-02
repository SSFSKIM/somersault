// ADAPTER — the graph-facing seam for the workflow description.
//
// Delegation signature:
//   workflowDescription(agentToolName)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { workflowDescription } from "./workflow-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { AGENT_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  workflowDescription(agentToolName) {
    assertGraphValue("workflow-description", "agentToolName", agentToolName, AGENT_TOOL_NAME);
    return workflowDescription();
  },
});
