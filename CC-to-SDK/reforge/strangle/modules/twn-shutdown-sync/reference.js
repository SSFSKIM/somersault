// PARITY LAYER (§2.5 `reference`) — `TWn.shutdownSync` (2.1.251, 292 B), the
// FIRE-AND-FORGET half of the shutdown pair.
//
// ## Why "sync" when the thing it starts is asynchronous
//
// Because the CALLER is synchronous. `shutdown` is an async function that runs
// session-end hooks, drains stdout and force-exits, and there are places in the
// engine that must ask for a shutdown from a context that cannot await one — a
// signal handler, an error path inside the drain loop. This is that entry point:
// it does the two things that must happen NOW, hands the rest to a promise it
// parks on the instance, and returns.
//
// The two immediate things are ordered and both matter:
//
//   `process.exitCode = code`   so that if anything else ends the process first,
//                               it still ends with the status that was asked for.
//   commit the shutdown LATCH   so every consultation of it from here on answers
//                               true — this is the moment the rest of the engine
//                               learns the process is going down. The latch's
//                               module is owned by this same wave.
//
// Both are inside `if (!this.shutdownInProgress)`, so a second synchronous
// request while the first is still running does neither again — but it DOES
// re-enter the async half, which is upstream's shape and not a mistake to fix:
// `shutdown` has its own re-entry guard on the same flag and returns
// immediately, so the second call's `pendingShutdown` is a promise that resolves
// as soon as it starts.
//
// ## The catch chain is the failsafe, and it is two catches deep
//
// If the graceful shutdown REJECTS, the first catch logs it and does the brutal
// version by hand: reset the terminal, print the resume hint, arm the failsafe
// timer, drain stdout, force-exit. The second `.catch(() => {})` swallows
// anything that first handler itself throws, which is what stops a failure
// during teardown from becoming an unhandled rejection on the way out. An owned
// copy that "simplified" either catch would turn a bad exit into a hung one.
//
// ## Ports
//
// @param self            the coordinator instance — the flag, the parked promise
//                        and four methods all live on it
// @param code            the exit status to request
// @param reason          the shutdown reason, forwarded to the session-end hooks
// @param commitShutdown  port: the process-lifecycle latch's one-way commit.
//                        Forwarded rather than imported, even though this wave
//                        owns the far side, so the graph's own edge is the one
//                        that runs and the same singleton is committed.
// @param logError        port: the engine's logger
// @param resetTerminal   port: the terminal reset run before the resume hint
export function twnShutdownSync(self, code = 0, reason = "other", commitShutdown, logError, resetTerminal) {
  if (!self.shutdownInProgress) {
    process.exitCode = code;
    commitShutdown();
  }
  self.pendingShutdown = self
    .shutdown(code, reason)
    .catch(async (err) => {
      logError(`Graceful shutdown failed: ${err}`, { level: "error" });
      resetTerminal();
      self.printResumeHint();
      await self.armFailsafeAndDrainStdout(code);
      self.forceExit(code);
    })
    .catch(() => {});
}
