// SABOTAGE LAYER (§2.5). Any scenario that registers a PermissionDenied hook
// MUST go red with this built.
//
// The twin drops the dispatch entirely, and the corpus sees it twice over: the
// harness records every hook fire as an event, so a dispatcher that yields
// nothing leaves an events transcript the oracle's does not have — and the
// command-hook path writes its own record, which stops appearing. The `retry`
// channel goes with it, so a hook that would have asked for another attempt is
// never heard.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* permissionDeniedHooks() {
  // no guard, no record, no executor call: the PermissionDenied hooks never run
}
