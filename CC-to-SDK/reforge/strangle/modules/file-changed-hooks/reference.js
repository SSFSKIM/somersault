// PARITY LAYER (§2.5 `reference`) — the FileChanged hook dispatcher
// (upstream `CUt` / `executeFileChangedHooks`, 2.1.251, chunk-fy12d89p).
//
// The smallest dispatcher in the family, and the only one that does not talk to
// an executor at all: it builds the record and hands the whole execution to the
// WATCHER-HOOKS helper it shares with CwdChanged (upstream `zxt`), which awaits
// the executor and then folds the results into the shape the file watcher needs
// — the results themselves, the union of every `watchPaths` a hook returned, and
// the system messages. That helper is a port, not owned here: it is the watcher
// subsystem's, and both watcher events reach it.
//
// So what this module owns is exactly the record, and one thing about it is
// worth stating because it is easy to get wrong from the field names alone: the
// event kind is stamped as `event`, not as `change_type` or `kind`, and it sits
// AFTER `file_path`. Both are the serialisation contract a command hook reads.
//
// HOW IT IS REACHED, which is not what the field names suggest either. The
// watcher is armed from a registered FileChanged hook's MATCHER — upstream
// splits each matcher on `|`, resolves every piece against the cwd and hands the
// list to chokidar. A hook with no matcher arms nothing, and nothing a hook
// PRINTS can arm it either. `hooks-file-watch` registers a matcher and then
// changes files under it.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments, so the
//       record carries no permission_mode/agent_id/agent_type).
//   cwd() -> string                    the working directory.
//   executeWatcherHooks(session, hookInput, options)  upstream `zxt` — the
//       shared watcher-hook helper. A ledger edge to the file-watcher subsystem.

/** Upstream `Li` — the hook execution timeout, in milliseconds. Not a parameter here; `zxt` defaults it. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export function fileChangedHooks(session, filePath, event, options = {}, createBaseHookInput, cwd, executeWatcherHooks) {
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "FileChanged",
    file_path: filePath,
    event,
  };
  // Upstream RETURNS the helper's promise rather than awaiting it: the caller
  // (`W` in the watcher wiring) attaches `.then`. Returning the promise rather
  // than an awaited value keeps this a plain function, which is what the graph's
  // call site expects.
  return executeWatcherHooks(session, hookInput, options);
}
