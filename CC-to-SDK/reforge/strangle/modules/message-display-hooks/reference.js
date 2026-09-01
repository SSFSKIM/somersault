// PARITY LAYER (§2.5 `reference`) — the MessageDisplay hook dispatcher
// (upstream `Zqe` / `executeMessageDisplayHooks`, 2.1.251, chunk-fy12d89p).
//
// The narrowest of the eight dispatchers and the only one whose hook input is
// built from a MESSAGE rather than from a tool call: it names the turn, the
// message, the message's index in that turn, whether it is final, and the delta
// that produced it. The corpus reaches it through `hooks-prompt-submit`.
//
// Three things here are behaviour rather than plumbing, and all three are
// invisible in a callback-only corpus:
//
//   the common prefix is built with TWO arguments, not four. Every tool-scoped
//       dispatcher calls `createBaseHookInput(session, cwd, permissionMode,
//       context)`; this one calls it with the session and the working directory
//       alone, so the record carries no `permission_mode`, no `agent_id` and no
//       `agent_type`. A record that grew those fields would be a different byte
//       stream on a command hook's stdin.
//   the tool-use ID is SYNTHESISED, `${messageId}-${index}`. Every other
//       dispatcher forwards a real tool_use id or mints a uuid; this one builds
//       a stable key out of the message it is announcing, which is what makes a
//       display hook idempotent per message rather than per invocation.
//   the executor is asked for SYNCHRONOUS execution and for telemetry
//       suppression. Display hooks run in the render path, so they may not be
//       deferred, and they fire once per displayed message — per-invocation
//       telemetry would multiply the event stream by the message count.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix — reads app state, the
//       model registry and the session's identity.
//   cwd() -> string                    the working directory.
//   executeHooks(request)              the 23 KB shared executor: matching,
//       command/callback/http/mcp invocation, timeouts, cancellation.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the parameter default,
//       owned here and equality-asserted by the adapter (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* messageDisplayHooks(
  session,
  message,
  sessionHooks,
  signal,
  timeoutMs,
  storageV5,
  credentials,
  createBaseHookInput,
  cwd,
  executeHooks,
) {
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "MessageDisplay",
    turn_id: message.turnId,
    message_id: message.messageId,
    index: message.index,
    final: message.final,
    delta: message.delta,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does. C5x's
  // spiked module had it, and this is the oracle that wave deferred.
  yield* executeHooks({
    session,
    hookInput,
    toolUseID: `${message.messageId}-${message.index}`,
    signal,
    timeoutMs,
    sessionHooks,
    forceSyncExecution: true,
    suppressPerInvocationTelemetry: true,
    storageV5,
    credentials,
  });
}
