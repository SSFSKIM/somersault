// SABOTAGE — take upstream's already-shutting-down arm unconditionally.
//
// Shape-preserving in the strongest sense available: this IS one of the
// handler's own three arms, taken when the coordinator's claim is not in fact
// taken. Nothing throws and nothing is missing — the signal is still logged, the
// terminal is still reset — so a red cannot come from a crash.
//
// What disappears is every effect that ends the session: the in-flight query is
// not cancelled, the run controller is not aborted, and no shutdown is
// requested. MEASURED CONSEQUENCE, which is sharper than the one this twin was
// written to produce: the turn simply carries on. The tool result comes back,
// the engine sends a SECOND API request, and the session ends with an ordinary
// `result:success` and exit 0. So the covering plan reddens twice over and by
// name — `user` and `result:success` are turn progress the shutdown path does
// not produce, and two `/v1/messages` requests are one more than an abandoned
// turn makes. The exit status alone would NOT have caught it, which is exactly
// why the plan grades the request count as well.
export function kySigintHandler(logEvent, coordinatorIsShuttingDown, resetTerminal) {
  logEvent("info", "shutdown_signal", { signal: "SIGINT" });
  resetTerminal();
}
