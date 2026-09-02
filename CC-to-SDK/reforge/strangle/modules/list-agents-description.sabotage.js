// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { listAgentsDescription } from "./list-agents-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { SEND_MESSAGE_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  listAgentsDescription(sendMessageToolName) {
    assertGraphValue("list-agents-description", "sendMessageToolName", sendMessageToolName, SEND_MESSAGE_TOOL_NAME);
    return listAgentsDescription();
  },
});
