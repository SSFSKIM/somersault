// SABOTAGE LAYER (§2.5). Every tool call gets the same passthrough, so the
// whole ladder disappears at once: no deny rule bites, no allow rule applies,
// the tool's own `checkPermissions` never runs, and bypass mode never reaches
// its allow arm — the mode-aware body upgrades the passthrough into an ask and
// every scenario that makes a tool call is consulted about it. Inert: a real
// decision shape carrying no decision.
export async function permissionPrecheck(tool, input, context, options) {
  return { behavior: "passthrough", message: "reforge sabotage: precheck" };
}
