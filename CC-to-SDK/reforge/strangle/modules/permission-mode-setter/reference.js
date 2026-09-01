// PARITY LAYER (§2.5 `reference`) — apply a host's `set_permission_mode` control
// request to the session's tool-permission context (upstream `um`, 2.1.251,
// chunk-dvbbv89q).
//
// THE SET_PERMISSION_MODE SEAM, and the campaign's second attempt at naming it.
// C9 looked at `K0`/`setPermissionModeWithGuards`, which joins the same guard to
// the same transition and reads exactly like this handler; it measured dark,
// because the headless runtime does not call it. THIS is the function the arm
// calls, it has exactly one call site, and that call site is the arm.
//
// THREE OUTCOMES, and the middle one is the whole reason the function exists:
//
//   the guard REFUSES   -> its refusal is returned verbatim, so the arm answers
//                          the host with the guard's own sentence.
//   the mode is ALREADY the requested one
//                       -> `ok`, with the context returned UNCHANGED. The
//                          transition is never called, so none of its eight side
//                          effects run. A caller that skipped this test would
//                          fire plan-mode exit flags and auto-mode restores on a
//                          no-op change.
//   otherwise           -> transition, then STAMP the mode on top of whatever
//                          the transition returned. The stamp is not redundant:
//                          the transition's plan-mode arm returns a rewritten
//                          context of its own, and this is what guarantees the
//                          mode field agrees with the guard's PARSED mode rather
//                          than with the caller's string (upstream's `manual`
//                          alias normalises to `default` inside the guard).
//
// BOTH CAPTURES ARE PORTS INTO W6's SUBSYSTEM, deliberately. The guard and the
// transition are owned splices of their own, so this module must not ship second
// copies of them: it forwards, and the two edges are recorded on the ledger row.
// That also keeps the delegation chain intact — sabotaging either of them alone
// still reddens through here.

/**
 * @param request                    the control request (its `mode` is the ask)
 * @param context                    the tool-permission context in force
 * @param guardPermissionModeChange  port — may this session move to that mode? (W6)
 * @param transitionPermissionMode   port — what the move DOES (W6)
 */
export function applyPermissionModeRequest(request, context, guardPermissionModeChange, transitionPermissionMode) {
  const guarded = guardPermissionModeChange(request.mode, context);
  if (!guarded.ok) return guarded;
  if (context.mode === guarded.mode) return { ok: true, mode: guarded.mode, context };
  return {
    ok: true,
    mode: guarded.mode,
    context: { ...transitionPermissionMode(context.mode, guarded.mode, context), mode: guarded.mode },
  };
}
