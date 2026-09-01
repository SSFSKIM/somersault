// PARITY LAYER (§2.5 `reference`) — the PostToolUse hook dispatcher
// (upstream `b3e` / `executePostToolHooks`, 2.1.251, chunk-fy12d89p).
//
// C5x's mechanism spike for the GENERATOR target shape. Every one of the
// engine's eight per-event hook dispatchers is an `async function*` that builds
// one hook-input record and delegates the whole execution — matching, command /
// callback / http / mcp invocation, timeouts, cancellation — into the shared
// executor. This is the smallest of them (363 minified chars), so it exercises
// the `yield*` delegation without dragging the 23 KB executor into the wave.
//
// What it owns: the SHAPE of a PostToolUse hook input — which fields the record
// carries, under which names, and in which order — plus the executor's call
// contract. What it does not own is anything behind a port:
//
//   createBaseHookInput(session, cwd, permissionMode, context)  the common
//       prefix (session_id, transcript_path, cwd, prompt_id, permission_mode,
//       agent_id, agent_type, effort). Reads app state and the model registry.
//   cwd()                     -> string     the working directory
//   executeHooks(request)     -> async iterable of hook results
//   defaultHookTimeoutMs      -> 600000     upstream's `Li`, the parameter
//       default. Owned as DEFAULT_HOOK_TIMEOUT_MS and equality-asserted by the
//       adapter (§2.4 `primitive`), which is the only cheap thing that can see
//       upstream change a timeout without moving a name.
//
// FIELD ORDER IS BEHAVIOUR, not style: the record is JSON-serialised onto a
// hook's stdin, so a reordered key set is a different byte stream for every
// command hook that reads it.

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

/**
 * `yield*`s the executor, so the caller's `next`/`throw`/`return` reach it and
 * its return value becomes this generator's — the same three-part contract the
 * spliced delegation reproduces one level out.
 */
export async function* postToolHooks(
  toolName,
  toolUseId,
  toolInput,
  toolResponse,
  context,
  permissionMode,
  signal,
  timeoutMs,
  durationMs,
  options,
  createBaseHookInput,
  cwd,
  executeHooks,
) {
  const hookInput = {
    ...createBaseHookInput(context.session, cwd(), permissionMode, context),
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
    tool_use_id: toolUseId,
    duration_ms: durationMs,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does. C5x's
  // spiked module had it, and this is the oracle that wave deferred.
  yield* executeHooks({
    session: context.session,
    hookInput,
    toolUseID: toolUseId,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext: context,
    managedHooksOnly: options?.managedHooksOnly,
    managedHooksExcluded: options?.managedHooksExcluded,
  });
}
