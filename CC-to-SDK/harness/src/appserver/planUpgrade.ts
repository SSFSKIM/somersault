// appserver/planUpgrade.ts — `plan_approve` with `acceptEdits:true` upgrades the SESSION's permission
// mode going forward, exactly as the real host does it (host/host.ts's answer -> planUpgradePending ->
// applyPlanUpgrade). decision/respond settling the broker only releases THIS tool call; without the
// upgrade the RPC reports success while every later edit still runs in the old mode and prompts again.
//
// ORDERING IS THE HOST'S (host.ts §mode-sync): the flag is only ARMED at answer time. The CLI performs its
// own post-approval flip on the message stream, and an eager setter races it — so the setter runs when we
// OBSERVE that flip (a system/status frame carrying permissionMode), with a turn-end belt (turns.ts calls
// applyPlanUpgrade on every completion path) for the turn that ends before any status frame arrives.
import type { ThreadRecord } from "./registry.js";

/** Arm the upgrade for this thread. Idempotent: a second plan_approve(acceptEdits) before the first has
 *  applied must not stack a second frame watcher. */
export function armPlanUpgrade(record: ThreadRecord): void {
  if (record.planUpgradePending) return;
  record.planUpgradePending = true;
  const off = record.session.onFrame((m) => {
    const f = m as { type?: string; subtype?: string; permissionMode?: unknown };
    if (f?.type !== "system" || f.subtype !== "status" || typeof f.permissionMode !== "string") return;
    void applyPlanUpgrade(record);
  });
  record.planUpgradeOff = off;
}

/** Apply an armed upgrade, once. A no-op when nothing is armed, so the turn-end belt and the status-frame
 *  watcher can both call it. A failing setter is swallowed (the CLI's own flip stands) — the same rule
 *  host.ts's applyPlanUpgrade keeps. */
export async function applyPlanUpgrade(record: ThreadRecord): Promise<void> {
  if (!record.planUpgradePending) return;
  record.planUpgradePending = false;
  record.planUpgradeOff?.(); record.planUpgradeOff = undefined;
  try { await record.session.setPermissionMode?.("acceptEdits"); }
  catch { /* the engine's own flip stands; nothing here can improve on a rejected setter */ }
}
