// PARITY LAYER (§2.5 `reference`) — is this session's consecutive-denial counter
// the CLASSIFIER's alone? (upstream `Uct` / `classifierOnlyStreakActive`,
// 2.1.251, chunk-fy12d89p).
//
// Sixty-two bytes, five call sites, and it runs on EVERY allowed tool call in
// every mode — including the twenty-two `bypassPermissions` scenarios, whose
// allow arm evaluates it before anything else. That makes it the cheapest live
// unit in the subsystem and the one that proves the chain is reached at all.
//
// WHAT IT GUARDS. The engine keeps a consecutive-denial counter that the
// auto-mode classifier feeds and that a human answering a prompt would reset.
// When the counter is the classifier's alone — the gate is on, a dialog surface
// exists, and no SDK dialog host is standing in for the human — the reset is
// SUPPRESSED, because there is no human decision to read the streak as
// forgiven. Every caller uses it as `!classifierOnlyStreakActive(ctx) && reset`,
// so a wrong answer here silently changes how long a denial streak survives.
//
// THE THREE-TERM CONJUNCTION SHORT-CIRCUITS, and the order is behaviour: the
// feature gate is asked first (pinned false under §3.3's disabled defaults, so
// on this corpus the answer is always `false` and the two ports after it are
// never called), then the context's own dialog handle, then the SDK-host
// predicate. A reimplementation that evaluated all three would call a port
// upstream does not — visible in the parity oracle's port trace, which is where
// the ordering is graded, since no scenario can flip the first term.
//
// `requestDialog !== void 0` is an EXISTENCE test on a function-valued field,
// not a truthiness test. Both ports stay ports: their far sides are the feature-
// gate resolver and the session-state layer, neither of which W6 owns.

/**
 * @param context             the permission context for this tool call
 * @param streakGateEnabled   port — the classifier-only-streak feature gate
 * @param sdkDialogHostActive port — whether an SDK host is answering dialogs
 */
export function classifierOnlyStreakActive(context, streakGateEnabled, sdkDialogHostActive) {
  return streakGateEnabled() && context.requestDialog !== undefined && !sdkDialogHostActive();
}
