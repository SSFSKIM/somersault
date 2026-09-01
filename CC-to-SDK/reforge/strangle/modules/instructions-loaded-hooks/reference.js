// PARITY LAYER (§2.5 `reference`) — the InstructionsLoaded hook dispatcher
// (upstream `Qqe` / `executeInstructionsLoadedHooks`, 2.1.251, chunk-fy12d89p).
//
// The only event in the family scoped to a FILE rather than to a turn, a tool or
// a session. It fires once per CLAUDE.md-class memory file as it loads — a run
// that reads user, project and local memory dispatches three times — which makes
// the record's identifying fields, not the session's, the thing a hook reads.
//
// What that costs it, and what it owns:
//
//   SIX event-specific fields, of which THREE come out of the options bag:
//       `file_path`, `memory_type` and `load_reason` off the parameters, then
//       `globs`, `trigger_file_path` and `parent_file_path` off the bag. The bag
//       is optional as a whole (`options ?? {}`), so the three are routinely
//       written as PRESENT-AND-UNDEFINED rather than omitted — upstream sets the
//       keys unconditionally, and a key that exists with no value is not the same
//       object as a key that does not exist.
//   `matchQuery` is the LOAD REASON. A matcher on this event selects WHY the
//       file was read, not which file was read, so a hook cannot narrow itself to
//       a path through the matcher — only through the record.
//   like Notification and unlike every awaited sibling, the executor request has
//       NO `signal`: memory loading is not on a cancellable path.
//
// Its results are discarded and it returns nothing, so the whole of its
// behaviour is the record and the executor request.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments).
//   cwd() -> string                    the working directory.
//   executeHooksAwait(request) -> results[]   the AWAITING executor (upstream
//       `AE`), whose return value this dispatcher throws away. Unowned, and a
//       ledger edge to whichever wave takes it.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the destructure's
//       `timeoutMs` default (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function instructionsLoadedHooks(
  session,
  filePath,
  memoryType,
  loadReason,
  options,
  createBaseHookInput,
  cwd,
  executeHooksAwait,
) {
  const {
    globs,
    triggerFilePath,
    parentFilePath,
    timeoutMs = DEFAULT_HOOK_TIMEOUT_MS,
    storageV5,
    credentials,
  } = options ?? {};
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "InstructionsLoaded",
    file_path: filePath,
    memory_type: memoryType,
    load_reason: loadReason,
    globs,
    trigger_file_path: triggerFilePath,
    parent_file_path: parentFilePath,
  };
  await executeHooksAwait({
    session,
    hookInput,
    timeoutMs,
    matchQuery: loadReason,
    storageV5,
    credentials,
  });
}
