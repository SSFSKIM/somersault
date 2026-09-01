// PARITY LAYER (§2.5 `reference`) — is this session's consecutive-denial counter
// the CLASSIFIER's alone? (upstream `Uct` / `classifierOnlyStreakActive`,
// 2.1.251, chunk-fy12d89p).
//
// OWNED IN `shared/` RATHER THAN SPLICED, and the reason is a measurement that
// corrected this header's own first paragraph. Sixty-two bytes, five call sites,
// and it runs on EVERY allowed tool call in every mode — which reads like the
// cheapest live unit in the subsystem, and is not one. Its answer is pinned:
// §3.3 holds the streak gate at its disabled default, so upstream returns
// `false` on every graded run, and the MAXIMAL twin — one that returns `true`
// unconditionally, suppressing the reset on every allowed call — leaves both
// covering scenarios byte-identical. What it changes is a counter that only the
// auto-mode classifier reads, and the classifier's denial is this wave's
// standing OPEN condition.
//
// The row was carried as live until the gate stopped reading a non-zero exit as
// a RED. It was not a crash and not a divergence: the sabotaged run passed. So
// the splice is dropped and the finding kept, as C1 did with the interrupt
// clause and as this wave did with the message builder and the mode setter.
// `strangle/permissions-parity.test.ts` still grades it against upstream's bytes
// from a synthetic row, because the reason it is not a row says nothing about
// whether it is right.
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
