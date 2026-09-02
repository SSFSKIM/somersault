// ADAPTER — the graph-facing seam for the ask user question description.
//
// Delegation signature:
//   askUserQuestionDescription(enterPlanModeToolName, exitPlanModeToolName)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { askUserQuestionDescription } from "./ask-user-question-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { ENTER_PLAN_MODE_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  askUserQuestionDescription(enterPlanModeToolName, exitPlanModeToolName) {
    assertGraphValue("ask-user-question-description", "enterPlanModeToolName", enterPlanModeToolName, ENTER_PLAN_MODE_TOOL_NAME);
    assertGraphValue("ask-user-question-description", "exitPlanModeToolName", exitPlanModeToolName, EXIT_PLAN_MODE_TOOL_NAME);
    return askUserQuestionDescription();
  },
});
