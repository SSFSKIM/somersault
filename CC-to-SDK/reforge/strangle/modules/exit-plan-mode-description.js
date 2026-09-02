// ADAPTER — the graph-facing seam for the exit plan mode description.
//
// Delegation signature:
//   exitPlanModeDescription(askUserQuestionToolName)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { exitPlanModeDescription } from "./exit-plan-mode-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  exitPlanModeDescription(askUserQuestionToolName) {
    assertGraphValue("exit-plan-mode-description", "askUserQuestionToolName", askUserQuestionToolName, ASK_USER_QUESTION_TOOL_NAME);
    return exitPlanModeDescription();
  },
});
