// PARITY LAYER (§2.5 `reference`) — the mode-change seam itself (upstream `K0` /
// `setPermissionModeWithGuards`, 2.1.251, chunk-fy12d89p).
//
// One hundred and eighty-seven bytes joining the two halves of the mode axis: it
// asks the guard, and on a yes it applies the transition through the caller's
// own state updater. Seven call sites, none of them in the permission chunk —
// the headless control channel's `set_permission_mode` handler is one, which is
// what makes it live on the corpus's `runtime-setters` scenario.
//
// THE UPDATER IS A FUNCTION OF THE PREVIOUS STATE, not a value, and it is
// re-entrant-safe by construction: the caller hands in the setter, the setter
// hands back whatever this returns, and the mode read inside the callback is the
// one that was current when the update ran — not the one that was current when
// the request arrived. Between an SDK host asking for a mode and the state
// actually updating, a queued turn can have changed it.
//
// THE NO-OP CHECK INSIDE THE CALLBACK IS NOT THE GUARD'S. The guard answers
// "may this session be in that mode"; this answers "is it already". Returning
// the previous state UNCHANGED — the same object, not a copy — is what makes the
// update a no-op for a subscriber comparing by identity.
//
// THE TRANSITION'S RESULT IS SPREAD AND THEN `mode` IS SET AGAIN. The transition
// returns a context that may have been rewritten (plan mode's, auto mode's rule
// strip) but does NOT itself carry the new mode, so the caller stamps it. A
// reimplementation that trusted the transition to set it would leave every
// session in its old mode with the new mode's rules applied.
//
// THE NOTIFY IS DEFERRED TO THE NEXT MACROTASK, and the deferral is behaviour:
// the emitter fires on `setImmediate`, so every subscriber sees the state
// AFTER this call returns rather than mid-update. It is also why the success
// result is returned synchronously while the notification is not.

/**
 * @param requested       the mode string the caller asked for
 * @param context         the permission context the guard reads
 * @param updateState     the caller's state updater, given a previous->next function
 * @param trigger         what caused the change, for telemetry
 * @param guardModeChange port — the mode-change guard
 * @param transitionMode  port — apply the transition's side effects and rewrites
 * @param modeChanged     port — the emitter every subscriber listens on
 */
export function setPermissionModeWithGuards(requested, context, updateState, trigger, guardModeChange, transitionMode, modeChanged) {
  const guarded = guardModeChange(requested, context);
  if (!guarded.ok) return guarded;
  const mode = guarded.mode;
  updateState((previous) => {
    if (previous.mode === mode) return previous;
    return { ...transitionMode(previous.mode, mode, previous, trigger), mode };
  });
  setImmediate(() => {
    modeChanged.emit();
  });
  return { ok: true, mode };
}
