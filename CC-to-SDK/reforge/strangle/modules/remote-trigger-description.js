// ADAPTER — the graph-facing seam for the remote trigger description.
//
// Delegation signature:
//   remoteTriggerDescription()
//
// No captures: upstream's body reads nothing from its enclosing scope.
import { remoteTriggerDescription } from "./remote-trigger-description/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  remoteTriggerDescription() {
    return remoteTriggerDescription();
  },
});
