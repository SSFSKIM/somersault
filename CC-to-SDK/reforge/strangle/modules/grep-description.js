// ADAPTER — the graph-facing seam for the Grep tool's description function.
//
// Delegation signature:
//   grepDescription(model, grepToolName, bashToolName, agentToolName,
//                   leanPrompt, subagentSteer)
//
// The three tool names are §2.4 `primitive`s owned in shared/tool-names.js; they
// cross so this adapter can equality-assert them on every delegation. The two
// ports stay typed delegation arguments.
import { AGENT_TOOL_NAME, BASH_TOOL_NAME, GREP_TOOL_NAME, grepDescription } from "./grep-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  grepDescription(model, grepToolName, bashToolName, agentToolName, leanPrompt, subagentSteer) {
    assertGraphValue("grep-description", "grepToolName", grepToolName, GREP_TOOL_NAME);
    assertGraphValue("grep-description", "bashToolName", bashToolName, BASH_TOOL_NAME);
    assertGraphValue("grep-description", "agentToolName", agentToolName, AGENT_TOOL_NAME);
    return grepDescription(model, leanPrompt, subagentSteer);
  },
});
