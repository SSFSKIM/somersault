// PARITY LAYER (§2.5 `reference`) — the CwdChanged hook dispatcher
// (upstream `AUt` / `executeCwdChangedHooks`, 2.1.251, chunk-fy12d89p).
//
// FileChanged's twin, and the family's other watcher event. Like `CUt` it is
// neither async nor a generator, has no timeout of its own, and talks to
// neither executor: it builds the record and hands the whole execution to the
// WATCHER-HOOKS helper the two events share (upstream `zxt`), which awaits the
// executor and folds the results into the shape the watcher needs. That helper
// is a port, not owned here.
//
// The two dispatchers differ in exactly four things — the binding name, the
// event literal, and the two record fields — so what this module owns is the
// record, and the fields worth stating are `old_cwd` and `new_cwd`, in that
// order, after the common prefix. That order is the serialisation contract a
// command hook reads on stdin.
//
// HOW IT IS REACHED, measured rather than assumed. The Bash tool appends a
// `pwd` write to every command it runs and reads the result back afterwards; if
// the shell ended somewhere else, the tracked working directory moves and the
// engine calls its cwd-changed notifier. Three guards sit in front of that: only
// the MAIN agent's Bash may move the cwd (a subagent's provider pins it), the
// read-back must sanity-check as a real absolute directory, and the call must
// not be running under a cwd override.
//
// AND ONE GATE FURTHER IN, which decides whether this dispatcher is reached at
// all: the notifier returns early unless a CwdChanged or FileChanged hook is
// registered in the SETTINGS layer or by a plugin. It does not consult the
// store the SDK's `Options.hooks` callbacks land in — so a callback alone arms
// nothing, and `hooks-cwd-change` registers its matcher through
// `Options.settings` for the same reason `hooks-file-watch` does.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments, so the
//       record carries no agent_id/agent_type).
//   cwd() -> string                    the working directory.
//   executeWatcherHooks(session, hookInput, options)  upstream `zxt` — the
//       shared watcher-hook helper. A ledger edge to the file-watcher subsystem.

/** Upstream `Li` — the hook execution timeout, in milliseconds. Not a parameter here; `zxt` defaults it. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export function cwdChangedHooks(session, oldCwd, newCwd, options = {}, createBaseHookInput, cwd, executeWatcherHooks) {
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "CwdChanged",
    old_cwd: oldCwd,
    new_cwd: newCwd,
  };
  // Upstream RETURNS the helper's promise rather than awaiting it, exactly as
  // the FileChanged twin does: the caller chains onto it, and returning the
  // promise keeps this a plain function, which is what the graph's call site
  // expects.
  return executeWatcherHooks(session, hookInput, options);
}
