// SABOTAGE LAYER (§2.5). The seam reports success and applies nothing: the guard
// is never asked, the state updater is never called, and the emitter never
// fires. A control-channel `set_permission_mode` therefore answers success while
// the session stays in the mode it was launched in — the most plausible wrong
// implementation of a setter, and an inert one.
//
// Observable only where a mode change CHANGES A DECISION, which is why the
// covering scenario switches into `dontAsk` and then makes a tool call rather
// than switching and continuing to talk.
export function setPermissionModeWithGuards(requested) {
  return { ok: true, mode: requested };
}
