// ADAPTER — the graph-facing seam for the CwdChanged hook dispatcher.
//
// Delegation signature:
//   cwdChangedHooks(session, oldCwd, newCwd, options,
//                   createBaseHookInput, cwd, executeWatcherHooks)
//
// FileChanged's twin in every structural respect: neither a generator nor async,
// so the delegation is a plain `return` of the watcher helper's promise, and no
// `primitive` capture, because this dispatcher takes no timeout either — `zxt`
// defaults it on the far side of the port.
import { cwdChangedHooks } from "./cwd-changed-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  cwdChangedHooks(session, oldCwd, newCwd, options, createBaseHookInput, cwd, executeWatcherHooks) {
    return cwdChangedHooks(session, oldCwd, newCwd, options, createBaseHookInput, cwd, executeWatcherHooks);
  },
});
