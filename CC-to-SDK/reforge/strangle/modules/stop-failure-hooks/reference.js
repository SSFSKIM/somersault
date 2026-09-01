// PARITY LAYER (§2.5 `reference`) — the StopFailure hook dispatcher
// (upstream `HPe` / `executeStopFailureHooks`, 2.1.251, chunk-fy12d89p).
//
// The turn that ended BADLY. Stop runs when the main agent finishes; this runs on
// the arm of the query loop where the turn ends in an api_error, a
// prompt_too_long or a malformed tool use instead — a RESPONSE no prompt reliably
// provokes, which is why its recording replays an authored fault rather than a
// healthy exchange. The failed message is handed to it, so unlike Stop it never
// searches a transcript for one: the failure IS the message, and its content
// blocks live one level in, on `message.message.content`.
//
// TWO GUARDS, and only one of them can ever be recorded:
//
//   a DELEGATED-OBSERVATION subagent dispatches nothing, for the same reason it
//       dispatches no Stop — its observations are reported through its parent, so
//       firing here would double the failure onto the session it belongs to.
//   a session with NO StopFailure hook registered dispatches nothing either, and
//       that refusal is the COMMON CASE on every session in the world that no
//       scenario can record: a session that registers no hook produces no
//       consult, no record and no frame, so the arm is unrecordable by
//       construction rather than under-scoped. The lookup is by the session id
//       ALONE — no `hookAgentIds` fan-out, because StopFailure is not a
//       permission-scoped event.
//
// The record, field by field where it is not a copy:
//
//   `error` falls back to the literal string "unknown" when the message carried
//       none, and that same value is the `matchQuery` — so a matcher on this
//       event selects on the error text, and matches "unknown" for a failure that
//       named nothing.
//   `last_assistant_message` is the failed message's text blocks joined by
//       NEWLINE (`shared/assistant-text.js`), trimmed, with an empty result
//       becoming `undefined` rather than `""`.
//   `createBaseHookInput` is called in its FOUR-argument form with the permission
//       mode explicitly `undefined` — a turn that failed has no mode to report —
//       and the context passed as the fourth.
//
// It is also the only dispatcher in the family that hands the executor BOTH
// `sessionHooks` and `getAppState` off its CONTEXT. SessionEnd passes the same
// pair, but takes them from an options bag its caller assembles; here they are
// read straight off the context the failing turn already had.
//
// Ports (nothing behind them is owned by this wave):
//   hasHookForEvent(event, registry, sessionId) -> boolean   reads the settings
//       layers and the session registry.
//   createBaseHookInput(session, cwd, permissionMode, context)  the common prefix.
//   cwd() -> string                    the working directory.
//   executeHooksAwait(request) -> results[]   the AWAITING executor (upstream
//       `AE`), whose return value this dispatcher throws away. Unowned, and a
//       ledger edge to whichever wave takes it.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the `timeoutMs` parameter
//       default (§2.4 `primitive`).
//
// Owned, not ports: `isDelegatedObservationSubagent`
// (`shared/hook-agent-context.js`) and `textOfContent`
// (`shared/assistant-text.js`), both of which the stop dispatcher already owns.
import { isDelegatedObservationSubagent } from "../shared/hook-agent-context.js";
import { textOfContent } from "../shared/assistant-text.js";

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function stopFailureHooks(
  message,
  context,
  timeoutMs,
  hasHookForEvent,
  createBaseHookInput,
  cwd,
  executeHooksAwait,
) {
  if (isDelegatedObservationSubagent(context.agentContext)) return;
  if (!hasHookForEvent("StopFailure", context.sessionHooksRegistry, context.session.id)) return;

  const lastText = textOfContent(message.message.content, "\n").trim() || undefined;
  const error = message.error ?? "unknown";
  const hookInput = {
    ...createBaseHookInput(context.session, cwd(), undefined, context),
    hook_event_name: "StopFailure",
    error,
    error_details: message.errorDetails,
    last_assistant_message: lastText,
  };
  await executeHooksAwait({
    session: context.session,
    sessionHooks: context.sessionHooksRegistry,
    getAppState: context.getAppState,
    hookInput,
    timeoutMs,
    matchQuery: error,
    storageV5: context.storageV5,
    credentials: context.credentials,
  });
}
