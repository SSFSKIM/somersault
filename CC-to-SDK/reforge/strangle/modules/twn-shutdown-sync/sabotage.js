// SABOTAGE — accept the request and do nothing about it.
//
// The shape is preserved exactly: the method still takes a status and a reason,
// still parks a promise on `pendingShutdown` for the callers that await one, and
// still returns synchronously. What it drops is everything the method is FOR —
// the exit status is never stamped, the shutdown latch is never committed, and
// the graceful shutdown never starts.
//
// A no-op rather than a partial one, and that is a deliberate second attempt.
// The first twin dropped only the two synchronous statements, on the theory that
// they are the half a reader would skip, and it turned nothing red: the async
// half stamps the same status again and force-exits with it explicitly, so the
// synchronous stamp is redundant on every path a corpus scenario can reach.
// A twin whose absence nothing can see is not evidence, so this one drops the
// whole method and the red — if there is one — is unambiguous.
export function twnShutdownSync(self) {
  self.pendingShutdown = Promise.resolve();
}
