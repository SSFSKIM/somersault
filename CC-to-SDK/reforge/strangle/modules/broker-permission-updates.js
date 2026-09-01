// ADAPTER — the graph-facing seam for the host's permission-update filter.
//
// Delegation signature:
//   brokerPermissionUpdates(updates, tool, input, context, suppressAlwaysAllow,
//                           isExemptContext, withoutRemoteScope,
//                           stripWholeToolGrants, toolPermissionContext)
import { brokerPermissionUpdates } from "./broker-permission-updates/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  brokerPermissionUpdates(...args) {
    return brokerPermissionUpdates(...args);
  },
});
