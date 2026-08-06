// appserver/planUpgrade.ts — an approved `plan_approve` upgrades the SESSION's permission mode to the mode
// the approval GRANTED, exactly as the real host does it (host/host.ts's answer -> planUpgradeMode ->
// applyPlanUpgrade). decision/respond settling the broker only releases THIS tool call; without the
// upgrade the RPC reports success while every later edit still runs in the old mode and prompts again.
//
// ONE DIVERGENCE FROM THE HOST'S APPLIER, recorded: the host swaps the model before granting `auto`
// (auto is model-gated and falls back to `default` in silence off its supported set). This one cannot —
// `EngineSession` carries no `setModel` and the appserver tracks no current model — but it also holds no
// mode state of its own, so an unnoticed fallback here cannot make any surface report a mode the engine
// is not in. A client that wants the guarantee reads the session's own status frames.
//
// ORDERING IS THE HOST'S (host.ts §mode-sync): the flag is only ARMED at answer time. The CLI performs its
// own post-approval flip on the message stream, and an eager setter races it — so the setter runs when we
// OBSERVE that flip (a system/status frame carrying permissionMode), with a turn-end belt (turns.ts calls
// applyPlanUpgrade on every completion path) for the turn that ends before any status frame arrives.
import type { ThreadRecord } from "./registry.js";
import type { PlanGrantMode } from "../permissions/types.js";

/** Arm the upgrade for this thread. Idempotent: a second plan_approve before the first has applied must
 *  not stack a second frame watcher (the FIRST grant wins — it is the one the human is waiting on). */
export function armPlanUpgrade(record: ThreadRecord, mode: PlanGrantMode): void {
  if (record.planUpgradeMode) return;
  record.planUpgradeMode = mode;
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
  const mode = record.planUpgradeMode;
  if (!mode) return;
  record.planUpgradeMode = undefined;
  record.planUpgradeOff?.(); record.planUpgradeOff = undefined;
  try { await record.session.setPermissionMode?.(mode); }
  catch { /* the engine's own flip stands; nothing here can improve on a rejected setter */ }
}
