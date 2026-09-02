// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { sendMessageDescription } from "./send-message-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { LIST_AGENTS_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  sendMessageDescription(agentTeamContext, listAgentsToolName, crossSessionEnabled) {
    assertGraphValue("send-message-description", "listAgentsToolName", listAgentsToolName, LIST_AGENTS_TOOL_NAME);
    return sendMessageDescription(agentTeamContext, crossSessionEnabled);
  },
});
