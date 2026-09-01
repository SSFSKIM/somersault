// PARITY LAYER (§2.5 `reference`) — the PreToolUse hook dispatcher
// (upstream `Tye` / `executePreToolHooks`, 2.1.251, chunk-fy12d89p).
//
// The largest of the eight and the only one with TWO execution paths. Every
// other dispatcher builds a record and delegates it to the shared executor; this
// one first decides whether the tool call is eligible for the FUNCTION-HOOK
// CHAIN — the in-process path that can rewrite a tool's input, deny it, or defer
// it — and only falls back to the plain settings-hook execution when it is not.
// The corpus reaches it through `hooks`, which registers a PreToolUse callback
// around one Bash call.
//
// The decision, in the order upstream makes it:
//
//   1. a MANAGED PASS already recorded for this exact tool_use id AND this exact
//      input (compared by the engine's stable-key serialisation, not by
//      identity) contributes its pass; a caller asking for managed hooks only
//      skips this entirely.
//   2. the chain runs when either that pass exists or some module registered
//      handlers for the event — and, either way, only when the tool input is a
//      PLAIN OBJECT. A tool whose input is an array or a primitive cannot have
//      its input rewritten, so it is not offered to the chain.
//   3. otherwise the registration guard: if no hook is registered for the event
//      under the fan-out agent ids, the dispatcher returns without building a
//      record. This is the common case on a session with no PreToolUse hooks,
//      and skipping it would spawn a hook execution on every tool call.
//
// The chain path yields its results through the CONFINED-SESSION FILTER: a
// session launched confined takes grants only from its command line, so an
// `allow` a hook chain produced is stripped rather than honoured. The settings
// path yields the executor's results directly.
//
// `runSettingsHooks` is the closure the chain calls back into, and its two
// parameters are behaviour: a rewritten tool input replaces `tool_input` in the
// record (the rest of the record is reused), and per-call managed-hook options
// override the dispatcher's own.
//
// Ports (nothing behind them is owned by this wave):
//   stableKeys.stableKey(value) -> string   the engine's stable serialisation,
//       used to decide whether a managed pass describes THIS input.
//   moduleHandlers.hasModuleHandlers(event) -> boolean   the in-process handler
//       registry.
//   hasHookForEvent(event, registry, agentIds) -> boolean
//   log(message, options)              the engine's verbose logger. Called with
//       the same message and level, because the log stream is an observable
//       surface and a dispatcher that stopped logging would be a difference.
//   createBaseHookInput(session, cwd, permissionMode, context)
//   cwd() -> string
//   executeHooks(request)              the shared executor.
//   preToolChain.executePreToolUseChain(request)  the in-process chain.
//   stripConfinedHookApproval(result, label)      the confined-session filter.
//   defaultHookTimeoutMs -> 600000     upstream's `Li` (§2.4 `primitive`).
import { hookAgentIds } from "../shared/hook-agent-context.js";

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

/**
 * Upstream `He` (chunk-79e2v0j6) — a plain object: not null, not an array.
 *
 * Owned rather than forwarded (§2.4 `pure-helper`). It is what decides whether a
 * tool call is offered to the function-hook chain at all, so its exact shape is
 * this dispatcher's behaviour: a tool input that is an ARRAY takes the settings
 * path even when the chain is armed.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function* preToolHooks(
  toolName,
  toolUseId,
  toolInput,
  context,
  permissionMode,
  signal,
  timeoutMs,
  options,
  stableKeys,
  moduleHandlers,
  hasHookForEvent,
  log,
  createBaseHookInput,
  cwd,
  executeHooks,
  preToolChain,
  stripConfinedHookApproval,
) {
  const managedPass = context.managedPass;
  const pass =
    !options?.managedHooksOnly &&
    managedPass?.toolUseId === toolUseId &&
    stableKeys.stableKey(managedPass.input) === stableKeys.stableKey(toolInput)
      ? managedPass.pass
      : undefined;
  const chainInput =
    !options?.managedHooksOnly && (pass !== undefined || moduleHandlers.hasModuleHandlers("PreToolUse")) && isPlainObject(toolInput)
      ? toolInput
      : undefined;
  if (
    chainInput === undefined &&
    !options?.managedHooksOnly &&
    !hasHookForEvent("PreToolUse", context.sessionHooksRegistry, hookAgentIds(context, "PreToolUse", context.session.id))
  ) {
    return;
  }
  log(`executePreToolHooks called for tool: ${toolName}`, { level: "verbose" });
  const hookInput = {
    ...createBaseHookInput(context.session, cwd(), permissionMode, context),
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
  };
  function runSettingsHooks(rewrittenInput, perCall) {
    return executeHooks({
      session: context.session,
      hookInput: rewrittenInput === undefined ? hookInput : { ...hookInput, tool_input: rewrittenInput },
      toolUseID: toolUseId,
      matchQuery: toolName,
      signal,
      timeoutMs,
      toolUseContext: context,
      managedHooksOnly: perCall?.managedHooksOnly ?? options?.managedHooksOnly,
      managedHooksExcluded: perCall?.managedHooksExcluded,
    });
  }
  if (chainInput !== undefined) {
    for await (const result of preToolChain.executePreToolUseChain({
      hookInput,
      toolInput: chainInput,
      signal: signal ?? context.abortController.signal,
      runSettingsHooks,
      origin: context.hookOrigin,
      managedPass: pass,
    })) {
      yield stripConfinedHookApproval(result, "PreToolUse function-hook chain");
    }
    return;
  }
  return yield* runSettingsHooks();
}
