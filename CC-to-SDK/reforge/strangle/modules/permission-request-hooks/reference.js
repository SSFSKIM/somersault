// PARITY LAYER (§2.5 `reference`) — the PermissionRequest hook dispatcher
// (upstream `Tee` / `executePermissionRequestHooks`, 2.1.251, chunk-fy12d89p).
//
// The dispatcher on the PERMISSION path, consulted while the engine is deciding
// whether a tool call may proceed — not before it runs and not after it has. It
// is the only one in the family whose results are a DECISION: each yielded result
// may carry a `permissionRequestResult`, and the caller acts on it, so a hook for
// this event can allow a tool call, deny it, or rewrite its input (an `allow`
// with an `updatedInput` re-enters the rule engine, where a `deny` or `ask` rule
// still overrides it). Every other dispatcher's results are advisory or, at most,
// blocking.
//
// Three more things set it apart from its tool-scoped siblings:
//
//   the REAL TOOL-USE ID. Alone among the tool-scoped dispatchers it forwards the
//       id of the tool call being decided rather than minting a uuid — the
//       decision has to be correlated with the call it is about.
//   `matchQuery` is the TOOL NAME, so matchers narrow by tool the way PreToolUse
//       matchers do. That much it shares; what it does not share is the record.
//   the record carries NO `tool_use_id` field. PreToolUse and PostToolUse both
//       put the id in the serialised record as well as in the executor request;
//       this one puts it only in the request, and instead carries
//       `permission_suggestions` — the rules the engine is proposing, which is
//       what a hook needs in order to answer.
//
// The `log` call is reproduced with the same message, because the verbose log
// stream is an observable surface and a dispatcher that stopped logging would be
// a difference. Note it is called with ONE argument here, where the PreToolUse
// dispatcher passes an explicit `{ level: "verbose" }`.
//
// Ports (nothing behind them is owned by this wave):
//   log(message)                       the engine's logger.
//   createBaseHookInput(session, cwd, permissionMode, context)  the common prefix
//       — FOUR arguments, so this record does carry the dispatching context's
//       agent id, agent type and effort.
//   cwd() -> string                    the working directory.
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the `timeoutMs` parameter
//       default. The graph keeps upstream's parameter list, so the default is
//       already applied by the time it reaches here — and all three call sites
//       stop at the signal, so in practice it always is. Owned as
//       DEFAULT_HOOK_TIMEOUT_MS and equality-asserted by the adapter
//       (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* permissionRequestHooks(
  toolName,
  toolUseId,
  toolInput,
  toolUseContext,
  permissionMode,
  permissionSuggestions,
  signal,
  timeoutMs,
  log,
  createBaseHookInput,
  cwd,
  executeHooks,
) {
  log(`executePermissionRequestHooks called for tool: ${toolName}`);
  const hookInput = {
    ...createBaseHookInput(toolUseContext.session, cwd(), permissionMode, toolUseContext),
    hook_event_name: "PermissionRequest",
    tool_name: toolName,
    tool_input: toolInput,
    permission_suggestions: permissionSuggestions,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does.
  yield* executeHooks({
    session: toolUseContext.session,
    hookInput,
    toolUseID: toolUseId,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
  });
}
