// ADAPTER — the graph-facing seam for the PreCompact hook dispatcher.
//
// Delegation signature:
//   preCompactHooks(session, request, context, signal, timeoutMs,
//                   createBaseHookInput, cwd, executeHooksAwait,
//                   defaultHookTimeoutMs)
//
// NOT a generator: upstream awaits its executor and returns a verdict the
// compactor obeys, so the delegation is a plain `return`.
//
// `isDelegatedObservationSubagent` does NOT cross this seam: it is a
// `pure-helper` the owned module implements and uses in both wirings (§2.4), so
// the graph's copy is footprinted by the build and never called.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, preCompactHooks } from "./pre-compact-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  preCompactHooks(session, request, context, signal, timeoutMs, createBaseHookInput, cwd, executeHooksAwait, defaultHookTimeoutMs) {
    assertGraphValue("pre-compact-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return preCompactHooks(session, request, context, signal, timeoutMs, createBaseHookInput, cwd, executeHooksAwait);
  },
});
