// ADAPTER — the graph-facing seam for the FileChanged hook dispatcher.
//
// Delegation signature:
//   fileChangedHooks(session, filePath, event, options,
//                    createBaseHookInput, cwd, executeWatcherHooks)
//
// Neither a generator nor async: upstream returns the watcher helper's promise
// and lets its caller attach `.then`, so the delegation is a plain `return`.
//
// No `primitive` capture. This is the one dispatcher in the family that takes no
// timeout: `zxt` defaults it on the far side of the port, so there is no graph
// value to equality-assert here.
import { fileChangedHooks } from "./file-changed-hooks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  fileChangedHooks(session, filePath, event, options, createBaseHookInput, cwd, executeWatcherHooks) {
    return fileChangedHooks(session, filePath, event, options, createBaseHookInput, cwd, executeWatcherHooks);
  },
});
