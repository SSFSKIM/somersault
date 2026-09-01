// PARITY LAYER (§2.5 `reference`) — the TaskCompleted hook dispatcher
// (upstream `eGe` / `executeTaskCompletedHooks`, 2.1.251, chunk-fy12d89p).
//
// The other half of a near-twin PAIR. `task-created-hooks` (upstream `xUt`) has
// the same nine parameters in the same order, the same port list, the same record
// field set and the same executor request; the ONE thing that differs is the
// event name each stamps — `TaskCompleted` here, `TaskCreated` there. The shape
// is documented once, in the sibling's header, rather than transcribed twice.
//
// Where this one is dispatched from is not the same, and it is the reason the
// pair is two functions rather than one with an argument: TaskCreated fires from
// one place, this fires from two. It runs on the TaskUpdate arm that moves a
// task's status to `completed`, and again in the teammate loop, once per
// in-progress task owned by the current teammate. The teammate loop is also the
// only caller of either dispatcher that passes a REAL permission mode; the
// TaskUpdate arm passes an explicit `undefined`, like TaskCreate does.
//
// The caller consumes `blockingError` off each yielded result, so a hook for this
// event can refuse a completion.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd, permissionMode)  the common prefix — note
//       THREE arguments, no tool-use context.
//   cwd() -> string                    the working directory.
//   uuid() -> string                   upstream's `randomUUID`, the synthetic
//       tool-use id this event is correlated by.
//   executeHooks(request)              the shared executor.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the `timeoutMs` parameter
//       default (§2.4 `primitive`); see the sibling's header.

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* taskCompletedHooks(
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
    hook_event_name: "TaskCompleted",
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
