// PARITY LAYER (§2.5 `reference`) — which of the host's requested permission
// updates the engine will actually accept (upstream `U`, 2.1.251,
// chunk-g1qrzvef).
//
// TWO CALL SITES, BOTH ON THE HEADLESS SEAM: the response mapper applies it to
// what a host returned, and the broker's own logging context applies it to what
// a host WOULD have returned. It is the filter that stands between an SDK host's
// `updatedPermissions` and the session's permission state, and it is
// deny-by-default in two of its four arms.
//
// THE FIRST REFUSAL IS TOTAL AND RETURNS UNDEFINED, not an empty list: a remote
// execution or an exempt context accepts NO permission updates at all, whatever
// the host asked for. The caller tests `?.length`, so `undefined` and `[]` are
// the same to it — but they are not the same claim, and upstream makes the
// stronger one.
//
// THE SECOND ARM IS THE TOOL'S OWN VETO. A tool that declares it suppresses ALL
// permission updates for this input gets the host's list stripped down to the
// grants that survive a remote-scope filter, and an empty result becomes
// `undefined` again. `?.(…) === true` is an EXPLICIT true test through an
// optional call: a tool without the predicate, and a tool whose predicate
// returns something truthy but not `true`, both fall through.
//
// THE THIRD ARM IS NARROWER — whole-tool grants only. Either the tool says this
// input suppresses an always-allow rule, or the CALLER says so (the broker
// passes its own `suppressAlwaysAllowRule` flag through), and the list is
// rewritten rather than emptied.
//
// `updates &&` GUARDS BOTH: a host that sent no updates reaches neither
// rewrite, and the function answers with the absent list it was given.
//
// The optional calls are written as explicit `!= null` tests rather than `?.()`,
// because an optional CALL cannot be branch-instrumented without detaching the
// method from its receiver (`strangle/branches.ts` refuses it by name). The
// LOOSE comparison is deliberate and is the exact semantics of `?.()`: both
// `undefined` and `null` short-circuit, and any other non-callable value throws
// in both spellings.

/**
 * @param updates             the host's requested permission updates, possibly absent
 * @param tool                the tool the call is for
 * @param input               its input
 * @param context             the permission context
 * @param suppressAlwaysAllow the caller's own whole-tool-grant suppression flag
 * @param isExemptContext     port — contexts that accept no updates at all
 * @param withoutRemoteScope  port — drop grants a remote scope must not receive
 * @param stripWholeToolGrants port — rewrite whole-tool grants for an ask
 * @param toolPermissionContext port — the context the whole-tool strip reads
 */
export function brokerPermissionUpdates(
  updates,
  tool,
  input,
  context,
  suppressAlwaysAllow,
  isExemptContext,
  withoutRemoteScope,
  stripWholeToolGrants,
  toolPermissionContext,
) {
  if (context.forRemoteExecution === true || isExemptContext(context)) return undefined;
  if (updates && tool.suppressesAllPermissionUpdates != null && tool.suppressesAllPermissionUpdates(input) === true) {
    const kept = withoutRemoteScope(updates);
    return kept.length > 0 ? kept : undefined;
  }
  // `updates &&` leads, so a host that sent none never reaches the tool's
  // predicate — the same short-circuit upstream's `t && (…)` has, and the
  // difference is visible in the parity oracle's port trace rather than in any
  // returned value.
  return updates &&
    ((tool.suppressesAlwaysAllowRule != null && tool.suppressesAlwaysAllowRule(input) === true) || suppressAlwaysAllow)
    ? stripWholeToolGrants(updates, tool, toolPermissionContext(context))
    : updates;
}
