// PARITY LAYER (§2.5 `reference`) — the SessionStart hook dispatcher
// (upstream `vUt` / `executeSessionStartHooks`, 2.1.251, chunk-fy12d89p).
//
// The one live event no SDK CALLBACK observes, and the reason is timing rather
// than structure. This dispatcher hands its executor no session hooks registry —
// that byte fact is real, and it is why this module forwards none — but a
// registry is not what a callback travels in: `Options.hooks` entries are tagged
// `origin:"sdkHost"` and pushed into a GLOBAL store, which the executor's lookup
// consults unconditionally. What actually keeps a callback out is that this
// dispatch runs before the host's hooks are registered. Measured: in every probe
// phase, on every run, the SessionStart callback count is zero and the settings
// command hook fires.
//
// So the settings layer is the only path a recording can use, which is why
// `hooks-session-start` registers a COMMAND hook and grades the record on the
// sandbox rather than in the event log — and why a callback-only probe read this
// live event as dead.
//
// What it owns beyond the record's field set:
//
//   the SESSION SUBSTITUTION. Given a session id override, the record's common
//       prefix is built for a SYNTHETIC session — that id, the caller's project
//       — while the EXECUTOR is still given the real one. Two different sessions
//       in one call, and collapsing them would either stamp the record with the
//       wrong id or run the hooks against the wrong session's registry.
//   the SESSION-TITLE FALLBACK: the caller's title, or else one derived from
//       whichever id the record was built for — the synthetic one when there is
//       an override, not the real session's.
//   the SPREAD TAIL. Extra fields are merged AFTER every named one, so a caller
//       can override any of them; the merge order is the contract.
//   the ACTIVITY HOLD. The dispatch is bracketed by a named refcount hold that
//       is released in a `finally`, so an executor that throws still releases it.
//       That bracket is why a session cannot be considered idle while its startup
//       hooks are running.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments, so the
//       record carries no permission_mode).
//   cwd() -> string                    the working directory.
//   sessionId(id) -> id                upstream's session-id coercion.
//   sessionTitle(id) -> string|undefined   reads the app's session state.
//   beginActivity(reason, hold) / endActivity(reason, hold)   the refcount.
//   uuid() -> string                   upstream's `randomUUID`.
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li` (§2.4 `primitive`).
//   ACTIVITY_HOLD -> "startup-hook-hold"   upstream's `Uie` (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

/** Upstream `Uie` — the activity-hold reason this dispatch is bracketed by. */
export const ACTIVITY_HOLD = "startup-hook-hold";

export async function* sessionStartHooks(
  session,
  source,
  sessionIdOverride,
  sessionTitleOverride,
  agentType,
  model,
  signal,
  timeoutMs,
  forceSyncExecution,
  extraFields,
  storageV5,
  credentials,
  createBaseHookInput,
  cwd,
  sessionId,
  sessionTitle,
  beginActivity,
  uuid,
  executeHooks,
  endActivity,
) {
  const recordSession =
    sessionIdOverride !== undefined ? { id: sessionId(sessionIdOverride), project: session.project } : session;
  const hookInput = {
    ...createBaseHookInput(recordSession, cwd()),
    hook_event_name: "SessionStart",
    source,
    agent_type: agentType,
    model,
    session_title: sessionTitleOverride ?? sessionTitle(recordSession.id),
    ...extraFields,
  };
  beginActivity("hook_exec", ACTIVITY_HOLD);
  try {
    // A BARE `yield*`, deliberately: upstream discards the executor generator's
    // completion value, so this dispatcher returns `undefined`.
    //
    // The executor is given `session`, NOT `recordSession`: the record may
    // describe a synthetic session, but the hooks run against the real one.
    yield* executeHooks({
      session,
      hookInput,
      toolUseID: uuid(),
      matchQuery: source,
      signal,
      timeoutMs,
      forceSyncExecution,
      storageV5,
      credentials,
    });
  } finally {
    endActivity("hook_exec", ACTIVITY_HOLD);
  }
}
