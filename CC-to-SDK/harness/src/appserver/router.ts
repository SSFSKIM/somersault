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

/** Absorbed verbatim from the deleted server.ts `latchSessionId`. `Session.sessionId` is a GETTER that
 *  stays undefined until the first turn's system/init frame lands, and the read loop invokes frame
 *  callbacks BEFORE it records the id — so a getter-only latch needs a SECOND frame to fire, and a first
 *  turn whose iterator ends (or throws) right after system/init would never deliver one. Reading the id
 *  off the INIT FRAME ITSELF (not only the getter) is what fixes that; the getter stays the primary read
 *  for an engine that latches its id off some other frame. The outer `record.sessionId` check makes every
 *  frame after the first latch a no-op, mirroring the deleted function's one-shot `off()` self-unsubscribe
 *  without needing a second subscription to manage. */
function routeInit(record: ThreadRecord, frame: { type?: string; subtype?: string; session_id?: unknown }): void {
  if (record.sessionId) return;
  if (frame?.type !== "system" || frame.subtype !== "init") return;
  const fromInit = typeof frame.session_id === "string" ? frame.session_id : undefined;
  const sid = record.session.sessionId ?? fromInit;
  if (sid) record.sessionId = sid;
}

/** Absorbed from the deleted `armPlanUpgrade`'s own status-frame watcher (planUpgrade.ts, D-M2-6):
 *  `armPlanUpgrade` now only sets `record.planUpgradePending`; this route is what actually applies it,
 *  once, when the engine's own post-approval status frame is observed. */
function routeStatus(record: ThreadRecord, frame: { type?: string; subtype?: string }): void {
  if (frame?.type !== "system" || frame.subtype !== "status") return;
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
