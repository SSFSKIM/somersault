// PARITY LAYER (§2.5 `reference`) — the UserPromptExpansion hook dispatcher
// (upstream `Ldt` / `executeUserPromptExpansionHooks`, 2.1.251, chunk-fy12d89p).
//
// Fires when a slash command or an MCP prompt is EXPANDED — before the expansion
// becomes a prompt, and so before the UserPromptSubmit event its record most
// resembles. The record names the expansion itself: which kind it is
// (`slash_command` or `mcp_prompt`), the command's name, its raw argument string,
// where the command was defined, and the reconstructed `/name args` line the
// expansion produced.
//
// Three of its four parameters' worth of plumbing come off the CONTEXT rather
// than off the parameter list, and each is a difference from its siblings:
//
//   the REGISTRATION GUARD keys on ONE id — the agent id when there is one, the
//       session id otherwise. This is the `hookAgentIds` fan-out rule's absence:
//       a tool-scoped event looks the registry up under the parent as well, so a
//       built-in subagent's tool call is visible to the parent session; a prompt
//       expansion belongs to exactly one agent. The guard is also unconditional
//       here — there is no `managedHooksOnly` short-circuit around it, as
//       UserPromptSubmit has.
//   the SIGNAL comes off the context's own abort controller, not from a
//       parameter. So this dispatcher cannot be cancelled independently of the
//       turn it is expanding within.
//   the TIMEOUT is the shared 600,000 ms constant, written into the executor
//       request. Every sibling takes a `timeoutMs` parameter that merely DEFAULTS
//       to it; this one has no timeout parameter at all, so there is nothing to
//       forward and a caller cannot bound it.
//
// The common prefix is built with THREE arguments — a permission mode but no
// tool-use context — even though the context is in hand and is handed to the
// executor. And, like the task dispatchers, the executor is given NO `matchQuery`:
// a matcher cannot select by command name, so every hook registered for the event
// runs on every expansion.
//
// The caller consumes `blockingError` off each yielded result, so a hook for this
// event can refuse an expansion.
//
// Ports (nothing behind them is owned by this wave):
//   hasHookForEvent(event, registry, agentId) -> boolean   reads the settings
//       layers and the session registry, under ONE id.
//   createBaseHookInput(session, cwd, permissionMode)  the common prefix.
//   cwd() -> string                    the working directory.
//   uuid() -> string                   upstream's `randomUUID`, the synthetic
//       tool-use id this event is correlated by (it has no tool call).
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`. Here it is not a parameter
//       default but a value this body reads directly, owned as
//       DEFAULT_HOOK_TIMEOUT_MS and equality-asserted by the adapter
//       (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* userPromptExpansionHooks(
  expansionType,
  commandName,
  commandArgs,
  commandSource,
  prompt,
  permissionMode,
  toolUseContext,
  hasHookForEvent,
  createBaseHookInput,
  cwd,
  uuid,
  executeHooks,
) {
  const agentId = toolUseContext.agentId ?? toolUseContext.session.id;
  if (!hasHookForEvent("UserPromptExpansion", toolUseContext.sessionHooksRegistry, agentId)) return;
  const hookInput = {
    ...createBaseHookInput(toolUseContext.session, cwd(), permissionMode),
    hook_event_name: "UserPromptExpansion",
    expansion_type: expansionType,
    command_name: commandName,
    command_args: commandArgs,
    command_source: commandSource,
    prompt,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does.
  yield* executeHooks({
    session: toolUseContext.session,
    hookInput,
    toolUseID: uuid(),
    signal: toolUseContext.abortController.signal,
    timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
    toolUseContext,
  });
}
