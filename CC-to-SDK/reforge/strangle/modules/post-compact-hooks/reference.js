// PARITY LAYER (§2.5 `reference`) — the PostCompact hook dispatcher
// (upstream `kPe` / `executePostCompactHooks`, 2.1.251, chunk-fy12d89p).
//
// PreCompact's twin on the far side of the summary. `wFt` awaits `tz` and then
// this one, so ONE compaction drives both — and everything worth owning here is
// an asymmetry between them:
//
//   the RECORD carries `compact_summary` where PreCompact carries
//       `custom_instructions`. This dispatcher runs AFTER the summary exists,
//       which is the whole point of the event: a hook here reads what the
//       compaction produced rather than shaping what it will produce.
//   the VERDICT is DISPLAY-ONLY. No instruction reduction, no blocking arm — a
//       hook cannot stop a compaction that has already happened — so the returned
//       object has exactly one key, and a hook that blocks changes nothing.
//   the NARRATION therefore keys off `succeeded` ALONE. PreCompact asks
//       `succeeded && !blocked` because blocking is a verdict it acts on; here a
//       blocked hook is narrated as an ordinary success, because `blocked` has
//       nowhere to go.
//   the DELEGATED-OBSERVATION guard is an EARLY RETURN, not a late reduction.
//       PreCompact reads the predicate at entry and applies it after the executor
//       has run, so its hooks still fire and only their reporting is dropped;
//       here the dispatcher returns before building anything and the hooks NEVER
//       RUN.
//
// Two arms return the same `{}` for different reasons — that refusal, and
// upstream's zero-results early return — and neither carries the
// `userDisplayMessage` key that the surviving arm always sets, even when it sets
// it to `undefined`. Present-and-undefined versus absent is the observable.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments).
//   cwd() -> string                    the working directory.
//   executeHooksAwait(request) -> results[]   the AWAITING executor (upstream
//       `AE`). Unowned, and a ledger edge to whichever wave takes it.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the `timeoutMs` parameter
//       default (§2.4 `primitive`).
//
// Owned, not a port: `isDelegatedObservationSubagent`
// (`shared/hook-agent-context.js`), which the stop dispatcher already owns.
import { isDelegatedObservationSubagent } from "../shared/hook-agent-context.js";

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function postCompactHooks(
  session,
  request,
  context,
  signal,
  timeoutMs,
  createBaseHookInput,
  cwd,
  executeHooksAwait,
) {
  if (isDelegatedObservationSubagent(context.agentContext)) return {};
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "PostCompact",
    trigger: request.trigger,
    compact_summary: request.compactSummary,
  };
  const results = await executeHooksAwait({
    session,
    hookInput,
    matchQuery: request.trigger,
    signal,
    timeoutMs,
    storageV5: context.storageV5,
    credentials: context.credentials,
  });
  if (results.length === 0) return {};

  const display = [];
  for (const r of results) {
    if (r.cancelled) continue;
    if (r.succeeded) {
      if (r.output.trim()) display.push(`PostCompact [${r.command}] completed successfully: ${r.output.trim()}`);
      else display.push(`PostCompact [${r.command}] completed successfully`);
    } else if (r.output.trim()) {
      display.push(`PostCompact [${r.command}] failed: ${r.output.trim()}`);
    } else {
      display.push(`PostCompact [${r.command}] failed`);
    }
  }
  return { userDisplayMessage: display.length > 0 ? display.join("\n") : undefined };
}
