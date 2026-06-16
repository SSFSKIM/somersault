# Daemon D3 — Shared In-Process Services — Design

**Date:** 2026-06-16
**Status:** Approved (design); spec reviewed → implementation plan
**Phase:** Genuine-gap cluster **33-mode-daemon**, sub-project **D3** (builds on D1 host + D2 restart).
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity row 33.4 (in-daemon hosted services: API/MCP/LSP multiplexing), reinterpreted for the
in-process pool; the D1/D2 `DaemonSupervisor`; the proven swarm pattern (`createTaskMcpServer` + a shared
`TaskStore` + native-task-tool suppression).

> **Reinterpretation.** 33.4's "service multiplexing" lands as **shared in-process MCP services**: the
> daemon hands every session access to common state (headline: a shared task store) so sessions on one
> daemon collaborate. Multi-process service hosting and LSP/API multiplexing stay out of scope.

---

## 1. Goal

Let sessions hosted by one daemon collaborate through shared state — concretely, a **shared task store**:
any session can create/read the same tasks via a `cc-tasks` MCP server, so work done in session A is visible
to session B.

## 2. Premise & scope — verified against the live SDK

Two throwaway spikes settled the architecture before this design hardened (the A1/cluster-30 lesson):

1. **Concurrency.** A single `createSdkMcpServer` instance CANNOT be safely shared across concurrent
   `query()` sessions. With one shared instance and two concurrent sessions, only one reached the tool (the
   other "searched the deferred tool registry" and failed); the shared counter ended at 1, not the expected
   11. *Sequential* reuse worked — the trap, since a daemon runs sessions concurrently. → D3 shares **state,
   not the server**: each session gets a **fresh** MCP server instance over a **shared store** (the swarm's
   live-proven shape).

2. **Tool visibility & permission.** Injecting `mcpServers` alone is **necessary but not sufficient** for a
   session to actually use the shared store. A second spike against the real SDK found:
   - **Native tools shadow MCP tools by name.** The SDK ships a built-in `TaskCreate`; with both it and
     `mcp__cc-tasks__TaskCreate` present, the model calls the **native** one — the turn *reports success*
     while the shared store stays empty. Fix: `disallowedTools: NATIVE_TASK_TOOLS` (exactly the swarm's
     guard) so the cc-tasks tools are authoritative.
   - **In-process MCP tools are not auto-permitted.** Under `permissionMode:"default"` with no `canUseTool`
     (the daemon wires none), `mcp__cc-tasks__TaskCreate` is **blocked** ("needs your permission"). Listing
     the four `mcp__cc-tasks__*` names in **`allowedTools`** auto-approves them and the call lands in the
     shared store (verified). `allowedTools` is an auto-approve list, not a hard restriction — other tools
     keep the session's existing posture — so this is the surgical choice over the blunt
     `permissionMode:"bypassPermissions"` (which also works but auto-approves everything).

   → The `sharedTasks` built-in must wire all three together: a **fresh** `cc-tasks` server, **native task
   tools off**, and the **cc-tasks tools allowlisted**. Therefore the per-session seam carries a partial
   **options object** (mcpServers + disallowedTools + allowedTools), not just a server map.

**In scope (D3):** a per-session **session-options factory** seam on the supervisor (merged into each
session's options at spawn *and* restart), plus a built-in **shared task store** convenience that wires the
fresh-server / native-off / cc-tasks-allowlisted trio.
**Deferred / out of scope:** sharing a single server instance (proven broken); a per-session permission
broker / `canUseTool` for arbitrary tools (the daemon still services no general tool prompts — pre-existing
D1/D2 limitation, unchanged here); LSP/API service hosting; exposing shared services over the client IPC
(this is daemon-construction config, not a runtime op).
**Non-goals:** cross-daemon shared state; per-session service isolation overrides.

## 3. Architecture — per-session options, shared store

```
DaemonSupervisor (sharedTasks set)
  ├─ tasks: TaskStore                      ← ONE shared store (the shared state)
  └─ sessionOptions(id) = () => ({          ← returns a partial options object; FRESH server per call
        mcpServers:      { "cc-tasks": createTaskMcpServer(this.tasks) },   ← fresh instance for THIS session
        disallowedTools: NATIVE_TASK_TOOLS,                                 ← native TaskCreate/… off (cc-tasks authoritative)
        allowedTools:    ["mcp__cc-tasks__TaskCreate","…Update","…Get","…List"], ← auto-approve cc-tasks
     })

makeSession(id, cfg):
   options = { ...(cfg.model ? { model } : {}), ...sessionOptions(id) }   ← merge factory options over base
   new DaemonSession(id, { query }, options, now)
   (restart reuses makeSession → a recovered session keeps its shared services)

session A: cc-tasks TaskCreate "SHARED_OK"  ─►  supervisor.tasks
session B: cc-tasks TaskList                ─►  supervisor.tasks  ─► sees "SHARED_OK"
```

A generic caller can pass any `sessionOptions` factory; `sharedTasks` is the canonical built-in that wires
the task-store trio automatically.

## 4. Modules (extend D1/D2 files; reuse `tasks/` + the swarm's `NATIVE_TASK_TOOLS`)

| File | Change |
|---|---|
| `src/daemon/types.ts` *(mod)* | `DaemonOptions += sessionOptions?: (sessionId: string) => Record<string, unknown>`; `sharedTasks?: boolean \| { dir?: string; listId?: string }` |
| `src/daemon/supervisor.ts` *(mod)* | hold an optional shared `tasks?: TaskStore` (public, for inspection) and a `sessionOptions?` factory; in the constructor, if `sharedTasks` is set, create the store and build a default `sessionOptions` factory returning the cc-tasks trio (server + `disallowedTools: NATIVE_TASK_TOOLS` + `allowedTools` for the four `mcp__cc-tasks__*` names); in `makeSession`, merge `this.sessionOptions?.(id)` over the base `{ model? }` options |

No new files. `DaemonSession`/`server.ts`/`client.ts`/CLI are unchanged. `TaskStore` and
`createTaskMcpServer` are reused verbatim from `src/tasks/`; `NATIVE_TASK_TOOLS` is imported from
`src/swarm/coordinator.js` (already re-exported via `src/swarm/index.js`, and already consumed by
`src/harness.ts`).

## 5. The factory seam

`makeSession(id, cfg)` builds the per-session options. Today it is `cfg.model ? { model } : {}`. D3 adds:

```
const base = cfg.model ? { model: cfg.model } : {};
const extra = this.sessionOptions?.(id);            // fresh servers + tool posture for THIS session
const options = extra ? { ...base, ...extra } : base;
```

The factory's keys win over `base`, but the built-in factory never sets `model`, so spawn-time model
selection is preserved. Because `makeSession` is the single construction point used by both `spawn` and
`restart`, a restarted session automatically gets a fresh set of shared-service servers — D3 composes with
D2 for free.

`sharedTasks` resolution in the constructor:

```
const CC_TASKS_TOOLS = ["TaskCreate", "TaskUpdate", "TaskGet", "TaskList"]
  .map((t) => `mcp__cc-tasks__${t}`);

if (opts.sharedTasks) {
  const t = opts.sharedTasks === true ? {} : opts.sharedTasks;
  this.tasks = new TaskStore({ dir: t.dir, listId: t.listId });   // TaskStore defaults the rest
  this.sessionOptions = opts.sessionOptions ?? (() => ({
    mcpServers: { "cc-tasks": createTaskMcpServer(this.tasks!) },  // FRESH instance per call
    disallowedTools: [...NATIVE_TASK_TOOLS],                       // native task tools off → cc-tasks authoritative
    allowedTools: CC_TASKS_TOOLS,                                  // auto-approve the cc-tasks tools
  }));
} else {
  this.sessionOptions = opts.sessionOptions;
}
```

If both `sharedTasks` and an explicit `sessionOptions` are given, the explicit factory wins (the caller is
in control); `this.tasks` is still created so it can be inspected.

## 6. Error handling

- `sessionOptions` is optional; when unset, `makeSession` behaves exactly as D1/D2 (just `{ model? }`).
- A throwing factory would surface at `spawn`/`restart` time; the factory is daemon-author code (trusted),
  so no special handling beyond the existing `spawn` error path.
- The shared `TaskStore` is the same store the swarm uses concurrently; its file writes are its own concern
  (the store already serializes read-modify-write — unchanged here).

## 7. Verification

- **Unit (no network, DI fake query capturing options):**
  - a `sessionOptions` factory is invoked per session and its keys are merged into that session's `options`
    (capture options from the fake query; assert `mcpServers` is present and `model` from spawn survives).
  - a **restarted** session also receives the factory's options (compose with D2: a dying session restarts;
    assert the new session's captured options include `mcpServers`).
  - `sharedTasks: true` creates `supervisor.tasks` and the default factory yields, for every spawned
    session, captured options containing a `cc-tasks` server, `disallowedTools` ⊇ `NATIVE_TASK_TOOLS`, and
    `allowedTools` = the four `mcp__cc-tasks__*` names; two sessions both wrap the **same**
    `supervisor.tasks` (assert a task written directly to `supervisor.tasks` is listable through it —
    proving one shared store).
  - an explicit `sessionOptions` overrides the `sharedTasks` default factory (its options are used; the
    default trio is not), while `supervisor.tasks` is still created.
- **Live (one test, gated on `ANTHROPIC_API_KEY`):** start a daemon with `sharedTasks: true`, spawn two
  sessions; `submit` to session A "use the TaskCreate tool to create a task subject SHARED_OK", then
  `submit` to session B "call TaskList and report the subjects"; assert B's streamed result mentions
  `SHARED_OK`. Proves cross-session collaboration through shared in-process state, end-to-end, real SDK —
  and exercises the native-off + allowlist wiring the spike proved necessary.

## 8. Success criteria

- A daemon configured with `sharedTasks` gives every session (including restarted ones) a **fresh**
  `cc-tasks` server over one shared `TaskStore`, with native task tools disabled and the cc-tasks tools
  allowlisted; a task created by one session is visible to another.
- The generic `sessionOptions` factory injects per-session options into every session, merged over the
  base `{ model? }` (model preserved).
- Each session gets a **fresh** server instance (never a shared instance) — the concurrency-safe shape the
  spike forced.
- D1/D2 behavior is unchanged when neither option is set.
- `tsc --noEmit` clean; `vitest` green (all prior daemon + new shared-service tests); no secret committed;
  both spike findings (shared instance broken; native-shadow + MCP-permission) are documented.
```