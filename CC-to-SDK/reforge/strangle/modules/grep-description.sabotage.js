// SABOTAGE wiring — `search-tools` and `search-tools-lean` MUST both go red.
import { grepDescription } from "./grep-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  grepDescription(model, grepToolName, bashToolName, agentToolName, leanPrompt, subagentSteer) {
    return grepDescription(model, leanPrompt, subagentSteer);
  },
});
