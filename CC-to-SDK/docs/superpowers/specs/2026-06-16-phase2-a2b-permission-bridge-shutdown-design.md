# Phase 2 · A2b — Permission Bridge + Shutdown Handshake — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** 2, sub-project **A2b** of the CC→SDK program. Extends A2 (coordinator/swarm substrate).
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity cluster 30 rows 30.5 (worker→leader permission bridge) + 30.7 (shutdown half); the A2
`SwarmRuntime` + `onPermissionRequest`/`onHandshake` seams.

> **Native overlap (read `docs/parity/CORRECTIONS-2026-06-16-native-tools.md`).** The SDK has a native
> **experimental, flag-gated** teammate system (`Agent.mode:'plan'|'bubble'|…`, `ExitPlanModeOutput.awaitingLeaderApproval`,
> `SDKWorkerShuttingDownMessage`) that overlaps this sub-project. Per the disposition decision, the harness
> keeps a **controlled, non-experimental** swarm; A2b is its permission-bridge + shutdown handshake. Where
> sensible A2b mirrors the native shapes (e.g. the `shutdown` envelope ≈ `worker_shutting_down`).

---

## 1. Goal

Add the **worker→leader permission bridge** (every teammate's tool use decided by a central runtime
broker, with optional escalation to the coordinator) and a **graceful shutdown handshake** (coordinator
requests → teammate finishes current turn → acks → disposed), via a shared **bus-RPC correlation layer**.

## 2. Premise & scope

CC's worker→leader permission RPC and structured handshakes ride a bespoke mailbox; the SDK's `canUseTool`
runs locally per query. A2b centralizes `canUseTool` across all teammate sessions and adds the shutdown
handshake over the A2 bus.

**In scope:** 30.5 permission bridge (full); 30.7 graceful shutdown handshake.
**Deferred to A2c:** 30.7 plan-approval handshake (heaviest — needs plan-mode teammates + ExitPlanMode
interception; the native `ExitPlanModeOutput.awaitingLeaderApproval` shape is the reference).
**Non-goals:** interrupt-based hard kill, per-tool granular rules beyond the allowlist, multi-process.

## 3. Architecture — one new primitive, reused

A **bus-RPC correlation layer**: a request gets an id + a pending promise; the coordinator answers by id;
the promise resolves. The permission bridge is its consumer this cycle; A2c plan-approval reuses it.

```
teammate query.canUseTool(tool,input) ─► PermissionBroker.decide(name,tool,input)
   ├ policy → allow / deny            (immediate PermissionResult)
   └ escalate (opt-in) → RequestRegistry.create(); push {kind:"permission",data:{id,tool,input}}
                          → coordinator inbox; await pending promise
coordinator CheckMessages ─► RespondPermission(id,"allow"|"deny",msg?) ─► registry.resolve(id) ─► PermissionResult

coordinator ShutdownTeammate(name) ─► runtime.requestShutdown ─► finish current turn (dispose) ─►
   emit {kind:"shutdown"} → coordinator inbox ─► unregister.   (teammate query emitting
   worker_shutting_down → readLoop emits {kind:"shutdown"} for unsolicited host shutdowns.)
```

## 4. Modules (extend `src/swarm/`, mirroring A2)

| File | Change |
|---|---|
| `src/swarm/requests.ts` *(new)* | `RequestRegistry`: `create()→{id,promise}`, `resolve(id,result)→bool`, unknown-id → false |
| `src/swarm/permissions.ts` *(new)* | `PermissionBroker` + `DEFAULT_ALLOW` + default policy |
| `src/swarm/teammate.ts` *(mod)* | read-loop maps `worker_shutting_down` → `shutdown` envelope (canUseTool lives in the query options the runtime builds) |
| `src/swarm/runtime.ts` *(mod)* | own a `PermissionBroker`; wire `canUseTool` into every teammate's options; `respondPermission()`, `requestShutdown()`; escalation pushes to the coordinator inbox |
| `src/swarm/server.ts` *(mod)* | add `RespondPermission`, `ShutdownTeammate` tools |
| `src/swarm/coordinator.ts` *(mod)* | add both tools to the whitelist + a "poll CheckMessages / answer permission requests" line to the persona |
| `src/swarm/types.ts` *(mod)* | `MessageKind += "permission" \| "shutdown"`; `Message += data?: Record<string,unknown>`; zod shapes for the two tools; `PermissionDecision` type |
| `src/config/types.ts` *(mod)* | `swarm.permissions?: { allow?: string[]; escalateToCoordinator?: boolean }` |
| `src/harness.ts` *(mod)* | pass `permissions` config into the runtime |

A2's `onPermissionRequest`/`onHandshake` seams are kept as optional observers (broker fires
`onPermissionRequest` before deciding; `requestShutdown` fires `onHandshake("shutdown", …)`).

## 5. PermissionBroker (the bridge)

Central `canUseTool` for every teammate. `decide(teammate, tool, input)` runs a **policy** →
`allow | deny | escalate`:
- **Default policy:** allow read-only + task tools (`Read, Grep, Glob, LS, mcp__cc-tasks__*`); everything
  else → `deny` (safe, non-blocking) unless `escalateToCoordinator` is on, in which case → `escalate`.
- **escalate** → push a `permission` request (with `data:{id,tool,input}`) to the coordinator inbox and
  await `RespondPermission` (the worker-waits-for-leader RPC). Returns `{behavior:'allow', updatedInput?}`
  or `{behavior:'deny', message}` (the SDK `PermissionResult` shape).

**Decided default:** `escalateToCoordinator` defaults **off** → non-allowlisted tools are denied
immediately. Safe-by-default and non-blocking (escalation blocks the teammate until a coordinator answers,
which requires one actively polling `CheckMessages`). The full RPC machinery still ships; coordinator-driven
flows opt in via `swarm.permissions.escalateToCoordinator = true`.

## 6. Shutdown handshake (graceful)

`dispose()` is already graceful (closing the input lets the in-flight turn finish, then the query ends).
A2b adds the **acknowledged** protocol: `ShutdownTeammate(name)` → `runtime.requestShutdown(name)` lets the
current turn settle, emits a `shutdown` envelope to the coordinator inbox, disposes the session, and
unregisters it. Separately, if a teammate's query emits `SDKWorkerShuttingDownMessage`
(`subtype:'worker_shutting_down'`), the read-loop emits a `shutdown` envelope so the coordinator learns of
unsolicited host shutdowns.

## 7. Two new cc-swarm tools (+ coordinator whitelist)

| Tool | Input | Behavior |
|---|---|---|
| `RespondPermission` | `requestId: string`, `decision: "allow"\|"deny"`, `message?: string` | Resolves an escalated permission request; `isError` if the id is unknown/already resolved. |
| `ShutdownTeammate` | `name: string` | Runs the graceful shutdown handshake; returns the disbanded name; `isError` on unknown teammate. |

Both added to `coordinatorTools()`. Persona gains: "poll `CheckMessages` regularly and answer any
`permission` requests with `RespondPermission`."

## 8. Integration surface

```ts
// swarm config addition
swarm?: boolean | { team?: string; coordinatorPersona?: boolean; tools?: string[];
                    permissions?: { allow?: string[]; escalateToCoordinator?: boolean } };
```

`createHarness` passes `permissions` into the `SwarmRuntime`, which builds the `PermissionBroker` and wires
`canUseTool: (tool,input) => broker.decide(name,tool,input)` into every teammate's query options.

## 9. Verification

- **Unit (no network):** `RequestRegistry` create/resolve/unknown-id; `PermissionBroker` (allow
  read-only+tasks; deny non-allowlisted when escalate off; escalate→pending→`respondPermission` allow/deny
  when on); teammate `worker_shutting_down`→`shutdown` envelope; runtime `requestShutdown` (ack envelope +
  unregister) and `canUseTool` wired into teammate options (fake-query capture); `RespondPermission` /
  `ShutdownTeammate` handlers (+ `isError` on unknown id/name); coordinator whitelist includes both;
  `createHarness` passes permissions through.
- **Live (one cheap test, gated on `ANTHROPIC_API_KEY`):** spawn a teammate seeded to "create a task via
  the cc-tasks TaskCreate tool" — the policy *allows* `mcp__cc-tasks__*`, so `canUseTool` lets it through
  and the shared store reflects the task. Proves the bridge's allow path end-to-end with the real SDK.

## 10. Success criteria

- Every teammate's tool use is gated by the central `PermissionBroker`; the default policy allows
  read-only + task tools and denies the rest (non-blocking).
- With `escalateToCoordinator`, a non-allowlisted tool escalates to the coordinator inbox and is resolved
  by `RespondPermission` (allow/deny), unblocking the teammate.
- `ShutdownTeammate` runs the graceful handshake (ack envelope + unregister); `worker_shutting_down` from a
  teammate surfaces as a `shutdown` envelope.
- The bus-RPC `RequestRegistry` is reusable (A2c plan-approval consumes it).
- `tsc --noEmit` clean; `vitest` green; no secret committed; the native-overlap is documented.
