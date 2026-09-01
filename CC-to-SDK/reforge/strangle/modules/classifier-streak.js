// ADAPTER — the graph-facing seam for the classifier-only-streak predicate.
//
// Delegation signature:
//   classifierOnlyStreakActive(context, streakGateEnabled, sdkDialogHostActive)
import { classifierOnlyStreakActive } from "./classifier-streak/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  classifierOnlyStreakActive(...args) {
    return classifierOnlyStreakActive(...args);
  },
});
