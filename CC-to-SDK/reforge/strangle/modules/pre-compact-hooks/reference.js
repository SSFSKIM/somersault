// PARITY LAYER (§2.5 `reference`) — the PreCompact hook dispatcher
// (upstream `tz` / `executePreCompactHooks`, 2.1.251, chunk-fy12d89p).
//
// The only dispatcher in the family whose RESULTS the engine acts on. Every
// other one streams hook output back into the conversation and lets the caller
// decide; this one is awaited on the compaction path itself and returns a
// verdict the compactor obeys — a hook can add custom instructions to the
// summarisation prompt, or block the compaction outright. So what this module
// owns is not only the record but the whole reduction from a list of hook
// results to that verdict, and none of it is reachable from a callback that
// returns `{continue:true}`: the parity oracle grades it, `hooks-precompact`
// grades the record and the no-op arm.
//
// The reduction, in the order upstream computes it:
//
//   NOTHING RAN is not the same as nothing to say. Zero results returns the
//       EMPTY verdict immediately — no `blockedBy` key, no `newCustomInstructions`
//       key, not even set to undefined. Every later arm returns an object with
//       the keys present, so this early return is observable.
//   CUSTOM INSTRUCTIONS come from hooks that succeeded, did not block, and
//       printed something; they are joined by a BLANK LINE, because each is a
//       separate instruction rather than a line of one.
//   THE DISPLAY MESSAGE narrates every result that was not cancelled, one line
//       each, joined by a single newline — four phrasings, chosen by whether the
//       hook succeeded and whether it printed anything. A cancelled hook is
//       narrated as nothing at all, which is why the loop `continue`s rather
//       than falling through to the failure arm.
//   BLOCKING is computed from `blocked` alone, not from failure: a hook that
//       failed did not block, and a hook that blocked is reported by command
//       name with its output when it gave one.
//   THE DELEGATED-OBSERVATION ARM. For a delegated-observation subagent the
//       verdict is blocking-only — no instructions, no display message — because
//       that kind of subagent has no conversation to display into and no
//       summarisation prompt of its own to extend. It is decided BEFORE the
//       executor runs (the predicate is read off the context at entry) but
//       applied after, so the hooks still run and only their reporting is
//       dropped.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments).
//   cwd() -> string                    the working directory.
//   executeHooksAwait(request) -> results[]   the AWAITING executor (upstream
//       `AE`). Unowned, and a ledger edge to whichever wave takes it.
//   defaultHookTimeoutMs -> 600000     upstream's `Li` (§2.4 `primitive`).
//
// Owned, not a port: `isDelegatedObservationSubagent`
// (`shared/hook-agent-context.js`), which the stop dispatcher already owns.
import { isDelegatedObservationSubagent } from "../shared/hook-agent-context.js";

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function preCompactHooks(
  session,
  request,
  context,
  signal,
  timeoutMs,
  createBaseHookInput,
  cwd,
  executeHooksAwait,
) {
  const delegatedObservation = isDelegatedObservationSubagent(context.agentContext);
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "PreCompact",
    trigger: request.trigger,
    custom_instructions: request.customInstructions,
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

  const instructions = results
    .filter((r) => r.succeeded && !r.blocked && r.output.trim().length > 0)
    .map((r) => r.output.trim());

  const display = [];
  for (const r of results) {
    if (r.cancelled) continue;
    if (r.succeeded && !r.blocked) {
      if (r.output.trim()) display.push(`PreCompact [${r.command}] completed successfully: ${r.output.trim()}`);
      else display.push(`PreCompact [${r.command}] completed successfully`);
    } else if (r.output.trim()) {
      display.push(`PreCompact [${r.command}] failed: ${r.output.trim()}`);
    } else {
      display.push(`PreCompact [${r.command}] failed`);
    }
  }

  const blocked = results.filter((r) => r.blocked);
  const blockedBy =
    blocked.length > 0
      ? blocked
          .map((r) => {
            const output = r.output.trim();
            return `[${r.command}]${output ? `: ${output}` : ""}`;
          })
          .join("\n")
      : undefined;

  if (delegatedObservation) return { ...(blockedBy !== undefined && { blockedBy }) };
  return {
    newCustomInstructions: instructions.length > 0 ? instructions.join("\n\n") : undefined,
    userDisplayMessage: display.length > 0 ? display.join("\n") : undefined,
    ...(blockedBy !== undefined && { blockedBy }),
  };
}
