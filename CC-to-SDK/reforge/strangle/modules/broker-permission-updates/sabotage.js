// SABOTAGE LAYER (§2.5). Every requested permission update is dropped, whatever
// the tool and the context would have allowed — so a host's `updatedPermissions`
// never reaches the session and never persists. Inert: the tool call still runs
// with the decision it was given, and only the grants disappear.
export function brokerPermissionUpdates(updates, tool, input, context, suppressAlwaysAllow, isExemptContext, withoutRemoteScope, stripWholeToolGrants, toolPermissionContext) {
  return undefined;
}
