// ADAPTER — the graph-facing seam for a dispatched agent's system prompt.
//
// Delegation signature:
//   subagentPrompt(sections, context, additionalDirectories,
//                  writeToolName, envInfoSection, tokenAttachment)
//
// `writeToolName` is `primitive` and owned in shared/tool-names.js; it crosses
// only for the assertion. `envInfoSection` is the port whose far side is the
// ALREADY OWNED env-block module, and `tokenAttachment` reads the session's
// token budget — both stay typed delegation arguments.
import { assertGraphValue } from "./shared/assert.js";
import { WRITE_TOOL_NAME } from "./shared/tool-names.js";
import { subagentPrompt } from "./subagent-prompt/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async subagentPrompt(sections, context, additionalDirectories, writeToolName, envInfoSection, tokenAttachment) {
    assertGraphValue("subagent-prompt", "writeToolName", writeToolName, WRITE_TOOL_NAME);
    return subagentPrompt(sections, context, additionalDirectories, envInfoSection, tokenAttachment);
  },
});
