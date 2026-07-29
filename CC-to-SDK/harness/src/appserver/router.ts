// appserver/router.ts — ONE per-thread frame router (spec D-M2-6, D-M2-8). Stacking N independent
// `record.session.onFrame` watchers means each re-parses every frame and they race each other; instead
// each thread gets a single subscription with named routes, run in sequence, each in its own try/catch so
// one throwing route cannot starve the others on the same frame. Task 8a moves in the two watchers that
// pre-date this file (the init latch, the planUpgrade status-consult) with no observable behavior change;
// Task 8b adds the remaining eight routes (settings mirror, usage, rate limits, background tasks, todos,
// capabilities, compaction boundaries).
import type { ThreadRecord } from "./registry.js";
import { applyPlanUpgrade } from "./planUpgrade.js";
import type { AppServer } from "./server.js";

/** Absorbed verbatim from the deleted server.ts `latchSessionId`, INCLUDING ITS ORDER (2026-07-30 review
 *  finding: an earlier draft of this route gated the getter read itself behind `system`/`init`, which
 *  silently defeats the fallback described below for any engine whose id shows up on some other frame).
 *  `Session.sessionId` is a GETTER that stays undefined until the first turn's system/init frame lands,
 *  and the read loop invokes frame callbacks BEFORE it records the id — so a getter-only latch needs a
 *  SECOND frame to fire, and a first turn whose iterator ends (or throws) right after system/init would
 *  never deliver one. Reading the id off the INIT FRAME ITSELF is the fallback that fixes THAT case — but
 *  it is only a fallback: the getter is read UNCONDITIONALLY on every frame (not only init frames), and
 *  the init-frame value merely fills in when the getter has nothing yet, so whichever resolves first wins.
 *  The outer `record.sessionId` check makes every frame after the first latch a no-op, mirroring the
 *  deleted function's one-shot `off()` self-unsubscribe without needing a second subscription to manage. */
function routeInit(record: ThreadRecord, frame: { type?: string; subtype?: string; session_id?: unknown }): void {
  if (record.sessionId) return;
  const fromInit = frame?.type === "system" && frame.subtype === "init" && typeof frame.session_id === "string" ? frame.session_id : undefined;
  const sid = record.session.sessionId ?? fromInit;
  if (sid) record.sessionId = sid;
}

/** Absorbed from the deleted `armPlanUpgrade`'s own status-frame watcher (planUpgrade.ts, D-M2-6):
 *  `armPlanUpgrade` now only sets `record.planUpgradePending`; this route is what actually applies it,
 *  once, when the engine's own post-approval status frame is observed.
 *
 *  The `typeof permissionMode === "string"` qualifier is NOT a redundant type guard — it is the same
 *  condition the deleted watcher used, and dropping it reintroduces a real race (2026-07-30 review
 *  finding): the CLI performs its own post-approval mode flip on the message stream, and an eager setter
 *  races it, so `applyPlanUpgrade` must only fire once we OBSERVE that flip — a system/status frame that
 *  actually carries a `permissionMode`. The engine also emits system/status frames for unrelated reasons
 *  (compaction's `compact_result`, see compaction/server.ts) that carry no `permissionMode` at all; firing
 *  on one of those is firing before the flip has happened, not after. */
function routeStatus(record: ThreadRecord, frame: { type?: string; subtype?: string; permissionMode?: unknown }): void {
  if (frame?.type !== "system" || frame.subtype !== "status") return;
  if (typeof frame.permissionMode !== "string") return;
  if (record.planUpgradePending) void applyPlanUpgrade(record);
}

const ROUTES: ((record: ThreadRecord, frame: any) => void)[] = [routeInit, routeStatus];

/** Installs the ONE per-thread frame router. The unsubscribe is stored on `record.routerOff`, called by
 *  `closeRecord` BEFORE the engine is disposed. `srv` is unused in 8a — Task 8b's new routes (usage,
 *  rate limits, background tasks, …) need it to broadcast, so the signature is settled here rather than
 *  changed out from under every call site again next task. */
export function installRouter(srv: AppServer, record: ThreadRecord): void {
  void srv;
  const epoch = record.epoch; // frames from an engine superseded by a rewind swap must never land
  record.routerOff = record.session.onFrame((frame: any) => {
    if (record.epoch !== epoch) return;
    for (const route of ROUTES) {
      try { route(record, frame); } catch { /* one route's failure is not another's — same frame */ }
    }
  });
}
