# Control-plane fidelity (Goal B) — design

- **Status:** approved 2026-07-28 (brainstorm with owner; probes 65/66 run live first)
- **Parent:** `2026-07-26-clone-process-surface-spine-design.md` — this is the "Goal B" its
  Goal-boundary table splits out. The spine (Goal A: one binary, park/attach/answer, fleet) shipped
  with A1 + A2a + A2b and is the substrate this builds on.
- **Plan:** `docs/superpowers/plans/` (written after spec approval)

## Purpose

Close the four control-plane gaps where our clone silently drops model behavior a human must see or
answer. A `tui/src` sweep (recorded in the spine spec) found **zero** handling for all four:

1. **`AskUserQuestion`** — the model asks a multiple-choice question; today our gate auto-allows it
   with unchanged input, so the model receives *no answer at all* and the human never sees the
   question. This is the worst silent loss in the product.
2. **`ExitPlanMode`** — plan-mode sessions are dead ends: no approval dialog, `plan` kicked off the
   Tab ladder, no way to reject-with-feedback.
3. **Background shells** — the lib layer is complete (`backgroundAll`/`stopTask`/
   `background_tasks_changed` ingestion) but there is no Ctrl+B, no panel, no wire ops, and
   between-turn task frames are dropped.
4. **Subagent attribution** — a subagent's parked permission is indistinguishable from the parent's;
   task lifecycle frames (`task_started`/`task_notification`) are never rendered.

North star unchanged: clone Claude Code as a product. Every surface must work **both** in the
foreground REPL **and** over `ccx attach` to a detached host — a `--bg` worker that hits a question
and can only stall is the exact failure this spec exists to kill. `tui-ux.md` measures look-and-feel
only; this work adds the control-plane axis it cannot see.

## Grounding (probed live 2026-07-28, before design)

| Evidence | What it settled |
|---|---|
| **probe 65** (`probes/probes/65-askuserquestion-canusetool.ts`) | `AskUserQuestion` consults `canUseTool` **with no ask rules** — it is always-ask, unlike every other tool (probe 58's "ask-routed only" doctrine has this one exception). Returning `{behavior:"allow", updatedInput:{...input, answers:{"<question text>":"<label>"}}}` delivers the answer: tool_result reads `answered: …="blue"` and the model's final text reflected the choice. |
| **probe 66** (`probes/probes/66-exitplanmode-approval.ts`) | Under `permissionMode:"plan"`: `ExitPlanMode` parks in `canUseTool`; `deny(message)` arrives as an error tool_result with the feedback verbatim and the model **revises its plan and re-calls**; `allow` proceeds to real execution. **The CLI flips the mode itself after allow** and emits a `system`/`status` frame (`{subtype:"status", status:null, permissionMode:"default"}`) — the harness does not own the base flip, only the optional upgrade to `acceptEdits`. Plan-mode sessions auto-save the plan to `~/.claude/plans/<slug>.md`; the approval tool_result names the path. |
| probe 39 (Wave 1) | `backgroundTasks()` (Ctrl+B) backgrounds a blocking foreground Bash **mid-turn**; `stopTask(id)` emits `task_notification{status:"stopped"}`; `background_tasks_changed` is a REPLACE snapshot. Caveat: the no-arg form returns `true` even when idle — detect via the changed-frame, not the return. |
| probes 58 / 63 / 63b | Park = a held `canUseTool` promise, indefinitely; interrupt releases the park and the stream then throws. Inherited semantics, unchanged here. |
| probe 22 / 54 / SDK 0.3.211 types | Nested subagent frames carry `parent_tool_use_id`; `SDKTaskStartedMessage` carries `{task_id, tool_use_id?, subagent_type?}` — the attribution correlation keys. `BashOutput`/`KillShell` **do not exist in this SDK**; the real tools are `TaskOutput`/`TaskStop`, and backgrounding is `Bash.run_in_background` / `Query.backgroundTasks()`. |
| A2b outcomes (spine spec) | The park/answer wire, first-answer-wins, host-death answer-channel liveness (`.catch` fix F1), detachedness-scoped park, mid-turn attach replay — all shipped and live-proven. This spec generalizes that machinery; it does not rebuild it. |

Unverified premise, deliberately carried: **whether a subagent's inner tool calls consult the parent
session's `canUseTool`, and with which `toolUseID`**. Acceptance ④ verifies it live; if nested calls
turn out not to consult, attribution scope shrinks to task-lifecycle display (started/done notices,
panel rows) and the dialog-title attribution row is dropped — the decision park itself is unaffected.

## Architecture: one park, three kinds

The A2b permission park becomes a **decision park** with a `kind` discriminator. One store, one wire
event pair, one answer op, one dialog dispatcher. The park lifecycle (indefinite hold, teardown
deny-all, first-answer-wins, host-death liveness) is written once and inherited by every kind — the
seam class where both A2a's and A2b's worst defects lived is tested once, centrally.

```ts
type DecisionKind = "permission" | "question" | "plan";

type PendingDecision = {
  kind: DecisionKind;
  sessionId: string; toolUseID: string; toolName: string;
  input: Record<string, unknown>;   // questions array for "question"; { plan } for "plan"
  parentToolUseID?: string;         // subagent attribution (best-effort correlation, see below)
  subagentType?: string;
  title?: string; displayName?: string; description?: string;
  createdAt: number;
};

type DecisionAnswer =
  | { kind: "permission"; decision: "allow_once" | "allow_always" | "deny" }
  | { kind: "question";   answers: Record<string, string>; response?: string }  // response = free-text "Other"
  | { kind: "plan";       decision: "approve" | "approve_accept_edits" | "reject"; feedback?: string };
```

**Routing** (in the gate, today's `createPermissionGate` — `src/permissions/gate.ts`):
`toolName === "AskUserQuestion"` → `question` · `toolName === "ExitPlanMode"` → `plan` · else →
`permission`. Routing is unconditional on mode: probe 65 shows questions arrive regardless of rules.

**Resolution** (answer → `PermissionResult`):

| Answer | Returned to the SDK | Side effect |
|---|---|---|
| `permission` 3-way | as today (`allow` + unchanged input / `deny`) | `allow_always` keeps the existing name-keyed allowlist |
| `question` | `allow` + `updatedInput: { ...input, answers, ...(response ? { response } : {}) }` | — |
| `plan` `approve` | `allow` + unchanged input | none — the CLI flips the mode itself (probe 66) |
| `plan` `approve_accept_edits` | `allow` + unchanged input | host calls its existing `setPermissionMode("acceptEdits")` after release |
| `plan` `reject` | `deny` + `message: feedback` (default: `"User rejected the plan. Continue planning."`) | model keeps planning (probe 66) |

**Parking policy is uniform and unchanged**: detached hosts park every kind indefinitely; a
non-detached host at `connectionCount() === 0` denies (a question deny reads
`"No user is available to answer."`). **We never fabricate an answer** — no AFK auto-resolve, no
default option (the SDK's `afkTimeoutMs` field shows CC has such a fallback; rejected here, see
Decision Log).

### Wire changes (we own both ends; clean rename, no compat shims)

- `PendingPermissions` → **`PendingDecisions`** (`src/permissions/pending.ts`): same lifecycle,
  `PendingEntry` → `PendingDecision`.
- Host events `permission` / `permission_settled` → **`decision` / `decision_settled`**
  (`src/host/wire.ts`); the pending snapshot replayed to fresh attachers carries decisions.
- The `answer` op payload becomes the `DecisionAnswer` union (`src/host/ops.ts`); the op validates
  kind-vs-toolUseID match and rejects with an op error (park stays) on mismatch.
- **Three new ops**: `tasks` (list `BackgroundTaskSummary[]`), `background` (no-arg Ctrl+B →
  `session.backgroundAll()`), `stop_task {taskId}` (→ `session.stopTask`).
- **One new event**: `tasks_changed` — the REPLACE snapshot, re-emitted from
  `background_tasks_changed`, and included in the attach start frame so a fresh client renders the
  panel correctly.
- **`status` passthrough**: the session intercepts `system`/`status` frames and the host re-emits the
  mode on its `state` event (`permissionMode` field added). Every client's status bar now tracks the
  **host's real mode** — closing A2b's recorded "status bar starts at `default`" quirk, and covering
  the CLI's own plan-approval flip.

### Session-layer change (the one and only)

`src/session/session.ts` today routes non-`result` frames to `this.waiters[0]` — **between turns
there is no waiter and system frames vanish** (this is why an idle host misses task and status
frames). The session gains a persistent system-frame listener (host subscribes once); waiter
dispatch is unchanged. `background_tasks_changed` interception (`_bgTasks`) already happens
pre-waiter and stays.

### Subagent attribution (best-effort correlation)

`canUseTool` receives no parent linkage, so the host correlates: it already streams every message and
now maintains `toolUseID → { parentToolUseID }` from nested frames (`parent_tool_use_id` on
assistant/user messages) and `tool_use_id → { subagentType }` from `task_started` frames. When a
decision parks, the host stamps whatever the map holds; a miss means no attribution shown, never a
block. The map is per-turn and cleared on turn end (bounded).

### Untouched on purpose

The retiring daemon-library path (`src/daemon/*`, 30s auto-deny) is frozen — decisions surface on
the host path only. Swarm's `planApproval.ts` keeps its own teammate-scoped broker (its
`postApprovalMode` is now known to be the same layering the REPL uses). `render.ts`'s replay path
gains only the task/attribution notices, not a new reducer.

## TUI components

**Dialog dispatcher.** `useChat`'s pending queue holds `PendingDecision`s; a dispatcher renders by
kind — the existing `PermissionDialog` (unchanged) for `permission`, plus two new dialogs. FIFO as
today. The answer path is the one existing channel, renamed `answerDecision`, so A2b's host-death
`.catch` liveness (notice + un-mark + dialog stays) covers all three kinds with zero new code.

**QuestionDialog** (`src/tui/QuestionDialog.tsx`). Sequential per-question flow with a `[2/3]`
progress marker and the `header` chip; options as label + dimmed description (arrows + number keys);
an always-present **Other** row opening a one-line free-text input (→ `response`); `multiSelect`
toggles with space, submits with Enter. Answers accumulate locally; one wire answer after the last
question. Multi-select answers join with `", "` (the SDK's declared convention). Sequential (not
CC's side-by-side tabs) is an accepted divergence, recorded in the Decision Log.

**PlanDialog** (`src/tui/PlanDialog.tsx`). Renders `input.plan` through the existing markdown
renderer in a scrollable box (↑/↓ scroll, bounded height), then CC's three choices:
`1` approve & auto-accept edits · `2` approve, manual edits · `3`/Esc keep planning → one-line
feedback input → `reject`. Approval renders the plan-file path from the tool_result when present.

**Tab ladder.** `default → acceptEdits → plan → auto` (`useChat.ts` ladder array + status bar).
Off-ladder entry behavior unchanged.

**Tasks panel** (`src/tui/TasksPanel.tsx` + `/tasks` command). `Ctrl+B` mid-turn = `background` op
(backgrounds the running foreground shell, probe 39); `Ctrl+B` when idle, or `/tasks` anytime, opens
the panel: one row per task from the `tasks_changed` snapshot — shells, subagents, workflow tasks are
one stream — showing id, type, description, status; ↑/↓ select, `k` or `x` → `stop_task`, Esc close.
Status bar replaces the `⚙ subagent running` boolean with a live count (`⚙ 2 bg`), and shows
`mode <m>` from the pushed state event (real host mode at last).

**Transcript notices.** `task_started` / `task_notification` frames render as one-line notices
(`⚙ task started: <description>` / `✓ task done: <summary>` / `✗ task failed: …`), honoring
`skip_transcript`. Dialog titles carry attribution when known: `Subagent (code-reviewer) asks:`.

## Data flow (the three that matter)

1. **Detached question → attach → answer** (the doperpowers flagship): `ccx --bg -n worker "…"` →
   model calls `AskUserQuestion` (always-ask) → gate parks `kind:"question"` → roster `blocked`,
   `waitingFor:"question:AskUserQuestion"` → `ccx attach worker` replays transcript + QuestionDialog
   → answer → `answer` op `{kind:"question", answers}` → `allow` + `updatedInput` → tool_result
   carries the choices → turn resumes → `done`.
2. **Plan loop, foreground:** Tab to `plan` → model plans (edits blocked natively) → `ExitPlanMode`
   parks `kind:"plan"` → PlanDialog → `3` + feedback → `deny(message)` → model revises & re-calls →
   `1` → `allow`; CLI flips mode + emits `status`; host layers `setPermissionMode("acceptEdits")` →
   status bar shows `acceptEdits` from the pushed frame → edits run.
3. **Ctrl+B:** long shell running → `Ctrl+B` → `background` op → CLI backgrounds mid-turn →
   `background_tasks_changed` → `tasks_changed` event → status bar `⚙ 1 bg`; `/tasks` → panel → `k`
   → `stop_task` → `task_notification{stopped}` notice.

## Error handling & teardown (the quartet, per kind)

- **Host death with a dialog open** → shared answer channel `.catch`: `✗ answer failed` notice,
  answered-mark rolled back, dialog stays (A2b F1, inherited).
- **Interrupt during any park** → SDK releases the promise, stream throws (probe 63): parked
  decision dropped with `decision_settled(by:"system")`.
- **Teardown / `stop`** → `denyAllForSession` settles every kind; question denies read
  `"No user is available to answer."`.
- **First-answer-wins** across attached clients, settled by the event, never optimistically — per
  kind.
- **Malformed answer** (kind mismatch for the toolUseID, unknown question text, unknown taskId) →
  op error reply; the park stays.
- **Empty rejection feedback** → the default rejection message.
- The teardown-quartet test suite (this project's recurring bug class) is **parameterized over all
  three kinds** and written before the wire lands.

## Acceptance (observable behavior)

Keyless halves always run; live halves gate on `CC-to-SDK/.env` credentials as usual.

1. **Question round-trip, detached (live, scripted pty):** a `--bg` worker prompted to ask
   red-vs-blue parks (`state:"blocked"`, `waitingFor` starts `question:`); `ccx attach` renders the
   question dialog with both options; choosing `blue` resumes the turn; the model's final output
   contains the choice; roster reaches `done`. Ctrl+Z before answering detaches with the park intact
   (same as A2b acceptance 6).
2. **Plan loop (live):** a plan-mode session's `ExitPlanMode` parks; reject-with-feedback makes the
   model revise and re-call (two parks observed); approve-accept-edits flips the visible mode to
   `acceptEdits` (status bar, from the pushed state event) and a subsequent edit runs with no
   dialog.
3. **Background shell (live, scripted pty):** Ctrl+B during a long-running Bash backgrounds it
   mid-turn (turn continues); `/tasks` lists it; `k` stops it; the stopped notice renders.
4. **Attribution (live):** a session that dispatches a subagent whose tool call parks a permission
   shows `Subagent (<type>)` in the dialog title — or, if the probe-carried premise fails (nested
   calls don't consult), the recorded fallback: task started/done notices and panel rows present,
   dialog attribution dropped and the spec's premise note updated.
5. **Keyless:** unit + quartet suites green; `answer` op kind-mismatch rejected with the park
   intact; ladder cycles through `plan`; `/tasks` opens on an idle keyless host with an empty list.
6. **Docs close-out:** `tui-ux.md` gains a control-plane axis scoring these rows; `coverage.md` and
   the spine spec's Goal-boundary table updated; parent-spec Outcomes cross-linked.

## Non-goals

- Per-subagent drill-in transcript view (panel + attribution only, this round).
- AFK auto-answer / default-option fallback in any mode.
- MCP elicitation dialogs (still effectively dead headless, probe 43).
- Fan-out backpressure (still deferred on observed stall, per the spine Decision Log).
- Daemon-library decision surfaces (stack is retiring); swarm broker unification.
- Matching CC's side-by-side question-tab layout.

## Decision Log

| Decision | Rejected alternative | Why |
|---|---|---|
| **One decision park with a `kind` union** (chosen) | Three parallel special-cases (separate ops/stores/dialog plumbing per surface) | The park lifecycle is where A2a's and A2b's worst defects lived; three parks = three teardown/liveness seams. One union means the quartet tests and the F1 `.catch` fix cover every kind by construction. A fourth kind later is additive. |
| Park indefinitely, never auto-answer | Broker-side auto-policies (first option, auto-approve, AFK timeout) | Answering on the user's behalf is the silent loss Goal B exists to kill, and it breaks the doperpowers attach-and-answer flagship. The SDK's `afkTimeoutMs` shows CC has a fallback; fidelity here is "the question waits for you". |
| Full attach reach for all surfaces | Foreground-only first, wire later | A detached worker stalling on a question is the motivating failure; C6 needs the attach path; the park infrastructure already exists — this only generalizes its payload. |
| Full CC plan shape: `plan` on the Tab ladder + three-choice dialog | Dialog only, `plan` reachable by flag/command | CC muscle memory; the ladder change is one array entry; probe 66 proved the CLI does the heavy lifting (mode flip). |
| Subagent scope: attribution + shared tasks panel | Minimal (attribution only) / full navigable per-subagent view | Minimal leaves shells and subagents as disconnected half-surfaces; the full view roughly doubles the TUI work for fidelity CC itself doesn't center. One panel for all background work matches CC. |
| Sequential question flow | CC's side-by-side question tabs | Keyboard-identical outcomes at a fraction of the layout work; recorded as an accepted divergence. |
| Clean wire rename (`decision`), no compat shims | Versioned/back-compat wire | One binary owns both ends; A2b set the precedent. |
| Attribution by host-side correlation map | Extending the gate/SDK seam to carry parentage | The SDK's `canUseTool` simply doesn't carry it; the host already sees every frame. Best-effort stamp, miss = no attribution, never a block. |

## Surprises & Discoveries

- **Probe 65:** `AskUserQuestion` is the one always-ask tool — it consults `canUseTool` with *no*
  ask rules, the sole exception to probe 58's "ask-routed only" doctrine. Today's gate therefore
  auto-allows it with no answers on every headless run — the silent loss was live-confirmed, not
  inferred.
- **Probe 66:** the CLI flips `permissionMode` itself after plan approval and announces it with a
  `system`/`status` frame. Two dividends: our dialog only layers the optional `acceptEdits`
  upgrade, and the status frame is a native push channel for the mode — the cure for A2b's
  "status bar starts at `default`" quirk, which this spec closes as a side effect.
- (During implementation — append here.)

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-07-28 — initial spec from the Goal B brainstorm (probes 65/66 run live first; approach,
  scope, plan-UX, attach-reach, and subagent-depth decisions taken with the owner in-session).
