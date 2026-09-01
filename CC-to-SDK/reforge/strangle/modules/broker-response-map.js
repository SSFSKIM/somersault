// ADAPTER — the graph-facing seam for the can_use_tool response mapper.
//
// Delegation signature:
//   brokerResponseMap(answer, promptTool, input, context, inputTool,
//                     suppressAlwaysAllow, filterPermissionUpdates,
//                     applySessionUpdates, persistUpdates, lastKnownInput,
//                     logError, log)
import { brokerResponseMap } from "./broker-response-map/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  brokerResponseMap(...args) {
    return brokerResponseMap(...args);
  },
});
