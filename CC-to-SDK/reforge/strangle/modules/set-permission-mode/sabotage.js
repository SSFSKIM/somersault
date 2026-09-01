// SABOTAGE LAYER (§2.5). The seam refuses every mode change: the guard is never
// asked, the state updater is never called, and the caller gets a well-formed
// refusal instead of a well-formed success. A control-channel
// `set_permission_mode` answers with an error envelope and the session stays
// where it was launched.
//
// The obvious mutant — reporting success and applying nothing — was MEASURED
// INERT even on a walk that makes a tool call after every change: the engine's
// own answer to the host is the only thing that distinguishes "applied" from
// "reported applied" at this seam, because the state the updater would have
// written is read by the layer BELOW it, which has its own twin. Refusing is
// what makes the seam observable from outside.
export function setPermissionModeWithGuards(requested) {
  return { ok: false, error: `reforge sabotage: refusing ${requested}` };
}
