// PARITY LAYER (§2.5 `reference`) — the shutdown COORDINATOR's own in-progress
// predicate (2.1.251, `TWn.isShuttingDown`, 48 B, zero free variables).
//
// ## Two things are called "is shutting down", and they are not the same thing
//
// This is the correction the wave's fixture forced, and it matters to every
// consumer of `LifecyclePort`:
//
//   the LATCH        `chunk-29shcjw2`'s `committed` flag. One-way, no clearer
//                    anywhere in the bundle, read at 62 call sites across ten
//                    chunks. It means "this process has decided to go down".
//                    Owned whole by `modules/process-lifecycle`.
//   the CLAIM        `this.shutdownInProgress`, read here. Two-way — `claim`
//                    sets it, `release` clears it — and its purpose is to stop
//                    a second shutdown from starting while the first is running.
//                    It means "a shutdown is currently in flight".
//
// They are set together on the graceful path (`shutdown` writes the claim then
// commits the latch) which is what makes them easy to conflate, and they come
// apart in exactly the places that matter: the interactive relauncher claims
// without committing, and the headless SIGTERM handler reads THIS one as its
// once-guard while committing the OTHER one.
//
// The delegation crosses `this` because the state lives on the coordinator
// instance, which is a per-host lazy singleton the graph owns. That is
// deliberate: an owned copy of the flag would be a second flag.
export function twnIsShuttingDown(self) {
  return self.shutdownInProgress;
}
