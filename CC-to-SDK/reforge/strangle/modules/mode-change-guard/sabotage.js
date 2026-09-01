// SABOTAGE LAYER (§2.5). Every mode change is refused, whichever mode it is —
// so the control channel's `set_permission_mode` answers with an error envelope
// instead of a success one and the session stays in the mode it started in.
// Inert: no throw, a well-formed refusal that is simply the wrong answer.
export function guardPermissionModeChange(requested, context, parsePermissionMode, unrecognizedModeError, restrictedBypassError, bypassDisabled, autoModeGateEnabled, autoModeUnavailableReason, autoModeUnavailableNotification) {
  return { ok: false, error: "reforge sabotage: mode change refused" };
}
