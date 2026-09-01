// PARITY LAYER (§2.5 `reference`) — the SubagentStart hook dispatcher
// (upstream `kUt` / `executeSubagentStartHooks`, 2.1.251, chunk-fy12d89p).
//
// Fires once when the engine dispatches a subagent, before the child turn runs.
// The corpus reaches it through `hooks-subagent`, which is also the only
// scenario that reaches the SubagentStop arm of the stop dispatcher.
//
// What this module owns is the shape of a subagent-start record and the options
// its execution is requested under. Three of them are this dispatcher's alone:
//
//   the common prefix is built with TWO arguments (session and cwd), like the
//       display dispatcher and unlike every tool-scoped one — so the record
//       carries no `permission_mode`.
//   the executor is given the SESSION HOOKS and the AGENT CONTEXT explicitly.
//       Every tool-scoped dispatcher passes a `toolUseContext` and lets the
//       executor read both off it; a subagent is being STARTED, so its context
//       does not exist yet and both have to be handed over directly.
//   `matchQuery` is the AGENT TYPE. Hook matchers for this event therefore match
//       on which kind of subagent is starting, the way a tool-scoped matcher
//       matches on the tool name.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix.
//   cwd() -> string                    the working directory.
//   uuid() -> string                   upstream's `randomUUID`, the synthetic
//       tool-use id this event is correlated by (it has no real tool call).
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li` (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* subagentStartHooks(
  context,
  agentId,
  agentType,
  signal,
  timeoutMs,
  sessionHooks,
  agentContext,
  options,
  createBaseHookInput,
  cwd,
  uuid,
  executeHooks,
) {
  const hookInput = {
    ...createBaseHookInput(context.session, cwd()),
    hook_event_name: "SubagentStart",
    agent_id: agentId,
    agent_type: agentType,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does. C5x's
  // spiked module had it, and this is the oracle that wave deferred.
  yield* executeHooks({
    session: context.session,
    hookInput,
    toolUseID: uuid(),
    matchQuery: agentType,
    signal,
    timeoutMs,
    sessionHooks,
    agentContext,
    managedHooksOnly: options?.managedHooksOnly,
    storageV5: context.storageV5,
    credentials: context.credentials,
  });
}
