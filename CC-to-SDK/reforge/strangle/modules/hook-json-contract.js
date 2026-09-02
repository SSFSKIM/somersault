// ADAPTER — the graph-facing seam for the hook JSON-contract interpreter.
//
// Delegation signature:
//   hookJsonContract({json, command, hookName, toolUseID, hookEvent,
//                     expectedHookEvent, stdout, stderr, exitCode, durationMs},
//                    sanitizeTerminalSequence, logDebug, stringify,
//                    probeMcpRewrite, hookMessage)
//
// The first argument is upstream's own destructured parameter, re-assembled by
// the build's delegation. The five that follow are §2.4 `effectful-port`s in
// the order the body first reads them; each is documented in the reference
// module's header, and none is owned here — there is no `primitive` to
// equality-assert, so this adapter is a pass-through.
import { hookJsonContract } from "./hook-json-contract/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookJsonContract(...args) {
    return hookJsonContract(...args);
  },
});
