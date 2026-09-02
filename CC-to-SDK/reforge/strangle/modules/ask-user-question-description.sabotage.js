// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { askUserQuestionDescription } from "./ask-user-question-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { ENTER_PLAN_MODE_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  askUserQuestionDescription(enterPlanModeToolName, exitPlanModeToolName) {
    assertGraphValue("ask-user-question-description", "enterPlanModeToolName", enterPlanModeToolName, ENTER_PLAN_MODE_TOOL_NAME);
    assertGraphValue("ask-user-question-description", "exitPlanModeToolName", exitPlanModeToolName, EXIT_PLAN_MODE_TOOL_NAME);
    return askUserQuestionDescription();
  },
});
