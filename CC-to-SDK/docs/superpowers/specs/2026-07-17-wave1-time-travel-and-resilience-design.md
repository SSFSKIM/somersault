# Wave 1 — Session Time-Travel + Daemon Resilience — Design

**Goal:** Ship the four Wave-1 items of `docs/parity/full-potential.md` §3: (1) `resumeSessionAt`
conversation rewind composed with file checkpoints into one time-travel surface, (2) `reinitialize()`
exposure for control-channel refresh, (3) typed billing/limit classification (the 2026-07 auth
incident, productized), (4) background-task visibility (`background_tasks_changed` + `stopTask` +
`backgroundTasks` Ctrl+B). One spec for the wave — the items are independent but small, and they land
in the same seams (`Session`, `resolveOptions`, daemon supervisor/server).

## Evidence (probes 37/37b/38/39, all live on SDK 0.3.211 / CLI 2.1.211, 2026-07-17)

**Probe 37 — `resumeSessionAt` (`probes/probes/37-resume-session-at.ts`):**
- REACHABLE headlessly: `{ resume, resumeSessionAt: <uuid> }` drops post-anchor context (turn-2
  codeword unknown after rewinding to turn 1).
- **In-place rewind is DESTRUCTIVE**: same `session_id`, and the persisted transcript is truncated at
  the anchor — the post-anchor turns are unrecoverable (a later run even destroyed a previously-valid
  anchor uuid, erroring "No message found with message.uuid of: X" — that's the invalid-anchor shape).
- **Anchor may be an assistant-message uuid (declared) OR a user-message uuid (undeclared but
  accepted)** — so one user-prompt uuid can drive BOTH conversation rewind and `rewindFiles` (whose
  checkpoints anchor at user-prompt uuids).

**Probe 37b — fork safety (`37b-rewind-fork-safety.ts`):**
- `{ resume, resumeSessionAt, forkSession: true }` = **non-destructive branch**: NEW session id,
  context anchored (post-anchor turns unknown), original transcript fully intact (anchor still valid).

**Probe 38 — `reinitialize()` + `interrupt()` (`38-reinitialize.ts`):**
- `reinitialize()` resolves mid-session with the **full init payload** (commands, agents,
  output_style, available_output_styles, models, account, pid, remote-control gates) — a fresh
  re-fetch, unlike the cached `initializationResult()`.
- It does **NOT deadlock** while a `can_use_tool` is parked, and the parked request is **deduped, not
  redelivered** to the same SDK process (Δ=0 broker calls). Redelivery only matters for a *fresh* SDK
  attach to a running CLI — our daemon holds one long-lived Query, so for us `reinitialize()` is a
  **capability-refresh** lever (e.g. mid-session command/agent discovery after `commands_changed`),
  not permission recovery.
- `interrupt()` returns a receipt: `{ still_queued: [] }` (uuids of still-queued async messages). The
  interrupted turn resolves `error_during_execution`, and the query stream can then THROW an
  `[ede_diagnostic]` error at teardown — daemon paths must tolerate a session that dies post-interrupt
  (our `readLoop` already `finally`-rejects waiters; the restart policy covers revival).

**Probe 39 — background tasks (`39-background-tasks.ts`):**
- `system/background_tasks_changed` **streams headlessly**: `{ tasks: [{ task_id, task_type,
  description }] }`, LEVEL signal with REPLACE semantics (declared: nothing at startup; reset on CLI
  restart).
- `stopTask(id)` works: emits `background_tasks_changed` with the task removed + a
  `task_notification` `{ status: "stopped" }`.
- `backgroundTasks()` (no-arg Ctrl+B) works mid-turn: a blocking foreground Bash got "manually
  backgrounded by user", the turn continued, the task appears in the changed set.
- Op caution: CLI 2.1.211 **blocks long leading foreground sleeps** ("Blocked: sleep 45 …") — probes
  and tests must use `until [ -f flag ]; do sleep 2; done` long-runners.

## Design

### 1. Time-travel: `resumeAt` config + `rewindSessionAt` + daemon `rewind` op

- **`HarnessConfig.resumeAt?: string`** — one-line `resolveOptions` wire to SDK `resumeSessionAt`
  (+ `forkSession?: boolean` passthrough, which resolveOptions does not yet model). Validation: zod
  looseObject → no schema change needed beyond the typed fields.
- **Lib convenience `rewindSession(id, messageId, config?)`** (in `session/index.ts`, next to
  `resumeSession`): opens a `Session` on the rewound branch. `config.fork: true` → non-destructive
  branch (new sdk session id); default in-place = **destructive** (documented loudly; matches real
  Esc-Esc semantics where the tail is replaced on submit).
- **Daemon op `rewind`** `{ id, messageId, fork? }`: supervisor swaps the pool entry — dispose the
  live `DaemonSession`, `makeSession(id, cfg, resume=sdkSessionId, resumeAt=messageId)` (same daemon
  id, registry updated; `fork:true` routes through a fresh sdk id à la `fork` op but anchored).
- **Files composition:** callers pass a **user-prompt uuid** (valid for BOTH surfaces, probe 37 Q4)
  and set `{ files: true }` on the daemon op / use `Session.rewind()` after the first turn — file
  checkpointing rewind stays the existing live-session `rewindFiles` call. No uuid-mapping layer
  needed (the Q4 finding removed it).

### 2. `reinitialize()` — Session method + daemon op

- `Session.reinitialize(): Promise<unknown>` (callQValue wire). Daemon op `reinit` → fresh init
  payload to clients (console can re-sync commands/models/account mid-session).
- `Session.interrupt()` return type widens `void` → `unknown` (the receipt); `ControlBridge`
  interrupt response carries it (additive `Record<string, unknown>` on the ok response).

### 3. Limits: `src/limits/classify.ts` (pure) + Session/daemon surfacing

- Pure classifier over the SDK's **runtime-exported** prefix constants (verified):
  `USAGE_LIMIT_ERROR_PREFIXES` (12), `USAGE_WARNING_PREFIXES` (2), `USAGE_TRANSITION_PREFIXES` (6),
  `ORG_POLICY_LIMIT_PREFIXES` (1) — **plus observed families the SDK does not declare**: the 2026-07
  incident string "Your organization has disabled Claude subscription access" (org-policy) and the
  API-credit exhaustion "Credit balance is too low" (credits-exhausted).
- `LimitState = { kind: "usage-limit" | "usage-warning" | "usage-transition" | "org-policy" |
  "credits-exhausted" | "rate-limit", message, resetsAt? }`.
- `classifyLimitText(text)` (prefix match) + `classifyLimitMessage(m)` (result frames by text;
  `rate_limit_event` frames by `rate_limit_info.status === "rejected"`, carrying `resetsAt`).
- **Session** tracks `limitState` in `readLoop`: every result frame reclassifies (a clean result
  CLEARS it — state-of-last-result semantics); `rate_limit_event` updates it (allowed → clears).
- **Daemon**: after submit (success or throw), supervisor copies `session.limitState` into the
  registry record (`SessionRecord.limit?`) so `list` output shows limited sessions. Health-probe
  `00-health-check.ts` already codifies the operator-side rule.

### 4. Background tasks: Session state + daemon ops

- **Session** consumes `background_tasks_changed` in `readLoop` → `backgroundTasks` getter (REPLACE
  the set each event, per the declared level semantics). Methods: `stopTask(taskId)`,
  `backgroundAll(toolUseId?)` (the Ctrl+B `backgroundTasks` Query method — renamed to avoid clashing
  with the getter).
- **Daemon ops**: `bg_tasks` { id } → the session's current set; `stop_task` { id, taskId }.
- Console panel: deferred to the tui backlog (this increment is lib+daemon; the tui has its own
  increment cadence).

## Non-goals / deferred

- TUI Esc-Esc rewind UX + console background-task panel (tui increments; the lib/daemon levers this
  wave ships are their prerequisites).
- `updatedPermissions` persistence, `onElicitation` (Wave 2 probes).
- External sessionStore interplay with rewind (Wave 3, adapter first).

## Tests

Per item: unit (fake QueryFn / DI) + one gated live test. Live: rewind e2e (build 2 turns → in-place
rewind loses turn 2 → fork rewind keeps original intact), reinit+interrupt liveness, limits classifier
is unit-only (can't reproduce org-policy live — string fixtures from the incident), background-tasks
e2e (launch until-loop bg → see changed set → stopTask → set empties; NO leading-sleep commands).
