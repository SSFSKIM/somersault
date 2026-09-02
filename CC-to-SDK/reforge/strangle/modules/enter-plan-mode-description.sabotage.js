// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { enterPlanModeDescription } from "./enter-plan-mode-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  enterPlanModeDescription(askUserQuestionToolName, whatHappensSection, agentToolNote) {
    assertGraphValue("enter-plan-mode-description", "askUserQuestionToolName", askUserQuestionToolName, ASK_USER_QUESTION_TOOL_NAME);
    return enterPlanModeDescription(whatHappensSection, agentToolNote);
  },
});
