// ADAPTER — the graph-facing seam for the StopFailure hook dispatcher.
//
// Delegation signature:
//   stopFailureHooks(message, context, timeoutMs,
//                    hasHookForEvent, createBaseHookInput, cwd,
//                    executeHooksAwait, defaultHookTimeoutMs)
//
// NOT a generator: upstream awaits the second executor (`AE`) and discards its
// results, so the delegation is a plain `return` and resolves to `undefined`.
//
// Neither `isDelegatedObservationSubagent` nor `textOfContent` crosses this seam:
// both are `pure-helper`s the owned module implements and uses in both wirings
// (§2.4), so the graph's copies are footprinted by the build and never called.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, stopFailureHooks } from "./stop-failure-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  stopFailureHooks(message, context, timeoutMs, hasHookForEvent, createBaseHookInput, cwd, executeHooksAwait, defaultHookTimeoutMs) {
    assertGraphValue("stop-failure-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return stopFailureHooks(message, context, timeoutMs, hasHookForEvent, createBaseHookInput, cwd, executeHooksAwait);
  },
});
