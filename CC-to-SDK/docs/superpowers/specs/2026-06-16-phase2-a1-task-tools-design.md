# Phase 2 · A1 — Task Tools — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** 2 (Modes & advanced), sub-project **A1** of the CC→SDK program. Follows Phase 1 (headless core).
**Working dir:** `CC-to-SDK/harness/` (extends the Phase-1 package)
**Inputs:** parity map area `15-tool-tasks` (`docs/parity/data`), roadmap Phase 2.

---

## 1. Goal

Give the model a **durable task list** through the four `Task*` tools CC exposes but the Agent SDK does
not: `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`. These are delivered as an **in-process MCP
server** (`createSdkMcpServer` + `tool()`) backed by a file-backed task store with auto-incrementing
IDs, a status state-machine, a dependency DAG, and an `owner`/claim primitive. A1 is the foundation the
A2 swarm builds task-coordination on.

## 2. Premise & scope (from the parity map)

The SDK exposes Task* *messages/hooks* (`SDKTaskStarted/Updated/Notification`, `backgroundTasks()`,
`stopTask()`, `TaskCreated`/`TaskCompleted` hook events) for its **runtime** background tasks — but
**no model-facing task-CRUD tools and no durable store**. A1 builds that store + tool family.

**In scope (the A1 build rows):** 15.1 `TaskCreate`, 15.2 `TaskUpdate`, 15.3 `TaskGet`/`TaskList`,
15.9 dependency DAG (`blocks`/`blockedBy`), and the **store-level half** of 15.10 ownership/claim (the
`owner` field + claim-on-`in_progress` + claim refusal when blockers are unresolved).

**Out of scope (deferred), with reasons:**
- **15.10 mailbox-notify** — notifying an assignee over the swarm mailbox needs A2's transport, which
  does not exist yet. A1 ships an `onOwnerChange` **seam**; A2 attaches the notification.
- **15.4 `TodoWrite`** — CC disables the V1 in-memory checklist by default in favor of Task* V2. YAGNI.
- **15.11 full `TaskCreated`/`TaskCompleted` hook-event dispatch** — A1 ships callback seams, not the
  full user-hook dispatch + blocking-error rollback. (Promotable later.)
- **15.12 verification nudge** (P3, internal-flag-gated) and **15.13 dream task** (🚫 non-goal).
- **Multi-process locking** — the chosen concurrency model is in-process (see §5).

**Already provided (Phase 1 / SDK, not rebuilt here):** 15.5 `TaskStop`→`stopTask()`, 15.6 `TaskOutput`
(deprecated; Read the output file), 15.7/15.8 runtime task registry + `run_in_background`.

## 3. Architecture

The store lives **in the harness process**; the tool handlers close over it. One store object is
shared by the model's tool calls and (later) A2's in-process swarm agents.

```
HarnessConfig.taskTools ──► createHarness (stateful shell)
                               │ build TaskStore + Task MCP server
                               │ merge {"cc-tasks": server} into options.mcpServers
                               │ expose harness.tasks (the store)
                               ▼
        TaskStore ◄── tool handlers (TaskCreate/Update/Get/List)
   (file-backed · atomic temp+rename · async mutex · CAS claim · DAG)
```

`resolveOptions` stays **pure**; the stateful store/server wiring happens in `createHarness` and
post-merges into the resolved `options.mcpServers`.

## 4. Module structure (small, single-responsibility files, under `CC-to-SDK/harness/`)

| File | Responsibility |
|---|---|
| `src/tasks/types.ts` | `Task`, `TaskStatus`, zod input shapes, `TaskStoreOptions` |
| `src/tasks/store.ts` | `TaskStore`: load/save (atomic), async mutex, create/update/get/list, claim CAS, dependency DAG + cycle check, status machine, `onOwnerChange` seam |
| `src/tasks/server.ts` | `createTaskMcpServer(store, agentName)` — the `createSdkMcpServer` with 4 `tool()`s |
| `src/tasks/index.ts` | public exports (`TaskStore`, `createTaskMcpServer`, types) |
| `src/config/types.ts` (modify) | add `taskTools?` to `HarnessConfig` |
| `src/harness.ts` (modify) | build/wire store+server when enabled; expose `harness.tasks` |
| `src/index.ts` (modify) | re-export the task public API |

## 5. Task schema & store semantics

```ts
type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";
interface Task {
  id: number;            // auto-incrementing, from the store high-water mark (nextId)
  subject: string;
  description?: string;
  activeForm?: string;   // present-continuous label shown while in_progress (CC convention)
  status: TaskStatus;
  owner?: string;        // agent name; set on claim
  blocks: number[];      // ids this task blocks
  blockedBy: number[];   // ids blocking this task
  metadata?: Record<string, unknown>;
  createdAt: string;     // ISO timestamp (stamped by the store)
  updatedAt: string;     // ISO timestamp (stamped by the store)
}
```

**Persistence.** The store file is `{ nextId: number, tasks: Task[] }`. Every mutation runs under an
**async mutex** (serialized read-modify-write) and is written **atomically**: serialize to a temp file
in the same directory, then `rename()` over the target (crash-safe, no torn writes). On load, a missing
file yields an empty store (`{ nextId: 1, tasks: [] }`). Default path
`<cwd>/.cc-harness/tasks/<listId>.json` — `cwd`, `dir`, and `listId` (default `"default"`) configurable.

**Status machine.** `pending → in_progress → completed`; `→ deleted` allowed from any live state.
Backward transitions (e.g. `completed → pending`) are rejected with an error result. Re-setting the
same status is a no-op success. A `deleted` task is terminal: any further `TaskUpdate` on it is
rejected.

**Claim (CAS).** Transitioning a task to `in_progress` sets `owner = caller agent` (the configured
`agentName`, default `"main"`). The claim is **refused** (error result, no mutation) if any task in
`blockedBy` is not `completed`, or if the task is already owned by a *different* agent. This is the
swarm-claim primitive A2 reuses. A direct `owner` change via `TaskUpdate` (without an `in_progress`
transition) is treated as an explicit **reassignment** — allowed, and it also fires `onOwnerChange`;
the claim-refusal rules above apply specifically to the `in_progress` transition.

**Dependencies.** `blocks` and `blockedBy` are kept mutually consistent: adding `blockedBy: [X]` to
task T also adds T to `X.blocks`. Adding a dependency that would create a **cycle** is rejected
(error result). `TaskList` reports only *unresolved* blockers — `completed` blockers are filtered out
of the displayed `blockedBy` — matching CC.

**A2 seam.** `TaskStore` accepts an optional `onOwnerChange(task, prevOwner)` callback (no-op by
default). A2's swarm sets it to push mailbox notifications without modifying A1.

## 6. The four MCP tools

Delivered via the SDK's `tool(name, description, zodRawShape, handler)` (the SDK bundles `zod/v4`,
matching the package's `zod ^4`) wrapped in `createSdkMcpServer({ name: "cc-tasks", tools: [...] })`.
Each handler returns an MCP `CallToolResult` — `{ content: [{ type: "text", text }], isError? }`.

| Tool | Input shape | Behavior |
|---|---|---|
| `TaskCreate` | `subject: string`, `description?`, `activeForm?`, `blockedBy?: number[]`, `metadata?` | Adds a `pending` task; validates referenced `blockedBy` ids exist (a brand-new task cannot close a cycle); returns the created task (incl. `id`). |
| `TaskUpdate` | `id: number`, `subject?`, `description?`, `activeForm?`, `status?`, `owner?`, `blockedBy?`, `metadata?` | Applies field changes; validates the status transition; claims for the caller on `in_progress`; returns the updated task, or an `isError` result on bad transition / claim-refused / unknown id / cycle. |
| `TaskGet` | `id: number` | Returns the full task, or a not-found `isError` result. |
| `TaskList` | `status?: TaskStatus`, `owner?: string` | Returns non-`deleted` tasks (optionally filtered) projected to `{ id, subject, status, owner, blockedBy(unresolved) }`. |

**Error semantics.** All domain failures are returned as `isError` `CallToolResult`s (not thrown) so
the model can read and react to them. Unexpected internal failures (e.g. disk I/O) propagate.

## 7. Integration surface

```ts
// HarnessConfig addition
taskTools?: boolean | { dir?: string; listId?: string; agentName?: string };
```

When truthy, `createHarness`:
1. Builds a `TaskStore` from `{ cwd: config.cwd, dir, listId }`.
2. Builds the MCP server via `createTaskMcpServer(store, agentName)`.
3. Merges it into the resolved `options.mcpServers` under key `"cc-tasks"` (preserving any user servers).
4. Exposes `harness.tasks: TaskStore | undefined` on the returned `Harness` for programmatic
   inspection and the A2 `onOwnerChange` seam.

`resolveOptions(config)` is unchanged in purity; the merge happens in `createHarness` after it runs.

## 8. Verification

`harness/test/` (vitest), two tiers, reusing the Phase-1 infra:

- **Unit (no network):**
  - `TaskStore`: create/get/update/list; valid + invalid status transitions; dependency add + bidirectional
    sync; cycle rejection; claim CAS (two claimers → exactly one wins); `blockedBy` unresolved-only
    filtering in `list`; atomic persistence (write → reload from disk reflects state); serialized
    concurrent updates (fire N concurrent `update`s, assert a consistent final store and correct `nextId`).
  - Tool handlers: invoke each handler directly with args; assert the `CallToolResult` shape, the store
    mutation, and `isError` on bad transition / claim-refused / unknown id / cycle.
  - Integration wiring: `createHarness({ taskTools: true })` merges `"cc-tasks"` into `options.mcpServers`
    and exposes `harness.tasks`.
- **Live (network, `ANTHROPIC_API_KEY`, auto-skips without it):** enable `taskTools`, prompt the model to
  "create two tasks, the second blocked by the first, then list the tasks" → assert the store reflects
  two tasks with the dependency and that `Task*` `tool_use` was observed. Extends Phase-0 probe 02.

## 9. Non-goals (A1)

Mailbox-notify on owner change (seam only — A2), `TodoWrite`, the verification-agent nudge, full
`TaskCreated`/`TaskCompleted` user-hook dispatch with blocking-error rollback, multi-process file
locking, and the auto-dream consolidation task.

## 10. Success criteria

- The four `Task*` tools are callable by the model through the in-process MCP server, backed by a
  durable file-backed store that survives reload.
- Status machine, dependency DAG (+ cycle rejection), and `owner`/claim CAS behave as specified and are
  unit-tested without the network.
- `createHarness({ taskTools: true })` auto-registers the server and exposes `harness.tasks`.
- The live test shows the model creating dependent tasks and listing them end-to-end.
- `tsc --noEmit` clean; `vitest` green; no secret committed.
- A2 can consume `harness.tasks` + the `onOwnerChange` seam as the task-coordination substrate without
  modifying A1.
