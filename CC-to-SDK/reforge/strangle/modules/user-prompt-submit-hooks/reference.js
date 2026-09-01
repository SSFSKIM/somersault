// PARITY LAYER (§2.5 `reference`) — the UserPromptSubmit hook dispatcher
// (upstream `bSe` / `executeUserPromptSubmitHooks`, 2.1.251, chunk-fy12d89p).
//
// Fires once per submitted prompt, BEFORE the request is built — which makes it
// the only one of the eight whose hook results change the conversation: a hook's
// `additionalContext` is folded into the prompt the model then sees. The corpus
// reaches it through `hooks-prompt-submit`, which asserts that the injected
// context arrived by requiring the model to answer from it.
//
// Four things this dispatcher does that no other one does:
//
//   ITS OWN TIMEOUT. Every other dispatcher defaults to the 600,000 ms hook
//       timeout; this one hard-codes 30,000 ms and takes no timeout parameter at
//       all. A prompt-submit hook runs on the critical path between the user
//       pressing enter and the request going out, so it is bounded twenty times
//       tighter — owned here as PROMPT_SUBMIT_TIMEOUT_MS and equality-asserted
//       by the adapter (§2.4 `primitive`).
//   the agent id is read WITHOUT the fan-out rule. Tool-scoped events look the
//       registry up under `hookAgentIds`, which adds the parent for a built-in
//       web-fetch subagent; a prompt submission belongs to one agent, so it is
//       `context.agentId ?? context.session.id` and nothing else.
//   the guard is short-circuited by `managedHooksOnly`. When the caller asked
//       for managed hooks only, the registration check is skipped entirely — a
//       managed hook is not in the registry the check reads.
//   the OPTIONS ARE SPREAD onto the executor request. The record is built, and
//       then whatever the caller passed (`managedHooksOnly`,
//       `managedHooksExcluded`, …) is spread over the request — so a caller can
//       reach executor options this dispatcher does not name.
//
// Upstream's body also carries a `...!1` spread — a compiled-out feature whose
// spread of `false` contributes nothing. It is not reproduced here: spreading
// `false` is a no-op on the resulting object and on its key order, so the byte
// stream a command hook reads is identical either way. Recorded rather than
// silently dropped, because the next pin may turn it back into a real spread.
//
// Ports (nothing behind them is owned by this wave):
//   hasHookForEvent(event, registry, agentId) -> boolean
//   createBaseHookInput(session, cwd, permissionMode)  the common prefix — note
//       THREE arguments: a permission mode but no tool-use context.
//   cwd() -> string
//   sessionTitle(sessionId) -> string | undefined   reads the session store.
//   uuid() -> string                   the synthetic tool-use id.
//   executeHooks(request)              the shared executor.

/** Upstream `I_e` — the UserPromptSubmit hook timeout, in milliseconds. */
export const PROMPT_SUBMIT_TIMEOUT_MS = 30000;

export async function* userPromptSubmitHooks(
  prompt,
  permissionMode,
  context,
  // Upstream's fourth parameter is dead in this body: it is declared, never
  // read, and kept here so the delegation's arity matches the graph's.
  unusedFourth,
  options = {},
  hasHookForEvent,
  createBaseHookInput,
  cwd,
  sessionTitle,
  uuid,
  executeHooks,
) {
  void unusedFourth;
  const agentId = context.agentId ?? context.session.id;
  if (!options.managedHooksOnly && !hasHookForEvent("UserPromptSubmit", context.sessionHooksRegistry, agentId)) return;
  const hookInput = {
    ...createBaseHookInput(context.session, cwd(), permissionMode),
    hook_event_name: "UserPromptSubmit",
    prompt,
    session_title: sessionTitle(context.session.id),
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
    signal: context.abortController.signal,
    timeoutMs: PROMPT_SUBMIT_TIMEOUT_MS,
    toolUseContext: context,
    ...options,
  });
}
