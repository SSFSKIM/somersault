// PARITY LAYER (§2.5 `reference`) — what actually CHANGES when the permission
// mode changes (upstream `V0` / `transitionPermissionMode`, 2.1.251,
// chunk-fy12d89p).
//
// The guard says whether a move is allowed; this says what the move DOES. It is
// the only place the mode axis has side effects, and there are eight of them —
// telemetry, two subscriber notifications, a plan-mode exit flag, a plan-mode
// context rewrite, the auto-mode active flag, the dangerous-rule strip and its
// restore, and an exit-attachment flag. Every one is a port whose far side W6
// does not own, which is what makes this an eight-edge ledger row rather than a
// self-contained unit.
//
// THE EARLY RETURN IS THE COMMON CASE. A transition to the mode already in
// effect does nothing at all — no telemetry, no notification, no rewrite. The
// caller re-checks the same equality itself before calling, so on the corpus
// this arm is dead and its liveness is the parity oracle's to prove.
//
// THE PLAN ARMS ARE ASYMMETRIC, and that asymmetry is the function's substance:
//
//   LEAVING plan   sets the "has exited plan mode" flag — and does NOT clear the
//                  saved pre-plan state yet, because the last two lines do that,
//                  after the auto-mode work. Two separate `from === "plan" &&
//                  to !== "plan"` tests, deliberately, with the auto handling
//                  between them.
//   ENTERING plan  RETURNS EARLY with a rewritten context, so none of the
//                  auto-mode handling below runs. A rewrite that folded the two
//                  plan tests together would silently start running it.
//
// THE AUTO ARMS TREAT `plan` AS AUTO-LIKE, conditionally. "Was auto" is `from
// === "auto"` OR (`from === "plan"` AND auto is currently active) — because plan
// mode entered FROM auto keeps the classifier armed underneath. So leaving plan
// for a third mode can also be leaving auto, and that is the only path on which
// the dangerous-rule restore runs without `from` being `auto`.
//
// THE GATE RE-CHECK ON ENTRY THROWS. The guard already refused an unavailable
// auto, so reaching here with the gate off means the guard was bypassed — and
// upstream raises rather than silently entering a mode whose classifier cannot
// run. Under §3.3's pinned disabled defaults this is the arm any direct call
// would take, which is exactly why it must not be softened into a no-op.

/**
 * @param from                  the mode being left
 * @param to                    the mode being entered
 * @param context               the tool-permission context to rewrite
 * @param trigger               what caused the change, for telemetry
 * @param setProvisionalStartupMode  port — drop the provisional startup-mode record
 * @param recordModeChange      port — telemetry for the transition
 * @param handlePlanModeTransition      port — the plan-mode subscriber
 * @param handleAutoModeTransition  port — the auto-mode subscriber
 * @param setHasExitedPlanMode  port — the "has left plan mode" flag
 * @param prepareContextForPlanMode port — the context rewrite entering plan mode
 * @param isAutoModeActive        port — is the classifier currently armed?
 * @param isAutoModeGateEnabled   port — is the auto-mode gate on?
 * @param setAutoModeActive     port — arm or disarm the classifier
 * @param setNeedsAutoModeExitAttachment port — flag the exit attachment
 * @param stripDangerousPermissionsForAutoMode   port — remove rules auto mode must not honour
 * @param restoreDangerousPermissions port — put them back
 */
export function transitionPermissionMode(
  from,
  to,
  context,
  trigger,
  setProvisionalStartupMode,
  recordModeChange,
  handlePlanModeTransition,
  handleAutoModeTransition,
  setHasExitedPlanMode,
  prepareContextForPlanMode,
  isAutoModeActive,
  isAutoModeGateEnabled,
  setAutoModeActive,
  setNeedsAutoModeExitAttachment,
  stripDangerousPermissionsForAutoMode,
  restoreDangerousPermissions,
) {
  if (from === to) return context;
  setProvisionalStartupMode(undefined);
  recordModeChange({ from, to, trigger });
  handlePlanModeTransition(from, to);
  handleAutoModeTransition(from, to);
  if (from === "plan" && to !== "plan") setHasExitedPlanMode(true);
  if (to === "plan" && from !== "plan") return prepareContextForPlanMode(context);

  const wasAuto = from === "auto" || (from === "plan" && isAutoModeActive());
  const nowAuto = to === "auto";
  let next = context;
  if (nowAuto && !wasAuto) {
    if (!isAutoModeGateEnabled()) throw Error("Cannot transition to auto mode: gate is not enabled");
    setAutoModeActive(true);
    next = stripDangerousPermissionsForAutoMode(next);
  } else if (wasAuto && !nowAuto) {
    setAutoModeActive(false);
    setNeedsAutoModeExitAttachment(true);
    next = restoreDangerousPermissions(next);
  }
  if (from === "plan" && to !== "plan" && next.prePlanMode) return { ...next, prePlanMode: undefined };
  return next;
}
