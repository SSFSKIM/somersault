// SABOTAGE wiring — `hooks-subagent` MUST go red with this built.
import { subagentStartHooks } from "./subagent-start-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async *subagentStartHooks() {
    return yield* subagentStartHooks();
  },
});
