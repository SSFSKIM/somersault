// ADAPTER — the graph-facing seam for the InstructionsLoaded hook dispatcher.
//
// Delegation signature:
//   instructionsLoadedHooks(session, filePath, memoryType, loadReason, options,
//                           createBaseHookInput, cwd, executeHooksAwait,
//                           defaultHookTimeoutMs)
//
// NOT a generator — upstream awaits its executor — and it resolves to
// `undefined`, because the dispatcher discards the results. The delegation is
// still a plain `return`, so the hooks' completion stays on the caller's
// timeline.
//
// The options bag crosses WHOLE and possibly `undefined`: upstream destructures
// it in the body (`options ?? {}`), not in the parameter list, so the owned
// module owns that read and the `Li` default inside it.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_HOOK_TIMEOUT_MS, instructionsLoadedHooks } from "./instructions-loaded-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  instructionsLoadedHooks(session, filePath, memoryType, loadReason, options, createBaseHookInput, cwd, executeHooksAwait, defaultHookTimeoutMs) {
    assertGraphValue("instructions-loaded-hooks", "defaultHookTimeoutMs", defaultHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
    return instructionsLoadedHooks(session, filePath, memoryType, loadReason, options, createBaseHookInput, cwd, executeHooksAwait);
  },
});
