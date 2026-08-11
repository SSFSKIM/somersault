// appserver/planUpgrade.ts — an approved `plan_approve` upgrades the SESSION's permission mode to the mode
// the approval GRANTED, exactly as the real host does it (host/host.ts's answer -> planUpgradeMode ->
// applyPlanUpgrade). decision/respond settling the broker only releases THIS tool call; without the
// upgrade the RPC reports success while every later edit still runs in the old mode and prompts again.
//
// ONE DIVERGENCE FROM THE HOST'S APPLIER, recorded: the host swaps the model before granting `auto`
// (auto is model-gated, and off its supported set the engine REFUSES the mode — probe 99: "Cannot set
// permission mode to auto: auto mode unavailable for this model"). This one does not — the merged
// EngineSession does carry `setModel` and a settings mirror now, but performing a silent model swap as a
// side effect of a plan approval is a product decision the appserver deliberately defers (M2b candidate);
// on an unsupported model the grant is simply refused, and the engine stays in the mode it was in. A
// client that wants the guarantee reads the session's own status frames.
//
// ORDERING IS THE HOST'S (host.ts §mode-sync): the flag is only ARMED at answer time. The CLI performs its
// own post-approval flip on the message stream, and an eager setter races it — so the setter runs when we
// OBSERVE that flip (a system/status frame carrying permissionMode), with a turn-end belt (turns.ts calls
// applyPlanUpgrade on every completion path) for the turn that ends before any status frame arrives.
//
// Task 8a (D-M2-6): the status-frame observation no longer lives here as its own `onFrame` watcher — it
// is the per-thread router's `routeStatus` (router.ts), installed once per thread rather than once per
// plan_approve. Arming is now just the flag; applying is unchanged.
import type { ThreadRecord } from "./registry.js";
import type { PlanGrantMode } from "../permissions/types.js";

/** Arm the upgrade for this thread. The router's status route applies it (one watcher per thread, not one
 *  per arm — D-M2-6), so arming is nothing more than the flag. Idempotent: a second plan_approve before
 *  the first has applied must not re-arm (the FIRST grant wins — it is the one the human is waiting on). */
export function armPlanUpgrade(record: ThreadRecord, mode: PlanGrantMode): void {
  if (record.planUpgradeMode) return;
  record.planUpgradeMode = mode;
}

/** Apply an armed upgrade, once. A no-op when nothing is armed, so the turn-end belt and the router's
 *  status route can both call it. A failing setter is swallowed (the CLI's own flip stands) — the same
 *  rule host.ts's applyPlanUpgrade keeps. */
export async function applyPlanUpgrade(record: ThreadRecord): Promise<void> {
  const mode = record.planUpgradeMode;
  if (!mode) return;
  record.planUpgradeMode = undefined;
  try { await record.session.setPermissionMode?.(mode); }
  catch { /* the engine's own flip stands; nothing here can improve on a rejected setter */ }
}
