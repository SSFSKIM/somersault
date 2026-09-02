// ADAPTER — the graph-facing seam for the send message description.
//
// Delegation signature:
//   sendMessageDescription(agentTeamContext, listAgentsToolName, crossSessionEnabled)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { sendMessageDescription } from "./send-message-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { LIST_AGENTS_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  sendMessageDescription(agentTeamContext, listAgentsToolName, crossSessionEnabled) {
    assertGraphValue("send-message-description", "listAgentsToolName", listAgentsToolName, LIST_AGENTS_TOOL_NAME);
    return sendMessageDescription(agentTeamContext, crossSessionEnabled);
  },
});
