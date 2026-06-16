# Phase 2 · A2c — Plan-Approval Handshake — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** 2, sub-project **A2c** of the CC→SDK program. Completes the swarm line (A2 substrate → A2b permission bridge + shutdown → **A2c plan approval**).
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity cluster 30 row 30.7 (plan-approval half, deferred from A2b); the A2b `RequestRegistry` bus-RPC layer, `PermissionBroker`, and the `onPermissionRequest`/`onHandshake` seams.

> **Native overlap (read `docs/parity/CORRECTIONS-2026-06-16-native-tools.md`).** The SDK has a native
> **experimental, flag-gated** teammate system whose plan-approval shape is `ExitPlanModeOutput.awaitingLeaderApproval`
> + `requestId`. Per the disposition decision the harness keeps a **controlled, non-experimental** swarm;
> A2c is its plan-approval handshake, mirroring that native shape (a teammate's plan awaits leader approval)
> without the experimental flag.

---

## 1. Goal

Let a teammate be spawned in **plan mode**. When it finishes planning and calls `ExitPlanMode`, escalate
its plan to the **coordinator**, who **approves** (the teammate leaves plan mode and implements) or
**rejects with feedback** (the teammate stays in plan mode and revises). This is the worker→leader
plan-approval RPC, built on the A2b bus-RPC layer.

## 2. Premise & scope — verified against the live SDK

Two runtime behaviors that the `.d.ts` files cannot express were confirmed with throwaway live spikes
before this design hardened (the A1 lesson — never build on an unverified Feb-snapshot premise):

1. **`ExitPlanMode` routes through `canUseTool`** when `permissionMode: "plan"`. The spike saw exactly one
   permission call — `ExitPlanMode` — and the plan markdown arrives in **`input.plan`** (with
   `input.planFilePath`). So interception is just special-casing one tool inside the permission seam A2b
   already owns; no new SDK surface is needed.
2. **The query object exposes `setPermissionMode`** (alongside `interrupt`, `setModel`). That is the lever
   to move an approved teammate out of plan mode so its next turn can execute.

A third spike refined the post-approval design: **`permissionMode: "auto"` short-circuits `canUseTool`**
(the auto-classifier ran a Bash command without the callback firing). So `permissionMode` and `canUseTool`
do not stack — `auto`/`bypassPermissions` *replace* the callback; only `default` (and partially
`acceptEdits`) keep the A2b broker in the loop. The post-approval mode is therefore a **choice of
governance source**, not an additive layer.

**In scope:** 30.7 plan-approval handshake — plan-mode teammates, `ExitPlanMode` interception, coordinator
approve/reject, mode transition on approval.
**Non-goals (YAGNI):** coordinator→human plan approval (that is the SDK's own top-level plan mode, already
present); plan persistence/history; the `ExitPlanModeInput.allowedPrompts` prompt-permission mechanism;
auto-approval policies (the coordinator decides each plan).

## 3. Architecture — reuse the A2b bus-RPC layer

`RequestRegistry` (A2b) already correlates a request id with a pending promise the coordinator resolves
later. A2c adds a second consumer alongside `PermissionBroker`:

```
teammate (permissionMode:"plan") calls ExitPlanMode(plan, planFilePath)
   └► teammate canUseTool routes ExitPlanMode ─► PlanApprovalBroker.requestApproval(name, plan, filePath)
        → RequestRegistry.create(); fire onEscalate ─► push {kind:"plan",data:{id,teammate,plan,planFilePath}}
                                                        → coordinator inbox; await pending promise
coordinator CheckMessages ─► sees the plan ─► ApprovePlan(id,"approve"|"reject",feedback?)
   ─► runtime.respondPlan ─► PlanApprovalBroker.respond(id,decision,feedback)
        ├ approve → onApprove(teammate) → session.setMode(<post-approval mode>); resolve → {behavior:"allow",updatedInput}
        │           (ExitPlanMode succeeds → teammate exits plan mode → implements)
        └ reject  → resolve → {behavior:"deny", message: feedback}
                    (ExitPlanMode blocked → teammate stays in plan mode → revises)
```

Plans **always** escalate (no allowlist) — that is the semantic difference from permissions, and why this
is a **separate focused unit** (`PlanApprovalBroker`) sharing `RequestRegistry`, rather than a branch
inside `PermissionBroker.decide`.

## 4. Modules (extend `src/swarm/`, mirroring A2b)

| File | Change |
|---|---|
| `src/swarm/planApproval.ts` *(new)* | `PlanApprovalBroker` over `RequestRegistry<PlanDecision>`: `requestApproval(name, input) → Promise<PermissionResult>` (always escalates; surfaces `input.plan` in `onEscalate`; echoes the full `input` on approve), `respond(id, "approve"\|"reject", feedback?) → bool` (approve→fire `onApprove(name)` then resolve allow; reject→resolve deny+message), unknown id → false |
| `src/swarm/teammate.ts` *(mod)* | add `setMode(mode)` → guarded `this.q.setPermissionMode?.(mode)` (DI fake omits it; unit tests inject a spy) |
| `src/swarm/runtime.ts` *(mod)* | own a `PlanApprovalBroker`; in `spawnTeammate`, if `spec.plan` set `options.permissionMode = "plan"` and route `canUseTool`: `tool === "ExitPlanMode" ? planBroker.requestApproval(name, input) : broker.decide(...)`; `onApprove(name) → sessions.get(name)?.setMode(postApprovalMode)`; `onEscalate` pushes the `plan` envelope; add `respondPlan(id, decision, feedback?) → bool` |
| `src/swarm/server.ts` *(mod)* | add `ApprovePlan` tool |
| `src/swarm/coordinator.ts` *(mod)* | add `mcp__cc-swarm__ApprovePlan` to the whitelist + a "review `plan` messages and answer with `ApprovePlan`" line to the persona |
| `src/swarm/types.ts` *(mod)* | `MessageKind += "plan"`; `TeammateSpec += plan?: boolean`; `spawnTeammateShape += plan: z.boolean().optional()` (coordinator can request a plan-mode teammate); `PlanDecision { decision: "approve"\|"reject"; feedback?: string }`; `approvePlanShape` zod raw shape; extend `SwarmOptions.permissions` with `onPlanApproval?` |
| `src/config/types.ts` *(mod)* | `swarm.permissions.onPlanApproval?: "default"\|"acceptEdits"\|"auto"\|"bypassPermissions"` |
| `src/harness.ts` *(mod)* | pass `onPlanApproval` through to the runtime (already passes `permissions`) |

## 5. PlanApprovalBroker (the handshake)

`requestApproval(teammate, input)` (where `input` is the full `ExitPlanMode` tool input — keys `plan`,
`planFilePath`):
- Fire `onRequest?(teammate, { plan: input.plan })` (optional observer, mirrors `PermissionBroker`).
- Always `RequestRegistry.create()`, recording the request id → teammate; fire
  `onEscalate(teammate, String(input.plan ?? ""), requestId)`; return the pending promise. (No allowlist —
  every plan goes to the coordinator.)

`respond(requestId, decision, feedback?)`:
- `approve` → fire `onApprove(teammate)` (the runtime uses this to `setMode`), then resolve the pending
  promise to `{ behavior: "allow", updatedInput: input }` (the original `ExitPlanMode` input, echoed
  whole). **`updatedInput` is required** — the SDK rejects a bare `{ behavior: "allow" }` with a ZodError
  (the A2b live-test discovery).
- `reject` → resolve to `{ behavior: "deny", message: feedback ?? "plan rejected" }`.
- unknown / already-resolved id → `false`.

To map `requestId → teammate` for `onApprove`, the broker records the teammate name when it creates the
request and looks it up on `respond`.

## 6. Post-approval mode (configurable governance source)

On **approve**, the teammate transitions to `permissions.onPlanApproval` (default `"default"`):

| Mode | Governs the teammate's post-approval actions |
|---|---|
| `default` *(default)* | **A2b PermissionBroker** — `canUseTool` fires; allowlist + escalate-to-coordinator apply (verified: this is the mode A2b's live test exercises). |
| `acceptEdits` | SDK auto-accepts file edits; the broker still sees Bash/other gated tools. |
| `auto` | **SDK model-classifier** — `canUseTool` is bypassed (verified), so the broker does not govern. |
| `bypassPermissions` | No gating — fully autonomous. |

A2c gates the **plan**; A2b gates each **action** (under `default`/`acceptEdits`). Because the teammate's
`canUseTool` is always wired, the only difference between modes is whether the SDK routes calls to it.

## 7. New cc-swarm tool (+ coordinator whitelist)

| Tool | Input | Behavior |
|---|---|---|
| `ApprovePlan` | `requestId: string`, `decision: "approve"\|"reject"`, `feedback?: string` | Resolves an escalated plan request; `isError` if the id is unknown/already resolved. On `reject`, `feedback` is returned to the teammate as the deny message so it can revise. |

Added to `coordinatorTools()`. `spawnTeammate` gains an optional `plan` flag so the coordinator can spawn a
plan-mode worker. Persona gains: "When a teammate sends a `plan` message, review it and answer with
`ApprovePlan` — approve to let it implement, or reject with feedback to have it revise."

## 8. Integration surface

```ts
// swarm config addition (extends A2b's permissions object)
swarm?: boolean | { team?: string; coordinatorPersona?: boolean; tools?: string[];
                    permissions?: { allow?: string[]; escalateToCoordinator?: boolean;
                                    onPlanApproval?: "default" | "acceptEdits" | "auto" | "bypassPermissions" } };

// spawning a plan-mode teammate
runtime.spawnTeammate({ teamId, name: "w1", prompt: "...", plan: true });
```

## 9. Verification

- **Unit (no network):** `PlanApprovalBroker` — always escalates (fires `onEscalate`, never resolves
  immediately); `respond("approve")` fires `onApprove` then resolves `{behavior:"allow", updatedInput: <echoed input>}`;
  `respond("reject", fb)` resolves `{behavior:"deny", message: fb}`; unknown id → `false`; `onRequest`
  observer fires before escalating. Runtime — `spawnTeammate({plan:true})` sets `permissionMode:"plan"` and
  routes `ExitPlanMode` to the plan broker (fake-query capture); `respondPlan("approve")` calls
  `session.setMode(onPlanApproval)` (spy on the fake query). `teammate.setMode` no-ops safely when the query
  lacks `setPermissionMode`. Server — `ApprovePlan` handler (ok + `isError` on unknown id). Coordinator —
  whitelist includes `ApprovePlan`; persona mentions plan review. Types — `spawnTeammateShape` accepts `plan`.
- **Live (one cheap test, gated on `ANTHROPIC_API_KEY`):** spawn a plan-mode teammate seeded to "make a
  one-line plan and call ExitPlanMode"; the test acts as coordinator — drains the `plan` envelope, asserts
  it carries the plan text + `requestId`, calls `respondPlan(id, "approve")`, and asserts the teammate
  proceeds (e.g. creates a `PLAN_OK` task via the allowlisted `cc-tasks` tool on its next turn). Proves the
  full handshake — ExitPlanMode interception → escalation → approval → mode transition → execution — against
  the real SDK, exactly where A2b's live test caught the `updatedInput`/runtime-validation surprises.

## 10. Success criteria

- A teammate spawned with `plan: true` starts in plan mode; its `ExitPlanMode` call is intercepted and
  escalated to the coordinator inbox as a `plan` envelope carrying the plan text + `requestId`.
- `ApprovePlan(id, "approve")` transitions the teammate to the configured post-approval mode and lets
  `ExitPlanMode` succeed; `ApprovePlan(id, "reject", feedback)` denies it with the feedback so the teammate
  revises in plan mode.
- The post-approval governance source is configurable (`default`/`acceptEdits`/`auto`/`bypassPermissions`),
  defaulting to `default` (A2b broker governs).
- The bus-RPC `RequestRegistry` is shared by both `PermissionBroker` and `PlanApprovalBroker` with no change.
- `tsc --noEmit` clean; `vitest` green; no secret committed; the native-overlap is documented.
```
