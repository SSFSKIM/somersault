// PARITY LAYER (§2.5 `reference`) — the headless dispatcher's SIGINT handler
// (2.1.251, `Hn` in `chunk-dvbbv89q.js`, 148 B).
//
// ## Why this one and not its SIGTERM sibling
//
// The wave's fixture enumerates every `process.on("SIG…")` in the graph — 25
// registrations, 23 the walk can read, 6 touching the lifecycle surface — and
// records EXCISABILITY for each as a measurement rather than a judgement. Of the
// six, exactly one fits a target shape:
//
//   SIGINT  `Hn`  here, 148 B, an arrow initializer with no writes to any
//                 captured binding — SPLICEABLE, and spliced.
//   SIGTERM `br`   61 B, the same shape, and NOT spliceable: its body assigns to
//                 `Gn`, the once-guard declared beside it in the same `let`. A
//                 splice forwards captures BY VALUE, so the delegated body could
//                 read that flag and never write it back, and the write is the
//                 whole of what a once-guard does. It stays upstream's, owned
//                 THROUGH the chunk instead — the `commitShutdown()` it calls is
//                 this wave's owned export — and is recorded OPEN in the ledger
//                 with that mechanical reason.
//   the other four are the coordinator's own, handed to `process.on` as inline
//                 argument expressions with no declaration to replace at all.
//
// The brief for this child said not to force a template. This is what the
// measurement allowed, and the shape of the refusal for the rest.
//
// ## What the handler does, and the one thing that is not obvious
//
// Three arms, in order:
//
//   1. ALREADY SHUTTING DOWN — if the coordinator's claim is taken, reset the
//      terminal and return. No second abort, no second exit request. Note this
//      reads the CLAIM (`TWn.shutdownInProgress`), not the shutdown latch; the
//      two are different flags and `modules/twn-is-shutting-down/reference.js`
//      says why the difference matters.
//   2. A QUERY IN FLIGHT — abort it with the reason `"user-cancel"`, which is
//      what makes a Ctrl-C during a turn read as the user cancelling rather than
//      as the process dying. The guard is `query && !query.signal.aborted`, so a
//      second interrupt during an already-aborted turn does not re-abort.
//   3. always — abort the run controller, reset the terminal, and ask for
//      shutdown with status ZERO. That is the difference from SIGTERM's 143 and
//      it is deliberate: an interrupt is a normal way to end a session, and the
//      exit status says so.
//
// THE TELEMETRY CALL IS INSIDE THE FIRST `if`. Upstream writes
// `if (log(…), claimed()) { … }` — a comma operator, so the event is emitted on
// EVERY signal including the already-shutting-down one, and only the second
// operand decides the branch. An owned copy that lifted the log above the `if`
// would behave identically; one that put it inside the branch would silently
// stop recording the repeat interrupts, which are exactly the ones an operator
// asks about.
//
// @param logEvent                 port: the engine's structured logger
// @param coordinatorIsShuttingDown port: `TWn.isShuttingDown()` — the CLAIM
// @param resetTerminal            port: restore the terminal modes
// @param currentQuery             the in-flight query handle, or undefined
// @param abortReason              port: builds the abort reason object
// @param runController            the session-level AbortController
// @param requestShutdown          port: the shutdown facade, `TWn.shutdown(code)`
export function kySigintHandler(
  logEvent,
  coordinatorIsShuttingDown,
  resetTerminal,
  currentQuery,
  abortReason,
  runController,
  requestShutdown,
) {
  if ((logEvent("info", "shutdown_signal", { signal: "SIGINT" }), coordinatorIsShuttingDown())) {
    resetTerminal();
    return;
  }
  if (currentQuery && !currentQuery.signal.aborted) currentQuery.abort(abortReason("user-cancel"));
  runController.abort();
  resetTerminal();
  requestShutdown(0);
}
