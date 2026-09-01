// PARITY LAYER (§2.5 `reference`) — may this session move to that permission
// mode? (upstream `GIe` / `guardPermissionModeChange`, 2.1.251, chunk-fy12d89p).
//
// THE ONLY GATE ON THE MODE AXIS. Every mode change goes through it — the
// control channel's `set_permission_mode`, the interactive mode picker, and the
// setter the SDK exposes — and it is where `research/fixtures/
// permission-surface-<pin>.json` reads the guard table from. Two of the six
// modes are refused under conditions, and the other four are unconditional.
//
// FIVE REFUSALS, IN UPSTREAM'S ORDER, each with its own message:
//
//   the mode does not PARSE          -> one message naming every valid mode.
//                                       The alias `manual` normalises to
//                                       `default` inside the parser, so it
//                                       parses while not being in the list.
//   bypassPermissions, restricted    -> refused. A restricted session cannot
//                                       reach it by any route.
//   bypassPermissions, disabled      -> refused by settings or configuration.
//   bypassPermissions, not launched  -> refused unless the process was started
//     with the flag                    with --dangerously-skip-permissions.
//                                       This is the one a headless SDK session
//                                       trips, and it is why the corpus's bypass
//                                       scenarios must pass the flag at spawn
//                                       rather than switch into the mode.
//   auto, gate off                   -> refused, with the REASON appended when
//                                       the gate layer supplies one and a bare
//                                       sentence when it does not. Under §3.3's
//                                       pinned disabled defaults the gate is
//                                       always off, so this is the arm every
//                                       auto attempt takes.
//
// THE THREE BYPASS CHECKS ARE ORDERED AND SHORT-CIRCUIT, and the order is
// behaviour: a restricted session that ALSO lacks the flag is told it is
// restricted, not that it lacks the flag. Two of them are unconditional string
// constants (`primitive` captures, equality-asserted against the graph on every
// delegation — the only cheap thing that can see upstream reword a refusal
// without moving an anchor); the third is built here because it is a fixed
// sentence with no interpolation.
//
// THE SUCCESS SHAPE CARRIES THE PARSED MODE, not the caller's string. That is
// what makes `manual` work end to end: the caller asked for `manual`, the guard
// answers `{ok: true, mode: "default"}`, and the transition that follows moves
// to `default`. A guard that echoed its argument would leave the alias unmapped
// one layer down.

/**
 * @param requested                the mode string the caller asked for
 * @param context                  the permission context (restricted, launch flags)
 * @param parsePermissionMode      port — normalise an alias and validate; undefined when unknown
 * @param unrecognizedModeError    primitive — the message naming every valid mode
 * @param restrictedBypassError    primitive — the refusal a restricted session gets
 * @param bypassDisabled           port — is bypass disabled by settings/configuration?
 * @param autoModeGateEnabled      port — is the auto-mode gate on?
 * @param autoModeUnavailableReason port — why auto is unavailable, when known
 * @param autoModeUnavailableNotification port — render that reason for a human
 */
export function guardPermissionModeChange(
  requested,
  context,
  parsePermissionMode,
  unrecognizedModeError,
  restrictedBypassError,
  bypassDisabled,
  autoModeGateEnabled,
  autoModeUnavailableReason,
  autoModeUnavailableNotification,
) {
  const mode = parsePermissionMode(requested);
  if (mode === undefined) return { ok: false, error: unrecognizedModeError };
  if (mode === "bypassPermissions") {
    if (context.restricted) return { ok: false, error: restrictedBypassError };
    if (bypassDisabled()) {
      return { ok: false, error: "Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration" };
    }
    if (!context.isBypassPermissionsModeAvailable) {
      return {
        ok: false,
        error: "Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions",
      };
    }
  }
  if (mode === "auto" && !autoModeGateEnabled()) {
    const reason = autoModeUnavailableReason();
    return {
      ok: false,
      error: reason ? `Cannot set permission mode to auto: ${autoModeUnavailableNotification(reason)}` : "Cannot set permission mode to auto",
    };
  }
  return { ok: true, mode };
}
