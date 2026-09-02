// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { exitPlanModeDescription } from "./exit-plan-mode-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  exitPlanModeDescription(askUserQuestionToolName) {
    assertGraphValue("exit-plan-mode-description", "askUserQuestionToolName", askUserQuestionToolName, ASK_USER_QUESTION_TOOL_NAME);
    return exitPlanModeDescription();
  },
});
