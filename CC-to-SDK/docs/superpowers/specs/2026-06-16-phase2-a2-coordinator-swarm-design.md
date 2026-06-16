# Phase 2 · A2 — Coordinator / Swarm Substrate — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** 2 (Modes & advanced), sub-project **A2** of the CC→SDK program. Follows A1 (Task tools).
**Working dir:** `CC-to-SDK/harness/` (extends the Phase-1/A1 package)
**Inputs:** parity cluster `30-coordinator-multiagent` (`docs/parity/30-coordinator-multiagent.md`), roadmap Phase 2; builds on the A1 `TaskStore` (`harness.tasks`) + its `onOwnerChange` seam.

---

## 1. Goal

Give the harness a **coordinator** Claude session that orchestrates **long-lived peer teammate
sessions** — each a real SDK `query()` — coordinating them through an **in-process message bus** and the
shared A1 `TaskStore`. Delivered as MCP orchestration tools the coordinator model calls, faithful to
CC's coordinator persona + tool-whitelist. A2 is the substrate the swarm refinements (permission bridge,
handshakes — A2b) and the swarm UI (Phase 3) build on.

## 2. Premise & scope (from the parity map)

CC's swarm is **multi-process** terminal panes (tmux / iTerm2) with a file/uds **mailbox** between
separate Claude processes. The Agent SDK has **no equivalent**: it spawns child subagents in-process,
not peer terminal-pane sessions. Every bridge note in cluster 30 points to the same reimplementation —
**one Node process spawns multiple SDK `query()` sessions as peers and coordinates them itself**, over an
in-process bus, sharing the A1 `TaskStore` as the work-claim substrate.

**In scope (the A2 build rows):**
- **30.1** spawn peer teammates (long-lived SDK `query()` sessions, *not* SDK subagents).
- **30.2** `TeamCreate` / `TeamDelete` team lifecycle.
- **30.3** `SendMessage` inter-agent mailbox (in-process bus).
- **30.4** coordinator orchestrator persona (system-prompt preset).
- **30.11** coordinator tool-pool filter (tool whitelist).

**Seams only (deferred to A2b), with reasons:**
- **30.5** worker→leader permission bridge — central `canUseTool` for all peers. A2 ships an
  `onPermissionRequest` **seam**; A2b attaches the central policy.
- **30.7** structured handshakes (shutdown / plan-approval). A2 ships an `onHandshake` **seam** plus a
  hard `dispose()` (forced teardown); A2b adds the negotiated shutdown / plan-approval protocol (it can
  ride the SDK `SDKWorkerShuttingDownMessage`).

**Already provided (SDK / earlier phases — not rebuilt here):** 30.6 `TeammateIdle` hook, 30.8 worker
result envelope → `SDKTaskNotification`/`SDKTaskProgress`, 30.9 teammate model → `AgentDefinition.model`,
30.10 sidechain transcripts → `getSubagentMessages`/`listSubagents`, 30.14 `agentProgressSummaries`,
30.15 `parent_tool_use_id`. A2 maps onto these where natural (e.g. idle/result envelopes) but does not
reimplement them.

**Non-goals:** 30.12 tmux / iTerm2 panes (🚫 TUI-runtime, no SDK surface), 30.13 swarm-view UI (P3),
push-injection into the coordinator (alternative B below — A2b/P3), multi-process locking.

## 3. Architecture

One process. The **coordinator** is a Claude `query()` session given the orchestration MCP tools (CC's
persona + tool-whitelist model). Each **teammate** is a *long-lived* SDK `query()` peer in streaming-input
mode. They coordinate through an in-process `MessageBus` and the shared `TaskStore`.

```
HarnessConfig.swarm ─► createHarness ─► SwarmRuntime (registry + bus + TaskStore)
                                        └► merge "cc-swarm" MCP server, expose harness.swarm

Coordinator query() ──tool calls──► SwarmRuntime
  (persona + whitelist)               ├ TeamCreate/Delete → registry
                                      ├ spawnTeammate     → TeammateSession (SDK query, streaming-input)
                                      ├ SendMessage       → bus → teammate inbox (delivered as a user turn)
                                      └ CheckMessages     → drain coordinator inbox
TeammateSession(s) ◄── MessageBus ──► coordinator inbox ; claim work via TaskStore (A1 CAS)
                                       TaskStore.onOwnerChange → bus  (completes A1's deferred 15.10)
```

`resolveOptions` stays **pure**; the stateful runtime/server wiring happens in `createHarness` and
post-merges into the resolved `options.mcpServers` (identical pattern to A1).

### SDK mechanism (verified, load-bearing)

`query({ prompt })` accepts `string | AsyncIterable<SDKUserMessage>` (sdk.d.ts:2498). A teammate is
opened with an **async-iterable prompt the runtime controls** (a push-queue); the transport stays open,
so the coordinator can `SendMessage` more turns over the teammate's lifetime. `Query.streamInput()`
(2467) and the streaming-only control methods (`interrupt`, `setModel`) confirm the open-transport model.
`SDKWorkerShuttingDownMessage` and `SDKTaskNotification/Started/Updated/Progress` exist in the message
union — the A2b shutdown handshake and the result/idle envelopes have real SDK message types to ride on.

## 4. Module structure (small, single-responsibility files under `src/swarm/`, mirroring `src/tasks/`)

| File | Responsibility |
|---|---|
| `src/swarm/types.ts` | `Message`, `MessageKind`, `TeammateSpec`, `SwarmOptions`, zod input shapes for the tools, derived input types |
| `src/swarm/bus.ts` | `MessageBus`: per-agent in-process inboxes — `send(to, msg)`, `drain(agent)`, unknown-recipient error, idle/subscribe seam |
| `src/swarm/team.ts` | team registry: create/delete, roster, membership, lifecycle state |
| `src/swarm/teammate.ts` | `TeammateSession`: wraps a long-lived `query()` via a push-queue prompt; `send(turn)`; emits `result`/`idle` envelopes to the bus; `dispose()` ends the query |
| `src/swarm/runtime.ts` | `SwarmRuntime`: ties registry + bus + TaskStore + teammate factory; the API the tools + harness use; `onPermissionRequest` / `onHandshake` seams |
| `src/swarm/coordinator.ts` | coordinator persona (system-prompt append) + tool-pool whitelist (30.4 / 30.11) |
| `src/swarm/server.ts` | `buildSwarmTools(runtime)` (exported seam) + `createSwarmMcpServer(runtime)` (`createSdkMcpServer` name `"cc-swarm"`) |
| `src/swarm/index.ts` | public exports (`SwarmRuntime`, `MessageBus`, `createSwarmMcpServer`, types) |
| `src/config/types.ts` *(modify)* | add `swarm?` to `HarnessConfig` |
| `src/harness.ts` *(modify)* | build/wire runtime + server when enabled; expose `harness.swarm` |
| `src/index.ts` *(modify)* | re-export the swarm public API |

## 5. Message & team model

```ts
type MessageKind = "text" | "task" | "result" | "idle";
interface Message {
  from: string;            // agent name ("coordinator" | teammate name)
  to: string;              // recipient agent name ("coordinator" | teammate name)
  kind: MessageKind;
  body: string;
  ts: string;              // ISO timestamp, stamped by the bus
}
interface TeammateSpec {
  name: string;            // unique within the runtime
  teamId: string;
  agent?: string;          // AgentDefinition key / model hint (maps to 30.9); optional
  prompt: string;          // seed turn
}
```

**MessageBus (in-process).** A `Map<agentName, Message[]>` of inboxes. `send(to, msg)` appends to the
recipient's inbox (creating `"coordinator"`'s lazily); sending to an unregistered teammate is an error.
`drain(agent)` returns and clears that agent's inbox. The bus is synchronous and deterministic — the
whole substrate is unit-testable with zero network. Reverse-edge / idle subscription is a seam.

**Team registry.** `create(name, members?)` returns a team id + roster; `delete(teamId)` disposes every
member `TeammateSession` and clears their inboxes. Duplicate teammate names within the runtime are
rejected. The registry holds lifecycle state (`active` / `disbanded`).

## 6. The five MCP tools (coordinator-facing `"cc-swarm"` server)

Delivered via `tool(name, description, zodRawShape, handler)` wrapped in
`createSdkMcpServer({ name: "cc-swarm", tools: [...] })`. Each handler returns an MCP `CallToolResult`
(`{ content: [{ type: "text", text }], isError? }`). `buildSwarmTools(runtime)` is the exported test seam.

| Tool | Input shape | Behavior |
|---|---|---|
| `TeamCreate` | `name: string`, `members?: string[]` | Registers a team; returns `{ teamId, roster }`. |
| `TeamDelete` | `teamId: string` | Disbands: disposes member sessions, clears their inboxes; returns the disbanded roster. `isError` on unknown id. |
| `spawnTeammate` | `teamId: string`, `name: string`, `agent?: string`, `prompt: string` | Spawns a long-lived `TeammateSession` seeded with `prompt`; registers it on the team; returns `{ name, teamId }`. `isError` on unknown team / duplicate name. |
| `SendMessage` | `to: string`, `body: string`, `kind?: MessageKind` | Routes a message via the bus to a teammate (delivered into its query as a user turn) or to `"coordinator"`. `isError` on unknown recipient. |
| `CheckMessages` | *(none)* | Drains the **coordinator's** inbox; returns the messages (teammate replies / idle / result envelopes). |

**Error semantics.** Domain failures are returned as `isError` `CallToolResult`s (the model can read and
react). Unexpected internal failures (e.g. an SDK transport error) propagate.

## 7. Teammate lifecycle (long-lived peer)

- `TeammateSession` opens an SDK `query()` whose prompt is an **AsyncIterable the runtime feeds** (a
  push-queue). It is seeded with `spec.prompt` as the first turn.
- `send(turn)` enqueues a new user turn → the teammate processes it (this is how `SendMessage` reaches a
  teammate).
- The session's read-loop consumes assistant/result messages; on a settled turn it pushes a `result`
  envelope to the coordinator's bus inbox, and an `idle` envelope when its queue is empty (mapping to the
  SDK `TeammateIdle` / `SDKTaskNotification` semantics — not reimplemented, just mirrored onto the bus).
- `dispose()` closes the input iterator → the query ends. `TeamDelete` calls it. (Graceful negotiated
  shutdown is the A2b handshake seam; A2 only guarantees hard teardown.)
- Each teammate is given the shared `TaskStore` with its own `agentName`, so it claims work through the
  A1 CAS primitive. The runtime wires `TaskStore.onOwnerChange` → `bus.send` (a `task` envelope to the
  coordinator) — this **completes A1's deferred 15.10 mailbox-notify**, now that a bus exists.
- **Testability:** `TeammateSession` takes an **injected `query`** (DI, exactly like A1's `createHarness`
  `deps.query`). Unit tests pass a fake async-generator `query` and assert: spawn seeds the prompt,
  `send` delivers a turn, `result`/`idle` envelopes hit the bus, `dispose` ends the query.

## 8. Coordinator → teammate-output mechanism (decided)

**Pull via `CheckMessages` (chosen).** Teammate envelopes land in the coordinator's bus inbox; the
coordinator model reads them by calling `CheckMessages`. Deterministic, fully unit-testable, and requires
no streaming-injection into the coordinator session. (Alternative considered: **push** — inject teammate
replies as turns into the coordinator's own streaming-input query; more "live" but couples the
coordinator to streaming mode and is hard to test deterministically. Deferred to A2b / Phase 3.)

## 9. Integration surface

```ts
// HarnessConfig addition
swarm?: boolean | { team?: string; coordinatorPersona?: boolean; tools?: string[] };
```

When truthy, `createHarness`:
1. Builds a `SwarmRuntime` over the existing `harness.tasks` `TaskStore` (or a new one if `taskTools`
   was not enabled), wiring `onOwnerChange` → bus.
2. Builds the MCP server via `createSwarmMcpServer(runtime)`.
3. Merges it into the resolved `options.mcpServers` under key `"cc-swarm"` (preserving user servers and
   the A1 `"cc-tasks"` server).
4. If `coordinatorPersona` is set, applies the coordinator system-prompt append + tool-pool whitelist
   (30.4 / 30.11) to the resolved options.
5. Exposes `harness.swarm: SwarmRuntime | undefined` for programmatic inspection and the A2b seams.

`resolveOptions(config)` is unchanged in purity; the merge happens in `createHarness` after it runs.

## 10. Verification

`harness/test/` (vitest), two tiers, reusing the Phase-1 / A1 infra:

- **Unit (no network):**
  - `MessageBus`: `send`/`drain` round-trip; unknown-recipient error; lazy coordinator inbox; FIFO order.
  - Team registry: create returns roster; `delete` disposes members + clears inboxes; duplicate-name
    rejection; lifecycle state.
  - `TeammateSession` (injected fake `query`): spawn seeds the prompt as the first turn; `send` delivers
    a subsequent turn; `result`/`idle` envelopes reach the bus; `dispose` ends the query.
  - Tool handlers via `buildSwarmTools`: invoke each directly; assert `CallToolResult` shape, the runtime
    mutation, and `isError` on unknown team / duplicate name / unknown recipient / unknown teammate.
  - Coordinator persona + tool-pool filter resolution (system-prompt append present; whitelist applied).
  - `onOwnerChange` → bus wiring: a `TaskStore` owner change pushes a `task` envelope to the coordinator
    inbox.
  - Integration: `createHarness({ swarm: true })` merges `"cc-swarm"` into `options.mcpServers` and
    exposes `harness.swarm`; coexists with `taskTools: true` (both servers present).
- **Live (network, `ANTHROPIC_API_KEY`, auto-skips without it) — one cheap smoke test:** enable `swarm`,
  drive a coordinator session that spawns ONE teammate with a trivial task, `SendMessage`s it, the
  teammate performs a one-line action and reports, and the coordinator `CheckMessages` sees the reply.
  Minimal tokens; asserts the end-to-end path once.

## 11. Success criteria

- The five `"cc-swarm"` tools are callable by the coordinator model, backed by a `SwarmRuntime` that
  spawns long-lived SDK `query()` peers, routes messages over an in-process bus, and shares the A1
  `TaskStore`.
- Team lifecycle, the message bus, and the teammate session (spawn / send / report / dispose) behave as
  specified and are unit-tested without the network (via an injected fake `query`).
- `createHarness({ swarm: true })` auto-registers the server, applies the coordinator persona/whitelist
  when requested, and exposes `harness.swarm`; it coexists with `taskTools`.
- `onOwnerChange` → bus closes A1's deferred 15.10 mailbox-notify.
- The live smoke test shows a coordinator spawning a teammate, messaging it, and reading its reply
  end-to-end.
- `tsc --noEmit` clean; `vitest` green; no secret committed.
- A2b can consume the `onPermissionRequest` / `onHandshake` seams as the permission-bridge / handshake
  substrate without modifying A2.

## 12. Non-goals (A2)

Permission-bridge impl (seam only — A2b), handshake impl (seam + hard `dispose()` only — A2b),
push-injection into the coordinator (alternative B — A2b/P3), multi-process locking, swarm-view UI (P3),
tmux / iTerm2 pane backends (🚫 non-goal).
