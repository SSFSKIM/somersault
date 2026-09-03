// LifecyclePort — the process-lifecycle seam, composed (C16b / W13b).
//
// §2.3's cut rule for this subsystem is "identity/lifecycle → handle-shaped
// port", and this is that handle. It exists so the hook-executor children
// (C10.7/C10.8) can consume ONE thing instead of reaching into three owned
// modules and a coordinator instance, and so the next reader of
// `SchedulingPort.isShuttingDown()` in the executor design finds an
// implementation rather than a stub.
//
// EVERY MEMBER HAS AN UPSTREAM COUNTERPART. That is the binding rule this child
// was given and it is worth stating with the citations, because two of the five
// are easy to assume and one of them was very nearly invented:
//
//   isShuttingDown()       upstream `xo` — the shutdown LATCH's reader.
//                          62 call sites across all ten named importers of
//                          `chunk-29shcjw2.js`. Owned whole (S-chunk).
//   hang()                 upstream `pm` — the promise built with an empty
//                          executor, 25 call sites. Owned whole.
//   claimShutdown()        upstream `TWn.claimShutdown`, 68 B. Owned (splice).
//   releaseShutdownClaim() upstream `TWn.releaseShutdownClaim`, 72 B. Owned.
//   shutdownClaimed()      upstream `TWn.isShuttingDown`, 48 B, 37 call sites
//                          through its facade. Owned (splice).
//
// The cut named four members. This ships FIVE, and the fifth is an addition the
// artifact forced rather than a convenience: a port that lets a consumer TAKE
// and RELEASE a claim while giving it no way to READ one is write-only, and the
// only way to close that without inventing anything is to expose the reader
// upstream already has. It is deliberately NOT called `isShuttingDown`.
//
// ## THE TWO FLAGS, AND WHY THIS PORT REFUSES TO MERGE THEM
//
// This is the correction that cost the most measurement in this child, and any
// consumer that gets it wrong will get it wrong silently:
//
//   the LATCH   `committed`. ONE-WAY — there is a setter and no clearer anywhere
//               in the bundle. Means "this process has decided to go down".
//               Read by `isShuttingDown()`.
//   the CLAIM   `shutdownInProgress`. TWO-WAY — `claimShutdown` sets it,
//               `releaseShutdownClaim` clears it. Means "a shutdown is currently
//               in flight", and its job is to stop a second one from starting.
//               Read by `shutdownClaimed()`.
//
// They move together on the graceful path, which is what makes them look like
// one flag, and they come apart exactly where it matters: the interactive
// relauncher claims without ever committing, and the headless SIGTERM handler
// reads the CLAIM as its once-guard while committing the LATCH. A consumer that
// fused them would hang on a shutdown that was going to be released, or fail to
// hang on one that was not.
//
// ## WHAT A CONSUMER MUST NOT EXPECT: a reset
//
// There is none, because upstream has none. `commitShutdown` is deliberately not
// a member of this port — the executor children READ the lifecycle, they do not
// drive it, and the three call sites that commit are the coordinator's two
// shutdown entry points and the headless SIGTERM handler. A test that needs a
// clear latch needs a fresh process, which is what
// `strangle/hooks-parity.test.ts` does by evaluating upstream's chunk per case
// on the ORACLE side while this module keeps the identity semantics on the owned
// side.
import { hang, isShuttingDown } from "../process-lifecycle/reference.js";
import { twnIsShuttingDown } from "../twn-is-shutting-down/reference.js";
import { twnClaimShutdown } from "../twn-claim-shutdown/reference.js";
import { twnReleaseShutdownClaim } from "../twn-release-shutdown-claim/reference.js";

/**
 * Build the port over a shutdown coordinator instance.
 *
 * The latch half needs no receiver — it is module state, one per process, the
 * same guarantee upstream's `var e = new t` has. The claim half does, because
 * the flag and the orphan-check timer live on the coordinator, which upstream
 * keeps as a per-host lazy singleton the graph owns. Passing it in rather than
 * reaching for it is what lets an oracle drive this port without a host.
 *
 * @param coordinator the `TWn` instance (upstream's `c_()`), or a stand-in
 */
export function lifecyclePort(coordinator) {
  return {
    /** the LATCH: has this process decided to go down? One-way, never cleared. */
    isShuttingDown: () => isShuttingDown(),
    /** the promise that never settles — how a turn is abandoned without unwinding it */
    hang: () => hang(),
    /** the CLAIM: is a shutdown currently in flight? Two-way. */
    shutdownClaimed: () => twnIsShuttingDown(coordinator),
    /** take the claim, and disarm the orphan check while it is held */
    claimShutdown: () => twnClaimShutdown(coordinator),
    /** release it, and give the process back to the orphan check */
    releaseShutdownClaim: () => twnReleaseShutdownClaim(coordinator),
  };
}

/** The member names, so a consumer's stub can be checked against the real shape. */
export const LIFECYCLE_PORT_MEMBERS = ["isShuttingDown", "hang", "shutdownClaimed", "claimShutdown", "releaseShutdownClaim"];
