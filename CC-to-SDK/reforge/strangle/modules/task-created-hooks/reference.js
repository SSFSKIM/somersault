// PARITY LAYER (§2.5 `reference`) — the TaskCreated hook dispatcher
// (upstream `xUt` / `executeTaskCreatedHooks`, 2.1.251, chunk-fy12d89p).
//
// One half of a near-twin PAIR. `task-completed-hooks` (upstream `eGe`) has the
// same nine parameters in the same order, the same port list, the same record
// field set and the same executor request; the ONE thing that differs is the
// event name each stamps — `TaskCreated` here, `TaskCompleted` there. Everything
// said below about the shape holds for both, so it is not said twice.
//
// This one is dispatched from inside the TaskCreate tool's own `call()`, after
// the task row is written and before the tool returns.
//
// What the pair owns, and what makes it unlike the tool-scoped dispatchers:
//
//   the record is TASK-SHAPED, not tool-shaped: the task's id, subject and
//       description, plus the teammate and team the creating call is attributed
//       to. There is no `tool_name`, no `tool_input` and no `tool_use_id`.
//   NO `matchQuery`. Every tool-scoped dispatcher hands the executor a string for
//       matchers to narrow on (the tool name, the agent type, the compaction
//       trigger); this pair hands it none, so a matcher cannot select among task
//       events and every hook registered for the event runs on every task.
//   the common prefix is built with THREE arguments — session, cwd and the
//       permission mode — EVEN THOUGH the tool-use context is in hand: it is the
//       last parameter and it is handed to the executor, just not to the prefix
//       builder. So `agent_id` and `effort` come out undefined and `agent_type`
//       falls back to the ambient default, where a tool-scoped record would carry
//       the dispatching context's own. The TaskCreate call site also passes the
//       permission mode as an explicit `undefined`, so in practice
//       `permission_mode` is absent from the serialised record too.
//   the tool-use id is SYNTHESISED. A task event has no tool call of its own to
//       correlate by, so the executor is given a fresh uuid.
//
// The caller consumes `blockingError` off each yielded result, so a hook for this
// event can refuse a task — which is the reason the record's field set is worth
// this much care: a command hook decides on the serialised bytes.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd, permissionMode)  the common prefix — note
//       THREE arguments, no tool-use context.
//   cwd() -> string                    the working directory.
//   uuid() -> string                   upstream's `randomUUID`, the synthetic
//       tool-use id this event is correlated by.
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the `timeoutMs` parameter
//       default. The graph keeps upstream's parameter list, so the default is
//       already applied by the time it reaches here; the value is owned as
//       DEFAULT_HOOK_TIMEOUT_MS and equality-asserted by the adapter
//       (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* taskCreatedHooks(
  taskId,
  subject,
  description,
  teammateName,
  teamName,
  permissionMode,
  signal,
  timeoutMs,
  toolUseContext,
  createBaseHookInput,
  cwd,
  uuid,
  executeHooks,
) {
  const hookInput = {
    ...createBaseHookInput(toolUseContext.session, cwd(), permissionMode),
    hook_event_name: "TaskCreated",
    task_id: taskId,
    task_subject: subject,
    task_description: description,
    teammate_name: teammateName,
    team_name: teamName,
  };
  // A BARE `yield*`, deliberately: upstream discards the executor generator's
  // completion value, so this dispatcher returns `undefined`. Returning it
  // instead is a difference NO SCENARIO CAN SEE — nothing on the corpus's paths
  // reads a dispatcher's return value — and only the parity oracle does.
  yield* executeHooks({
    session: toolUseContext.session,
    hookInput,
    toolUseID: uuid(),
    signal,
    timeoutMs,
    toolUseContext,
  });
}
