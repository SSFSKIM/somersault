// ADAPTER — the graph-facing seam for the Notification hook dispatcher.
//
// Delegation signature:
//   notificationHooks(session, notification, options,
//                     createBaseHookInput, cwd, executeHooksAwait,
//                     defaultHookTimeoutMs)
//
// NOT a generator — upstream awaits its executor — and it resolves to
// `undefined`, because the dispatcher discards the results. The delegation is
// still a plain `return`: the caller awaits the promise, and returning it is what
// keeps the hooks' completion on the caller's timeline.
//
// The options bag crosses as ONE argument. Upstream destructures it in the
// PARAMETER position, so the build's delegation rebuilds it from the destructured
// bindings (`{timeoutMs,storageV5,credentials}`) with the `Li` default already
// applied — the owned module keeps its own copy of both defaults so that the
// oracle, which drives this adapter directly, grades the arm the graph never
// reaches.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, notificationHooks } from "./notification-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  notificationHooks(session, notification, options, createBaseHookInput, cwd, executeHooksAwait, defaultHookTimeoutMs) {
    assertGraphValue("notification-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return notificationHooks(session, notification, options, createBaseHookInput, cwd, executeHooksAwait);
  },
});
