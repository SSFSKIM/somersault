// ADAPTER — the graph-facing seam for the headless dispatcher's SIGINT handler.
// Delegation signature:
//   kySigintHandler(logEvent, coordinatorIsShuttingDown, resetTerminal,
//                   currentQuery, abortReason, runController, requestShutdown)
// Every capture is `effectful-port`. `currentQuery` is a VALUE rather than a
// function and crosses per call, which is what the arrow-initializer delegation
// gives for free: the graph re-reads its own `let` at each invocation, so a
// handler that fires after the turn advanced sees the turn that is there now.
import { kySigintHandler } from "./ky-sigint-handler/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  kySigintHandler(logEvent, coordinatorIsShuttingDown, resetTerminal, currentQuery, abortReason, runController, requestShutdown) {
    return kySigintHandler(logEvent, coordinatorIsShuttingDown, resetTerminal, currentQuery, abortReason, runController, requestShutdown);
  },
});
