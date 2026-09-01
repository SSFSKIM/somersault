// PARITY LAYER (§2.5 `reference`) — the SessionEnd hook dispatcher
// (upstream `ZSe` / `executeSessionEndHooks`, 2.1.251, chunk-fy12d89p).
//
// The first dispatcher in this family that is NOT a generator. Every tool- and
// turn-scoped event streams its executor's results back to a caller that folds
// them into the conversation; a session that is ending has no conversation left
// to fold them into, so this one AWAITS the whole execution and consumes the
// results itself. That difference is the module's shape, not a detail: there is
// no `yield*` and no completion value, and the two things it does with the
// results are both effects.
//
// What it owns:
//
//   the RESULT DRAIN. A failed hook with output is written to STDERR, named by
//       the command that failed. A failed hook with no output is silent, and a
//       hook that succeeded is silent whatever it printed — this event's results
//       reach nothing else, so the filter is the whole reporting policy.
//   the REGISTRY TEARDOWN, unconditionally last. The session's hooks are cleared
//       after the drain, so a hook registered for this session cannot survive
//       into another one — and it happens even when no hook ran, because the
//       clear is not inside the loop.
//   its OWN TIMEOUT, 1500 ms, where every other dispatcher in the family
//       defaults to 600,000. A session is ending; the engine will not wait ten
//       minutes for a hook that is holding it open.
//   the OPTIONS BAG is optional (`options || {}`). Upstream has THREE callers
//       and all three pass a bag — `/clear`, session resume, and the app's own
//       `shutdown()`, which reaches this function through the barrel chunk by
//       dynamic import and passes `{signal, storageV5, credentials}` with a
//       reason defaulting to "other". What none of them passes is a session
//       hooks registry, and the executor still runs: the settings layers resolve
//       without one. That shutdown caller is the ordinary-teardown fire the
//       probe measures on every phase, and the `|| {}` arm itself is defensive
//       rather than reachable.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments).
//   cwd() -> string                    the working directory.
//   executeHooksAwait(request) -> results[]   the AWAITING executor (upstream
//       `AE`), the sibling of the generator executor the rest of the family
//       delegates into. Unowned, and a ledger edge to whichever wave takes it.
//   sessionEndTimeoutMs -> 1500        upstream's `oun` (§2.4 `primitive`).

/** Upstream `oun` — this event's own hook timeout, in milliseconds. */
export const SESSION_END_TIMEOUT_MS = 1500;

export async function sessionEndHooks(session, reason, options, createBaseHookInput, cwd, executeHooksAwait) {
  const { sessionHooks, getAppState, signal, storageV5, credentials } = options || {};
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "SessionEnd",
    reason,
  };
  const results = await executeHooksAwait({
    session,
    sessionHooks,
    getAppState,
    hookInput,
    matchQuery: reason,
    signal,
    timeoutMs: SESSION_END_TIMEOUT_MS,
    storageV5,
    credentials,
  });
  for (const result of results) {
    if (!result.succeeded && result.output) {
      process.stderr.write(`SessionEnd hook [${result.command}] failed: ${result.output}\n`);
    }
  }
  sessionHooks?.clear(session.id);
}
