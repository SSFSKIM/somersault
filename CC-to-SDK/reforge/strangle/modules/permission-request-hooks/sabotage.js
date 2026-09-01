// SABOTAGE LAYER (§2.5). Any scenario that registers a PermissionRequest hook
// MUST go red with this built, on two counts: the harness records every consult,
// so a dispatcher that yields nothing leaves an events transcript the oracle's
// does not have — and the caller, which reads `permissionRequestResult` off
// results it never receives, falls through to the ordinary rule engine, so a
// hook's allow, deny or input rewrite silently stops applying. The verbose log
// line disappears with it.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* permissionRequestHooks() {
  // no log, no yields, no executor call: the permission-request hooks never run
}
