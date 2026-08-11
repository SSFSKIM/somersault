// appserver/router.ts — ONE per-thread frame router (spec D-M2-6, D-M2-8). Stacking N independent
// `record.session.onFrame` watchers means each re-parses every frame and they race each other; instead
// each thread gets a single subscription with named routes, run in sequence, each in its own try/catch so
// one throwing route cannot starve the others on the same frame. Task 8a moves in the two watchers that
// pre-date this file (the init latch, the planUpgrade status-consult) with no observable behavior change;
// Task 8b (this file) adds the remaining routes: the settings mirror (model/permissionMode, echo-deduped),
// token usage, rate limits, background tasks, task notifications, capability pushes and todo snapshots.
//
// `thread/compacted` used to be a route here too (off the raw system/compact_boundary frame) and is not
// any more: the frame is a boundary marker, not a verdict, so it could not report a failed compaction at
// all. That notification now goes out from lifecycle.ts, off the parsed outcome `compact()` resolves —
// the rule being that a frame relay is only the right shape when the frame IS the payload.
import type { ThreadRecord } from "./registry.js";
import { applyPlanUpgrade } from "./planUpgrade.js";
import { classifyLimitMessage } from "../limits/classify.js";
import type { AppServer } from "./server.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors server.ts's own nowSec — registry.ts's
// `updatedAt` is documented in unix seconds, not ms

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
function routeInit(srv: AppServer, record: ThreadRecord, frame: { type?: string; subtype?: string; session_id?: unknown }): void {
  void srv;
  if (record.sessionId) return;
  const fromInit = frame?.type === "system" && frame.subtype === "init" && typeof frame.session_id === "string" ? frame.session_id : undefined;
  const sid = record.session.sessionId ?? fromInit;
  if (sid) record.sessionId = sid;
}

/** Absorbed from the deleted `armPlanUpgrade`'s own status-frame watcher (planUpgrade.ts, D-M2-6):
 *  `armPlanUpgrade` now only sets `record.planUpgradeMode` (the mode the approval GRANTED, Wave T t10);
 *  this route is what actually applies it, once, when the engine's own post-approval status frame is
 *  observed.
 *
 *  The `typeof permissionMode === "string"` qualifier is NOT a redundant type guard — it is the same
 *  condition the deleted watcher used, and dropping it reintroduces a real race (2026-07-30 review
 *  finding): the CLI performs its own post-approval mode flip on the message stream, and an eager setter
 *  races it, so `applyPlanUpgrade` must only fire once we OBSERVE that flip — a system/status frame that
 *  actually carries a `permissionMode`. The engine also emits system/status frames for unrelated reasons
 *  (compaction's `compact_result`, see compaction/server.ts) that carry no `permissionMode` at all; firing
 *  on one of those is firing before the flip has happened, not after.
 *
 *  Task 8b: this consult runs REGARDLESS of routeSettingsMirror's echo-dedup below — dedup governs only
 *  whether the mirror's `thread/settings/changed` broadcast fires, never this consult (spec Wave 1). Both
 *  routes read the same frame independently; neither gates the other. */
function routeStatus(srv: AppServer, record: ThreadRecord, frame: { type?: string; subtype?: string; permissionMode?: unknown }): void {
  void srv;
  if (frame?.type !== "system" || frame.subtype !== "status") return;
  if (typeof frame.permissionMode !== "string") return;
  if (record.planUpgradeMode) void applyPlanUpgrade(record);
}

/** The settings mirror (spec Wave 1, D-M2-6). The SDK's model/permissionMode/thinkingTokens setters are
 *  setters-only — there is no getter for "what is the engine using right now" — so `record.settings`
 *  mirrors the three knobs, written from two directions: a client's own `thread/*\/set` (a later task,
 *  which writes the mirror FIRST, before the engine ever echoes back) and here, the engine's own
 *  system/status frames.
 *
 *  Echo-dedup rule (spec Wave 1, verbatim): "the engine-frame leg suppresses its broadcast when the
 *  frame's value equals the mirror" — a client's set already wrote the mirror before the engine's status
 *  frame echoes that same change back, so re-broadcasting it here would be noise; a value that DIFFERS
 *  from the mirror is a genuinely engine-originated change (e.g. the CLI's own post-approval flip, or a
 *  future `auto`-mode self-heal) and DOES fire, with `source: "engine"`. This governs the BROADCAST only
 *  — it never gates routeStatus's plan-upgrade consult above, which reads the same frame independently.
 *
 *  `model` mirrors the same way even though no observed system/status frame carries one today
 *  (`SDKStatusMessage` in the vendored sdk.d.ts has only `status`/`permissionMode`/`compact_result`/
 *  `compact_error` — `model` lives on system/init instead): this branch is written per the brief so the
 *  route exists and fires harmlessly if a future/unknown build ever adds one, exactly like the brief's own
 *  "empirical: may not exist" note for this field.
 *
 *  One broadcast, not one per changed knob ("one shape, all three knobs", spec Wave 1): if a single frame
 *  somehow changes both fields, the mirror still emits ONE `thread/settings/changed` carrying the full
 *  post-update `record.settings`, not two partial ones.
 *
 *  `updatedAt` is bumped here too (review fix): registry.ts documents it as "bumped on every
 *  settings/turn mutation", and a genuine (non-echo) mirror write from the engine is exactly that — a
 *  sort-by-recency thread list must not go stale just because the mutation's origin was the engine
 *  instead of a client `thread/*\/set` call. */
function routeSettingsMirror(srv: AppServer, record: ThreadRecord, frame: { type?: string; subtype?: string; permissionMode?: unknown; model?: unknown }): void {
  if (frame?.type !== "system" || frame.subtype !== "status") return;
  let changed = false;
  if (typeof frame.permissionMode === "string" && frame.permissionMode !== record.settings.permissionMode) {
    record.settings.permissionMode = frame.permissionMode;
    changed = true;
  }
  if (typeof frame.model === "string" && frame.model !== record.settings.model) {
    record.settings.model = frame.model;
    changed = true;
  }
  if (!changed) return; // echo-dedup: the frame's value(s) already equal the mirror — nothing to announce
  record.updatedAt = nowSec();
  srv.broadcast(record.id, "thread/settings/changed", {
    threadId: record.id,
    source: "engine",
    model: record.settings.model,
    permissionMode: record.settings.permissionMode,
    thinkingTokens: record.settings.thinkingTokens,
  });
}

/** `result` frames carrying `usage`/`modelUsage` → `thread/tokenUsage/updated {threadId, usage}`. Both
 *  fields are non-optional on the vendored SDK's `SDKResultSuccess`/`SDKResultError` (sdk.d.ts) — a real
 *  result frame always carries both together; the `undefined` guard below only matters for a
 *  hand-built/partial test frame. The brief names ONE payload field ("usage") for what the SDK actually
 *  splits across two: a scalar per-turn tally (`usage`) and a per-model breakdown (`modelUsage`, keyed by
 *  model name — not flattenable into the tally). Bundled under the one field the brief specifies, rather
 *  than inventing a second top-level key it didn't declare: `usage.<token counts>` plus a sibling
 *  `usage.modelUsage` map.
 *
 *  NO context-percentage field (review note): the higher-level design spec describes this notification as
 *  "per-turn usage + context %", but context usage is only reachable via `Session.getContextUsage()` — an
 *  ASYNC call — and this router is a synchronous `onFrame` callback with no result frame that carries a
 *  ready-made percentage. Computing it here would mean awaiting inside a sync dispatch loop that every
 *  other route also runs on, so it is left out; task-8b's own literal payload (`{threadId, usage}`) does
 *  not call for it either. A context-usage percentage belongs behind its own read/poll seam
 *  (`thread/contextUsage/read`, already on the Wave 1 method list), not bolted onto this route. */
function routeTokenUsage(srv: AppServer, record: ThreadRecord, frame: { type?: string; usage?: unknown; modelUsage?: unknown }): void {
  if (frame?.type !== "result") return;
  if (frame.usage === undefined && frame.modelUsage === undefined) return;
  const usage: Record<string, unknown> = { ...(frame.usage as Record<string, unknown> | undefined ?? {}) };
  if (frame.modelUsage !== undefined) usage.modelUsage = frame.modelUsage;
  srv.broadcast(record.id, "thread/tokenUsage/updated", { threadId: record.id, usage });
}

/** `rate_limit_event` / `result` with limit fields → `thread/limits/updated {threadId, limits}` (sparse
 *  merge is the CLIENT's job; the server relays what `classifyLimitMessage` extracted). Condition comes
 *  from an EXISTING consumer, not the table alone (the 8a lesson): `src/limits/classify.ts`'s
 *  `classifyLimitMessage` is already the codebase's one function that reads exactly these two frame types
 *  for limit info (session.ts's readLoop calls it on both `result` and `rate_limit_event` frames) —
 *  `result` frames carry no dedicated rate-limit fields in the vendored SDK types today (only
 *  `rate_limit_event` has `rate_limit_info`), so `classifyLimitMessage`'s TEXT-based classification of a
 *  result frame's `result` string is the only real "result frame with limit fields" signal this codebase
 *  has ever recognized. A clean/absent signal (undefined) relays nothing — there are no fields to relay. */
function routeLimits(srv: AppServer, record: ThreadRecord, frame: unknown): void {
  const mm = frame as { type?: string } | null | undefined;
  if (!mm || (mm.type !== "result" && mm.type !== "rate_limit_event")) return;
  const limits = classifyLimitMessage(frame);
  if (!limits) return;
  srv.broadcast(record.id, "thread/limits/updated", { threadId: record.id, limits });
}

/** system/background_tasks_changed → task/changed (snapshot-REPLACE, never merge). Condition and REPLACE
 *  semantics both match the vendored SDK's own doc comment on `SDKBackgroundTasksChangedMessage` ("Every
 *  live background task after the change... swap your set for this payload") and the existing consumer at
 *  session.ts's readLoop (`this._bgTasks = mm.tasks ?? []; // REPLACE, never merge`). */
function routeBackgroundTasks(srv: AppServer, record: ThreadRecord, frame: { type?: string; subtype?: string; tasks?: unknown }): void {
  if (frame?.type !== "system" || frame.subtype !== "background_tasks_changed") return;
  srv.broadcast(record.id, "task/changed", { threadId: record.id, tasks: frame.tasks ?? [] });
}

/** Task lifecycle frames → task/event {threadId, event: frame}. The brief's table names only
 *  `task_notification`, but its EXISTING consumer in this codebase — `src/host/host.ts`'s
 *  `onSessionFrame` — disagrees on two counts, and matching the table alone would have been the 8a
 *  lesson repeated (a table is a summary, an existing consumer is the ground truth):
 *
 *  1. **Shape normalization.** host.ts's own comment: "Task lifecycle frames arrive with either a bare
 *     type tag or as a system subtype depending on SDK path — match both, deterministically"
 *     (`const sub = mm?.type === "system" ? mm.subtype : mm?.type;`). A route that only checked
 *     `frame.type === "system" && frame.subtype === "task_notification"` would silently miss a task
 *     frame that arrives as `{ type: "task_notification", ... }` with no `system` wrapper at all.
 *
 *  2. **The whole family, not one member.** host.ts treats `task_started`, `task_progress`,
 *     `task_updated`, and `task_notification` as ONE re-emitted event family (`if (sub === "task_started"
 *     || sub === "task_notification" || sub === "task_progress" || sub === "task_updated") { this.emit(...) }`).
 *     A client that only ever sees completions (`task_notification`) and never a task's START or its
 *     PROGRESS cannot render a live task list — it would only ever see tasks appear already finished. */
function routeTaskNotification(srv: AppServer, record: ThreadRecord, frame: { type?: string; subtype?: string }): void {
  const sub = frame?.type === "system" ? frame.subtype : frame?.type;
  if (sub !== "task_started" && sub !== "task_progress" && sub !== "task_updated" && sub !== "task_notification") return;
  srv.broadcast(record.id, "task/event", { threadId: record.id, event: frame });
}

/** system frames carrying a `commands`/`slash_commands` list push → thread/capabilities/changed
 *  {threadId} (a ping; payload never carries the list itself — clients re-read thread/capabilities/read).
 *  Condition comes from the vendored SDK's own doc comment on `SDKCommandsChangedMessage`
 *  (subtype `commands_changed`): "Fire-and-forget push of the full slash-command list after a mid-session
 *  change... Clients should REPLACE their cached command list with this payload" — this is the "list
 *  push" the brief's row names, as distinct from system/init's initial `slash_commands` snapshot (which
 *  is not a push and must not re-trigger this route). The `commands`/`slash_commands` field-name check is
 *  a defensive belt (mirrors the `model`-may-not-exist style elsewhere in this file) alongside the
 *  subtype gate, not a substitute for it. */
function routeCapabilities(srv: AppServer, record: ThreadRecord, frame: { type?: string; subtype?: string; commands?: unknown; slash_commands?: unknown }): void {
  if (frame?.type !== "system" || frame.subtype !== "commands_changed") return;
  if (!Array.isArray(frame.commands) && !Array.isArray(frame.slash_commands)) return;
  srv.broadcast(record.id, "thread/capabilities/changed", { threadId: record.id });
}

/** An assistant frame carrying a `tool_use` block named `TodoWrite` → turn/todo/updated {threadId,
 *  turnId, todos} — `block.input.todos` is the FULL snapshot (replace, never merge), per the brief.
 *  The `!frame.parent_tool_use_id` guard is not in the brief's table — it comes from the existing
 *  consumer of assistant frames in THIS server (`appserver/items/mapper.ts`'s `TurnMapper.ingest`:
 *  `if (f?.parent_tool_use_id) return []; // nested/subagent frame: attribution only, not itemized`).
 *  Without it, a subagent's own private TodoWrite call would be relayed as if it were the MAIN turn's
 *  todo list (the payload's `turnId` is `record.currentTurnId`, the top-level turn) — a real
 *  misattribution, not a cosmetic one.
 *
 *  Presence-guarded (review fix): `b.input?.todos` is skipped, not relayed, when it is not an array. This
 *  route's semantics are snapshot-REPLACE — a conforming client applies whatever `todos` it receives as
 *  the new full list — so broadcasting `todos: undefined` for a malformed/incomplete TodoWrite block
 *  would tell every subscriber to wipe its todo list on garbage input instead of just staying silent. */
function routeTodo(srv: AppServer, record: ThreadRecord, frame: { type?: string; parent_tool_use_id?: unknown; message?: { content?: unknown } }): void {
  if (frame?.type !== "assistant" || frame.parent_tool_use_id) return;
  const content = Array.isArray(frame.message?.content) ? (frame.message?.content as any[]) : [];
  for (const b of content) {
    if (b?.type !== "tool_use" || b.name !== "TodoWrite") continue;
    const todos = b.input?.todos;
    if (!Array.isArray(todos)) continue; // nothing to report — never broadcast an undefined "replace"
    srv.broadcast(record.id, "turn/todo/updated", { threadId: record.id, turnId: record.currentTurnId, todos });
  }
}

const ROUTES: ((srv: AppServer, record: ThreadRecord, frame: any) => void)[] = [
  routeInit,
  routeStatus,
  routeSettingsMirror,
  routeTokenUsage,
  routeLimits,
  routeBackgroundTasks,
  routeTaskNotification,
  routeCapabilities,
  routeTodo,
];

/** Installs the ONE per-thread frame router. The unsubscribe is stored on `record.routerOff`, called by
 *  `closeRecord` BEFORE the engine is disposed. */
export function installRouter(srv: AppServer, record: ThreadRecord): void {
  const epoch = record.epoch; // frames from an engine superseded by a rewind swap must never land
  record.routerOff = record.session.onFrame((frame: any) => {
    if (record.epoch !== epoch) return;
    for (const route of ROUTES) {
      try { route(srv, record, frame); } catch { /* one route's failure is not another's — same frame */ }
    }
  });
}
