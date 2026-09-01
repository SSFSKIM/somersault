// SABOTAGE LAYER (§2.5). `hooks-permission` MUST go red with this built: the
// scenario answers a permission consult 7.5 s later — past upstream's 6000 ms
// notify timer — and registers a Notification callback, so a dispatcher that
// never asks the executor for anything leaves an events transcript the oracle's
// does not have.
//
// This twin was written when the wave believed the event was unreachable, on a
// probe that ran every phase under `bypassPermissions` and therefore armed no
// notify timer at all. It has a recording now.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function notificationHooks() {
  // as if the notification had raised no hooks to run
}
