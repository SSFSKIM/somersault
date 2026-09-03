// SABOTAGE wiring — `sigint-mid-turn` MUST go red with this built.
import { kySigintHandler } from "./ky-sigint-handler/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  kySigintHandler(logEvent, coordinatorIsShuttingDown, resetTerminal, currentQuery, abortReason, runController, requestShutdown) {
    return kySigintHandler(logEvent, coordinatorIsShuttingDown, resetTerminal, currentQuery, abortReason, runController, requestShutdown);
  },
});
