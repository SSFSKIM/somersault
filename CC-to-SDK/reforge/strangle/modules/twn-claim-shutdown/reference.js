// PARITY LAYER (§2.5 `reference`) — `TWn.claimShutdown` (2.1.251, 68 B, zero
// free variables), the write half of the coordinator's in-progress CLAIM.
//
// Two statements, and the second is the one a reader would not guess: taking the
// claim also DISARMS the orphan check. That watchdog fires every 30 seconds and
// shuts the process down with 129 when stdout stops being writable or stdin
// stops being readable — which is exactly what a deliberate teardown does on its
// way out. So the claim is not only a mutex against a second shutdown; it is
// what stops the orphan detector from racing the shutdown it belongs to.
//
// See `modules/twn-is-shutting-down/reference.js` for why this flag is NOT the
// shutdown latch, and what the difference buys.
//
// `this` crosses because the flag and the timer both live on the coordinator
// instance; the disarm stays a method call on it rather than an owned copy,
// because the timer handle is graph state.
export function twnClaimShutdown(self) {
  self.shutdownInProgress = true;
  self.disarmOrphanCheck();
}
