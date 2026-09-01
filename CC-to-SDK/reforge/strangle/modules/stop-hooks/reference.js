// PARITY LAYER (§2.5 `reference`) — the Stop / SubagentStop hook dispatcher
// (upstream `y9` / `executeStopHooks`, 2.1.251, chunk-fy12d89p).
//
// ONE function, TWO events. Whether an agent id was passed decides everything:
// with one, the turn that ended was a subagent's and the record is a
// SubagentStop carrying `agent_id`, `agent_transcript_path` and `agent_type`;
// without one, it is the session's own Stop. The corpus covers both arms —
// `hooks-prompt-submit` for the plain Stop, `hooks-subagent` for a run that
// fires the subagent arm and then the parent's Stop.
//
// It is also the most guarded of the eight, and the guards are the behaviour a
// callback corpus cannot see:
//
//   a DELEGATED-OBSERVATION subagent dispatches nothing. Its observations are
//       reported through its parent, so firing Stop hooks for it would double
//       every turn-end hook of the session it belongs to.
//   a BUILT-IN WEB-FETCH subagent skips the registration check and runs the
//       executor in `managedHooksOnly` mode: the same flag both bypasses the
//       guard and narrows what the executor will run.
//   the `turn_end_reactions` PHASE additionally requires a FUNCTION hook to be
//       registered for the event on this agent — a reaction phase exists to run
//       in-process reactions, so a session with only settings hooks has nothing
//       to do and must not pay for a hook execution.
//   the phase also decides two executor options: session function hooks are
//       SKIPPED outside the two turn-end phases, and run EXCLUSIVELY in the
//       reactions phase. Three phases, three different executor requests.
//
// `last_assistant_message` is the one derived field in any hook record: the last
// assistant message's text blocks, joined by newlines and trimmed, with an empty
// result becoming `undefined` rather than `""` (see `shared/assistant-text.js`).
//
// Ports (nothing behind them is owned by this wave):
//   hasHookForEvent(event, registry, agentId) -> boolean
//   backgroundTasks(tasks) -> array    the task registry's wire projection; its
//       far side belongs to the background-task subsystem.
//   sessionCrons() -> array            the session's scheduled prompts.
//   createBaseHookInput(session, cwd, permissionMode, context)
//   cwd() -> string
//   agentTranscriptPath(agentId) -> string   resolves the child's transcript
//       file; a ledger edge to session storage.
//   uuid() -> string                   the synthetic tool-use id.
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li` (§2.4 `primitive`).
import { isBuiltInWebFetchSubagent, isDelegatedObservationSubagent } from "../shared/hook-agent-context.js";
import { lastAssistantMessage, textOfContent } from "../shared/assistant-text.js";

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* stopHooks(
  permissionMode,
  signal,
  timeoutMs,
  stopHookActive,
  agentId,
  context,
  messages,
  agentType,
  phase,
  hasHookForEvent,
  backgroundTasks,
  sessionCrons,
  createBaseHookInput,
  cwd,
  agentTranscriptPath,
  uuid,
  executeHooks,
) {
  const event = agentId ? "SubagentStop" : "Stop";
  if (isDelegatedObservationSubagent(context.agentContext)) return;
  const managedHooksOnly = isBuiltInWebFetchSubagent(context.agentContext);
  const lookupId = context.agentId ?? context.session.id;
  if (!managedHooksOnly && !hasHookForEvent(event, context.sessionHooksRegistry, lookupId)) return;
  if (phase === "turn_end_reactions" && !context.sessionHooksRegistry.getFunctionHooks(lookupId, event).get(event)?.length) return;

  const last = messages ? lastAssistantMessage(messages) : undefined;
  const lastText = last ? textOfContent(last.message.content, "\n").trim() || undefined : undefined;
  const ambient = { background_tasks: backgroundTasks(context.taskRegistry.all()), session_crons: sessionCrons() };
  const base = createBaseHookInput(context.session, cwd(), permissionMode, context);
  const hookInput = agentId
    ? {
        ...base,
        hook_event_name: "SubagentStop",
        stop_hook_active: stopHookActive,
        agent_id: agentId,
        agent_transcript_path: agentTranscriptPath(agentId),
        agent_type: agentType ?? "",
        last_assistant_message: lastText,
        ...ambient,
      }
    : {
        ...base,
        hook_event_name: "Stop",
        stop_hook_active: stopHookActive,
        last_assistant_message: lastText,
        ...ambient,
      };

  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does. C5x's
  // spiked module had it, and this is the oracle that wave deferred.
  yield* executeHooks({
    session: context.session,
    hookInput,
    // Declared and always `undefined` upstream — a slot for an extended record
    // that nothing on this path fills. Kept because it is part of the executor
    // request's shape, and because a pin that starts filling it should show up
    // as a diff here rather than as a missing key.
    extendedHookInput: undefined,
    toolUseID: uuid(),
    signal,
    timeoutMs,
    toolUseContext: context,
    messages,
    managedHooksOnly,
    skipSessionFunctionHooks: phase !== "turn_end" && phase !== "turn_end_reactions",
    sessionFunctionHooksOnly: phase === "turn_end_reactions",
  });
}
