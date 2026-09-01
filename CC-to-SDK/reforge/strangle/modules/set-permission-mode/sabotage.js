// SABOTAGE LAYER (§2.5). The seam reports success and applies nothing: the
// guard is never asked, the state updater is never called, and the emitter
// never fires. A control-channel `set_permission_mode` therefore answers
// success while the session stays where it was — the most plausible wrong
// implementation of a setter, and an inert one.
export function setPermissionModeWithGuards(requested, context, updateState, trigger, guardModeChange, transitionMode, modeChanged) {
  return { ok: true, mode: requested };
}
