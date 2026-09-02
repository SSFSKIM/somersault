// ADAPTER — the graph-facing seam for the list agents description.
//
// Delegation signature:
//   listAgentsDescription(sendMessageToolName)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { listAgentsDescription } from "./list-agents-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { SEND_MESSAGE_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  listAgentsDescription(sendMessageToolName) {
    assertGraphValue("list-agents-description", "sendMessageToolName", sendMessageToolName, SEND_MESSAGE_TOOL_NAME);
    return listAgentsDescription();
  },
});
