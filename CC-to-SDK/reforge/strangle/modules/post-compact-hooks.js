// ADAPTER — the graph-facing seam for the PostCompact hook dispatcher.
//
// Delegation signature:
//   postCompactHooks(session, request, context, signal, timeoutMs,
//                    createBaseHookInput, cwd, executeHooksAwait,
//                    defaultHookTimeoutMs)
//
// NOT a generator: like PreCompact and SessionEnd it awaits the second executor
// (`AE`) and returns a value, so the delegation is a plain `return`.
//
// `isDelegatedObservationSubagent` does NOT cross this seam: it is a
// `pure-helper` the owned module implements and uses in both wirings (§2.4), so
// the graph's copy is footprinted by the build and never called.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, postCompactHooks } from "./post-compact-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  postCompactHooks(session, request, context, signal, timeoutMs, createBaseHookInput, cwd, executeHooksAwait, defaultHookTimeoutMs) {
    assertGraphValue("post-compact-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return postCompactHooks(session, request, context, signal, timeoutMs, createBaseHookInput, cwd, executeHooksAwait);
  },
});
