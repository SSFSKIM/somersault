# Parity Correction — native tool catalog re-baseline (2026-06-16)

**Trigger:** a review question — "did you verify the SDK really lacks `TaskCreate`/`TaskUpdate`?" — exposed a
verification-method error in the Phase-0 parity map. This note records the finding, the evidence, the
affected rows, and the corrective actions.

## 1. The methodology error

The parity map answered "can the model do X?" by checking **`sdk.d.ts`** — the SDK's hand-written
*programmatic API* typings (`query`, `Options`, `SDKTask*` messages, hooks). That file documents what
*your code* can call. It does **not** list the **model's built-in tools**. The model's tool catalog is a
separate generated file, **`sdk-tools.d.ts`**, plus the actual tool list a running `query()` reports.

Consequence: any verdict of the form "CC has tool X, the SDK lacks it → 🏗 build" is unreliable wherever
it was decided from `sdk.d.ts` alone. (Some areas — e.g. Bash, cluster 10 — *did* cite `sdk-tools.d.ts`
and are fine. The error is inconsistent, not total.)

## 2. Evidence

**Catalog.** `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` declares 37 native tool input
schemas, including `TaskCreate/TaskGet/TaskList/TaskUpdate/TaskOutput/TaskStop`, `TodoWrite`, `Agent`,
`CronCreate/Delete/List`, `EnterWorktree/ExitWorktree`, `EnterPlanMode/ExitPlanMode`, `Monitor`,
`RemoteTrigger`, `ScheduleWakeup`, `Workflow`, `REPL`, `Artifact`, `Projects`, `PushNotification`,
`AskUserQuestion`. `TaskUpdateInput` carries `status` (incl. `deleted`), `addBlocks`/`addBlockedBy`
(the DAG), and `owner` (claim) — the exact A1 feature set.

**Runtime (enabled by default).** A bare `query({ prompt, options: {} })` reports these tools in its
`system/init` `tools` array (no config, no preset needed):
`Task, TaskCreate, TaskGet, TaskList, TaskUpdate, TaskOutput, TaskStop, CronCreate/Delete/List,
EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, Monitor, PushNotification, ScheduleWakeup,
Workflow, AskUserQuestion, WebFetch, WebSearch, NotebookEdit, …`.

**Native task store is session-scoped (decisive for the swarm).** A native `TaskCreate` persists to
`~/.claude/tasks/<session_id>/<id>.json` (with a `.lock`), keyed by **session_id**. A second `query()`
in the **same cwd** (new session_id) ran `TaskList` → "No tasks found". So native tasks are **not shared
across `query()` sessions**. The on-disk shape (`{id, subject, description, status, blocks, blockedBy}`)
is nearly identical to A1's.

## 3. Confirmed false premises (re-verdict needed)

| row | feature | native tool | note |
|---|---|---|---|
| 15.1 | Durable task list (TaskCreate) | `TaskCreate` | native, default-on |
| 15.2 | Task update / status (TaskUpdate) | `TaskUpdate` | native; `status` incl. `deleted` |
| 15.3 | Task get / list (TaskGet/TaskList) | `TaskGet`/`TaskList` | native |
| 15.4 | Session todo checklist (TodoWrite) | `TodoWrite` | native |
| 15.9 | Task dependencies (blocks/blockedBy) | `TaskUpdate.addBlocks/addBlockedBy` | native |
| 19.90 | ScheduleWakeup tool | `ScheduleWakeup` | native, default-on |
| 32.5 | Cron / scheduled triggers | `CronCreate/Delete/List` | native, default-on |
| 42.90 (partial) | "ultracode" Workflow opt-in | `Workflow` | tool native; the keyword gating is harness behavior |
| 37a.4 / 37a.14 (partial) | AskUserQuestion / Plan-mode | `AskUserQuestion`, `EnterPlanMode/ExitPlanMode` | tools native; the *UI* is the to-build part |

This sweep matched only rows that name a tool, so it is a **lower bound**. A full re-audit of all 123
`build` rows against the live tool list is the remaining re-baseline work (§5).

## 4. Impact on A1 / A2 / A2b (the work already shipped)

- **A1 model-facing tools (`cc-tasks` MCP server): redundant for solo use.** The model already has native
  `Task*`. Enabling `taskTools` alone gives the model *two* task systems.
- **A1 file-backed store: justified — keep it.** Native tasks are session-scoped; a swarm of peer
  `query()` sessions cannot coordinate through them. A1's single shared file is the correct cross-session
  substrate. **A1's real deliverable is the store, not the tools.**
- **A2 / A2b swarm orchestration: sound.** No native `TeamCreate`/`SendMessage`/`spawnTeammate`; native
  `Agent` spawns in-process subagents, not cross-session peers. The cross-session shared task list is a
  real need A2 fills.
- **New correction required in A2 (split-brain risk):** swarm sessions currently expose **both** native
  `Task*` (session-local) **and** `mcp__cc-tasks__*` (shared). A teammate could call native `TaskCreate`
  and silently create a task invisible to the team. **Fix:** add the native Task tools to `disallowedTools`
  on coordinator + teammate sessions so the shared `cc-tasks` tools are authoritative. (Folds into A2b or
  a small A2 patch.)
- **Repositioning:** document `taskTools` as "the swarm's cross-session shared task store / programmatic
  task access," not "Task tools the SDK lacks." Solo callers should prefer the native tools.

## 5. Corrective actions

1. **Re-verdict** the rows in §3 in the parity data (build → provided / configurable, citing `sdk-tools.d.ts`
   + the runtime probe).
2. **A2 patch:** disable native `Task*` on swarm sessions (`disallowedTools`) to make `cc-tasks` authoritative.
3. **Full re-audit (remaining):** check every `build` row's capability against the live `query()` tool list
   and `sdk-tools.d.ts`, not `sdk.d.ts`. Best run as a fan-out (one reviewer per cluster).
4. **Method fix (durable):** for "can the model do X?" questions, the source of truth is `sdk-tools.d.ts`
   + a runtime tool-list probe. Reserve `sdk.d.ts` for "can my code call X?" (programmatic API) questions.

## 6. What was *not* wasted (superseded — see §7)

A1's store is real (native task store is session-scoped). But the claim that A2's teammate runtime and the
A2b handshake design are "not provided natively" turned out to be **false** — see §7.

## 7. Full re-audit + the experimental teammate system (the bigger finding)

A fan-out re-audit of all 118 remaining `build` rows (8 reviewers, one per cluster-group) against
`sdk-tools.d.ts` + `sdk.d.ts` + runtime probes found **17 confirmed false-premises, 18 needing live
probes, 83 legit-build**. The headline: **cluster 30 (the whole swarm) is native** — and a live probe
confirmed it works headlessly, with a critical caveat.

**Native teammate system — confirmed via type defs + live probe:**
- `Agent` tool input (sdk-tools.d.ts:431-445): `name` ("addressable via `SendMessage({to: name})`"),
  `mode` (incl. `'plan'` = require plan approval, `'bubble'`), `isolation: 'worktree'|'remote'`;
  `team_name` deprecated → "the session has a single implicit team".
- `Options.teammateMode: 'auto'|'tmux'|'in-process'` (sdk.d.ts:6062); `isolatePeerMachines` (6070).
- `SDKMessageOrigin.kind: 'peer'|'coordinator'|'channel'` (sdk.d.ts:3700-3714).
- Plan-approval handshake: `ExitPlanModeOutput.awaitingLeaderApproval` + `requestId` (sdk-tools.d.ts:2663).
- Graceful shutdown: `SDKWorkerShuttingDownMessage` (sdk.d.ts:4261). `TeammateIdle` hook event.

**Live probe (2026-06-16):** with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` + `teammateMode:'in-process'`,
a headless `query()` exposed `SendMessage` in its init tools, and the model spawned `Agent(name=helper)`
then called `SendMessage` — so the native peer-teammate system **is real and headless-reachable**. Two
caveats: (1) it is **experimental and flag-gated** (off by default; gate in `assistant.mjs`); (2) the
**shared-task-state test was negative/inconclusive** — the teammate's task was not visible to the parent's
`TaskList` (native tasks stay session-scoped; even subagents get their own `~/.claude/tasks/<session_id>/`).

**Re-verdicted this round (build → provided/configurable, snapshot post-feb):** cluster 30 (30.1-30.5,
30.7 → `configurable`, native-but-experimental), 15.10/15.12 (`provided`), 14.20 fork, 31.2/31.3
(ScheduleWakeup/Monitor), 32.4 channels, 32.5 Cron, 32.8 PushNotification, 10.5, 11.17, 12.13, 28.6,
19.90. Build rows: 118 → 99.

**Still open — 18 needs-live-probe rows** (cataloged for a follow-up): 31.5, 32.3, 35.2, 14.23, 09.13,
09.21, 09.34, 22.14, 23.15, 28.13, 29.8, 06.9, 07.6, 19.91, 40.5, 40.6 (+ 30.2/30.5 now resolved via the
live probe).

## 8. Disposition decision (2026-06-16)

Decision: **keep A2; continue A2b.** The native teammate system overlaps A2/A2b heavily but is
experimental, flag-gated, off-by-default, and did not demonstrably share task state — not production-ready.
The harness keeps a controlled, non-experimental, fully-tested swarm; A2b still adds the permission bridge
+ shutdown handshake A2 lacks. Concrete consequences:
- **A1 model-facing `cc-tasks` tools: redundant** (native `Task*` is default-on). Keep the file-backed
  **store** (the swarm's shared substrate); native tasks are session-scoped, not shared across peers. The
  swarm split-brain patch (disable native `Task*` on swarm sessions) makes the shared store authoritative.
- **A2: kept** as the non-experimental swarm; documented as overlapping the experimental native system.
- **A2b: proceeds.**
- **The 83 legit-build rows** (UI/Ink/modes/vim/voice/daemon) remain the harness's genuinely-unique value
  and the right long-term focus.
