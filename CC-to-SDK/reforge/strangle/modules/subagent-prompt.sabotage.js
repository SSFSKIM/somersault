// SABOTAGE wiring — `subagent` and `background-task` MUST go red.
import { subagentPrompt } from "./subagent-prompt/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async subagentPrompt() {
    return subagentPrompt();
  },
});
