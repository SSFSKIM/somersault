// PARITY LAYER (§2.5 `reference`) — `TWn.releaseShutdownClaim` (2.1.251, 72 B,
// zero free variables), the exact inverse of the claim.
//
// It clears the in-progress flag and RE-ARMS the orphan check, which is what
// makes the pair a claim rather than a latch: a caller that took the claim to do
// something disruptive and then decided not to exit gives the process back to
// the watchdog. The shutdown LATCH has no such inverse anywhere in the bundle —
// once committed it is committed — and that asymmetry is the clearest statement
// of what the two flags are for.
export function twnReleaseShutdownClaim(self) {
  self.shutdownInProgress = false;
  self.armOrphanCheck();
}
