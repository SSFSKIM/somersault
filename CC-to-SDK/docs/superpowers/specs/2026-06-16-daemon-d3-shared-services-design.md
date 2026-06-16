# Daemon D3 — Shared In-Process Services — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** Genuine-gap cluster **33-mode-daemon**, sub-project **D3** (builds on D1 host + D2 restart).
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity row 33.4 (in-daemon hosted services: API/MCP/LSP multiplexing), reinterpreted for the
in-process pool; the D1/D2 `DaemonSupervisor`; the proven swarm pattern (`createTaskMcpServer` + a shared
`TaskStore`).

> **Reinterpretation.** 33.4's "service multiplexing" lands as **shared in-process MCP services**: the
> daemon hands every session access to common state (headline: a shared task store) so sessions on one
> daemon collaborate. Multi-process service hosting and LSP/API multiplexing stay out of scope.

---

## 1. Goal

Let sessions hosted by one daemon collaborate through shared state — concretely, a **shared task store**:
any session can create/read the same tasks via a `cc-tasks` MCP server, so work done in session A is visible
to session B.

## 2. Premise & scope — verified against the live SDK

A throwaway concurrency spike settled the architecture before this design hardened (the A1/cluster-30
lesson): **a single `createSdkMcpServer` instance CANNOT be safely shared across concurrent `query()`
sessions.** With one shared instance and two concurrent sessions, only one reached the tool (the other
"searched the deferred tool registry" and failed); the shared counter ended at 1, not the expected 11. A
*sequential* reuse of the instance worked, which is the trap — a daemon runs sessions concurrently.

Therefore D3 shares **state, not the server**: each session gets a **fresh** MCP server instance over a
**shared store** (exactly the swarm's live-proven shape — concurrent teammates, each its own server, one
shared store).

**In scope (D3):** a per-session MCP-server **factory** seam on the supervisor (merged into each session's
options at spawn *and* restart), plus a built-in **shared task store** convenience.
**Deferred / out of scope:** sharing a single server instance (proven broken); generic shared-anything
beyond the per-session factory; LSP/API service hosting; exposing shared services over the client IPC
(this is daemon-construction config, not a runtime op).
**Non-goals:** cross-daemon shared state; per-session service isolation overrides.

## 3. Architecture — per-session server, shared store

```
DaemonSupervisor (sharedTasks set)
  ├─ tasks: TaskStore            ← ONE shared store (the shared state)
  └─ sessionServers(id) = () => ({ "cc-tasks": createTaskMcpServer(this.tasks) })   ← FRESH server per call

makeSession(id, cfg):
   options.mcpServers = { ...sessionServers(id) }      ← fresh cc-tasks instance for THIS session
   new DaemonSession(id, { query }, options, now)
   (restart reuses makeSession → a recovered session keeps its shared services)

session A: cc-tasks TaskCreate "SHARED_OK"  ─►  supervisor.tasks
session B: cc-tasks TaskList                ─►  supervisor.tasks  ─► sees "SHARED_OK"
```

A generic caller can pass any `sessionServers` factory; `sharedTasks` is the canonical built-in that wires
the task-store factory automatically.

## 4. Modules (extend D1/D2 files; reuse `tasks/`)

| File | Change |
|---|---|
| `src/daemon/types.ts` *(mod)* | `DaemonOptions += sessionServers?: (sessionId: string) => Record<string, unknown>`; `sharedTasks?: boolean \| { dir?: string; listId?: string }` |
| `src/daemon/supervisor.ts` *(mod)* | hold an optional shared `tasks?: TaskStore` (public, for inspection); in the constructor, if `sharedTasks` is set, create the store and build a default `sessionServers` factory returning `{ "cc-tasks": createTaskMcpServer(this.tasks) }`; in `makeSession`, merge `this.sessionServers?.(id)` into `options.mcpServers` |

No new files. `DaemonSession`/`server.ts`/`client.ts`/CLI are unchanged. `TaskStore` and
`createTaskMcpServer` are reused verbatim from `src/tasks/`.

## 5. The factory seam

`makeSession(id, cfg)` builds the per-session options. Today it is `cfg.model ? { model } : {}`. D3 adds:

```
const base = cfg.model ? { model: cfg.model } : {};
const servers = this.sessionServers?.(id);          // fresh instances for THIS session
const options = servers ? { ...base, mcpServers: servers } : base;
```

Because `makeSession` is the single construction point used by both `spawn` and `restart`, a restarted
session automatically gets a fresh set of shared-service servers — D3 composes with D2 for free.

`sharedTasks` resolution in the constructor:

```
if (opts.sharedTasks) {
  const t = opts.sharedTasks === true ? {} : opts.sharedTasks;
  this.tasks = new TaskStore({ dir: t.dir, listId: t.listId });   // TaskStore defaults the rest
  this.sessionServers = opts.sessionServers ?? (() => ({ "cc-tasks": createTaskMcpServer(this.tasks!) }));
} else {
  this.sessionServers = opts.sessionServers;
}
```

If both `sharedTasks` and an explicit `sessionServers` are given, the explicit factory wins (the caller is
in control); `this.tasks` is still created so it can be inspected.

## 6. Error handling

- `sessionServers` is optional; when unset, `makeSession` behaves exactly as D1/D2 (no `mcpServers` key).
- A throwing factory would surface at `spawn`/`restart` time; the factory is daemon-author code (trusted),
  so no special handling beyond the existing `spawn` error path.
- The shared `TaskStore` is the same store the swarm uses concurrently; its file writes are its own concern
  (unchanged here).

## 7. Verification

- **Unit (no network, DI fake query capturing options):**
  - a `sessionServers` factory is invoked per session and merged into that session's `options.mcpServers`
    (capture options from the fake query; assert the server map is present).
  - a **restarted** session also receives the factory's servers (compose with D2: a dying session restarts;
    assert the new session's captured options include `mcpServers`).
  - `sharedTasks: true` creates `supervisor.tasks` and the default factory yields a `cc-tasks` server; two
    spawned sessions both get a `cc-tasks` server, and both wrap the **same** `supervisor.tasks` (assert a
    task written directly to `supervisor.tasks` is listable — proving one shared store).
  - an explicit `sessionServers` overrides the `sharedTasks` default factory.
- **Live (one test, gated on `ANTHROPIC_API_KEY`):** start a daemon with `sharedTasks: true`, spawn two
  sessions; `submit` to session A "create a task subject SHARED_OK via cc-tasks TaskCreate", then `submit`
  to session B "list cc-tasks tasks and report the subjects"; assert B's streamed result mentions
  `SHARED_OK`. Proves cross-session collaboration through shared in-process state, end-to-end, real SDK.

## 8. Success criteria

- A daemon configured with `sharedTasks` gives every session (including restarted ones) a `cc-tasks` server
  over one shared `TaskStore`; a task created by one session is visible to another.
- The generic `sessionServers` factory injects per-session MCP servers into every session's options.
- Each session gets a **fresh** server instance (never a shared instance) — the concurrency-safe shape the
  spike forced.
- D1/D2 behavior is unchanged when neither option is set.
- `tsc --noEmit` clean; `vitest` green (all prior daemon + new shared-service tests); no secret committed;
  the concurrency finding (shared instance broken) is documented.
```
