// ADAPTER — the graph-facing seam for the SessionEnd hook dispatcher.
//
// Delegation signature:
//   sessionEndHooks(session, reason, options,
//                   createBaseHookInput, cwd, executeHooksAwait,
//                   sessionEndTimeoutMs)
//
// NOT a generator, and the only member of the hook-dispatch family that is not:
// the delegation is a plain `return`, because upstream awaits its executor
// instead of streaming it.
import { assertGraphValue } from "./shared/assert.js";
import { SESSION_END_TIMEOUT_MS, sessionEndHooks } from "./session-end-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  sessionEndHooks(session, reason, options, createBaseHookInput, cwd, executeHooksAwait, sessionEndTimeoutMs) {
    assertGraphValue("session-end-hooks", "sessionEndTimeoutMs", sessionEndTimeoutMs, SESSION_END_TIMEOUT_MS);
    return sessionEndHooks(session, reason, options, createBaseHookInput, cwd, executeHooksAwait);
  },
});
