// SABOTAGE — release the flag but never re-arm the orphan check.
//
// The inverse of the claim twin, and the same argument: the flag still moves, so
// callers see what they expect, while the process is left permanently without
// the watchdog that turns a dead parent into an exit. Nothing crashes; something
// stops being watched.
export function twnReleaseShutdownClaim(self) {
  self.shutdownInProgress = false;
}
