# Kairos Mode — Core (Autonomous Scheduled Assistant) — Design

**Date:** 2026-06-17
**Status:** Approved (design); pending spec review → implementation plan
**Track:** Parity cluster **32 (mode-kairos)**, **sub-project 1 of N**. Composes already-built Phase-2 substrate
(swarm/daemon/proactive/tasks) into the autonomous scheduled-assistant mode. Follow-ups deferred:
Dream skill (32.9), channels (32.4), assistant team-init.
**Working dir:** `CC-to-SDK/harness/`

---

## 1. Goal

Ship a **headless, self-hostable autonomous assistant**: a long-running session that keeps working between
human turns (idle self-pacing), wakes on scheduled triggers, gates its own tool use with no human in the loop,
and reports to the user through a dedicated **Brief** channel rather than raw assistant text. Started with
`cc-harness assistant`. This is parity **32.1 (latch + persona)** + **32.3 (Brief/SendUserMessage)**, wiring
the native cron (**32.5**) and push (**32.8**) tools.

## 2. Verified ground truth (live-checked on `0.3.178`, 2026-06-17)

These probes (not the Feb snapshot) drive the design — see [[sdk-permissionmode-canusetool-matrix]],
[[sdk-native-assistant-worker-bridge-coupled]]:

- **`permissionMode: 'auto'` is real and live.** A model classifier approves/denies each call. Probed: with no
  `canUseTool` and no allow-rule, `auto` auto-approved a benign `Bash` (`echo`). This **is** the autonomous
  permission gate — we do not hand-build a classifier.
- **A scoped deny rule still bites under `auto`.** `disallowedTools: ["Bash(rm *)"]` blocked a matching `rm`
  (denied, never executed) even in `auto`. Useful as an *optional* deterministic floor — but a regex denylist
  is **not a security boundary** (trivially bypassable: `find -delete`, `dd`, `>`, scripting), so it is **off by
  default**. Real hardening for untrusted contexts is the **sandbox**, not a denylist.
- **The SDK's native assistant runtime is unusable standalone.** `@anthropic-ai/claude-agent-sdk/assistant`
  (`runAssistantWorker`) exists but is hard-coupled to claude.ai's remote-control **bridge**
  (`connectRemoteControl`, `bridgeSessionId`, SSE) — the 🚫 not-possible surface. So Kairos is **reconstructed**
  from our own substrate. Its cron model polls `<cwd>/.claude/scheduled_tasks.json` — the same store native
  `CronCreate` writes — which we reuse for interop.

## 3. Scope

**In:** `KairosAssistant` orchestrator; assistant+Brief **persona** (systemPrompt append); the **Brief**
output channel (`SendUserMessage` MCP tool + a `BriefSink`); a **cron poller** over the native scheduled-tasks
store; a **safety posture** resolver (force `auto`, refuse silent `bypass`); the `cc-harness assistant` CLI
subcommand; leaving native cron/push enabled and instructing their use; new public exports.

**Out / deferred:** Dream skill (32.9); channels (32.4); **assistant team-init** (swarm composition — a clean
follow-up); a persisted trust-acknowledgment file; Brief attachments; claude.ai bridge attach (32.2 🚫), remote
Routines / PR-webhooks (🚫); voice (36).

## 4. Approach

A new isolated **`src/kairos/`** module. `KairosAssistant` owns **one** long-running `DaemonSupervisor` session
and configures it, through the supervisor's existing `sessionOptions(id)` seam, into "assistant" posture:
`permissionMode: 'auto'`, the persona appended to `systemPrompt`, a `cc-brief` MCP server injected, native
cron/push left enabled. It then drives that session from **two wake sources**: the existing **proactive loop**
(`startProactive`, idle self-pacing) and a new **cron poller** (calendar-due wakes). All user-visible output
flows through the **Brief** channel, not raw assistant text.

Rejected: routing through native `runAssistantWorker` (bridge-locked, §2); building a bespoke permission
classifier (native `auto` provides it); a default denylist (not a boundary, §2).

## 5. Design

### 5.1 Module layout (`src/kairos/`)

| File | Responsibility |
|---|---|
| `persona.ts` | `applyAssistantPersona(options)` + the reconstructed Brief/assistant prompt sections |
| `brief.ts` | `BriefSink` interface, `stdoutBriefSink`, `createBriefMcpServer(sink)` (the `SendUserMessage` tool) |
| `cron.ts` | `CronPoller` — injected clock + reader + submit; fires due tasks once; clean teardown |
| `safety.ts` | `resolveAssistantPosture(config)` — force `auto`; refuse `bypass` without explicit escalation; optional `denyTools` |
| `assistant.ts` | `KairosAssistant` — composes supervisor session + proactive loop + cron poller + brief; `start`/`status`/`stop` |
| `index.ts` | re-exports |

Mirrors the per-mode layout (`daemon/`, `proactive/`, `swarm/`). No additions to `codex-core`-style hot files.

### 5.2 Persona (32.1, reconstructed) — `persona.ts`

`applyAssistantPersona(options)` appends an assistant+Brief section to `systemPrompt` exactly like
`applyProactivePersona`/`applyCoordinatorPersona` (handles the `undefined`/preset/append-string cases). It is
applied **alongside** `applyProactivePersona` (Kairos runs the proactive loop, so the IDLE-backoff contract
still holds). Reconstructed content (the verbatim CC asset is missing-source):

> You are running as an autonomous scheduled assistant (Kairos mode); no human is watching in real time.
> Report progress, results, and anything the user should see by calling the **SendUserMessage** tool (the Brief
> channel) — plain assistant text is **not** surfaced to the user in this mode. Use `status:"proactive"` for
> messages worth a push; `status:"normal"` otherwise. Schedule future or recurring work with **CronCreate**;
> use **PushNotification** for time-sensitive items. You may be woken by an idle heartbeat or a scheduled
> trigger; on a heartbeat with nothing useful to do, reply with exactly `IDLE` so the loop backs off.

### 5.3 Brief output channel (32.3) — `brief.ts`

```ts
export interface BriefMessage { text: string; status: "normal" | "proactive"; at?: number }
export interface BriefSink { write(msg: BriefMessage): void | Promise<void> }
export const stdoutBriefSink: BriefSink           // default: prints "[brief] …" to stdout
export function createBriefMcpServer(sink: BriefSink) // createSdkMcpServer name "cc-brief"
```

`createBriefMcpServer` mirrors `createTaskMcpServer`: a `SendUserMessage` tool, zod shape
`{ message: z.string(), status: z.enum(["normal","proactive"]).optional() }` (default `"normal"`), handler
calls `sink.write(...)` and returns an ack. The **sink is the user-visible surface** — the CLI uses
`stdoutBriefSink`; library embedders inject their own (callback/queue/log). "Brief replaces plain text" is
achieved by surfacing only sink output (the session's streamed assistant text is not forwarded — the proactive
tick already discards it, and cron submits route output to a no-op too). `status:"proactive"` is the
push-eligibility signal; push itself is the model calling native `PushNotification` (left enabled), **not** a
harness-side auto-push.

### 5.4 Cron poller (wire 32.5) — `cron.ts`

The native `CronCreate/Delete/List` tools (default-on, left enabled) persist to
`<cwd>/.claude/scheduled_tasks.json`. In a bridge-free reconstruction nothing fires those entries, so a small
poller does:

```ts
export interface DueTask { id: string; prompt: string; fireAt: number }
export interface CronReader { readDue(now: number): Promise<DueTask[]> }   // encapsulates the file schema
export class CronPoller {
  constructor(deps: { reader: CronReader; submit: (prompt: string) => Promise<unknown>;
                      now: () => number; schedule: (fn: () => void, ms: number) => () => void;
                      pollMs?: number });
  start(): void; stop(): Promise<void>;   // idempotent stop; drains an in-flight fire
}
```

The exact `scheduled_tasks.json` schema lives **only** inside the `CronReader` implementation, so the rest of
the module is decoupled from it. Each due task fires **once** (dedupe by `id`+`fireAt`); a fire in flight when
`stop()` is called is drained, never abandoned. Default poll cadence ≈10s (matching the native worker).

> **Plan Task-1 verification spike (load-bearing):** confirm the `scheduled_tasks.json` schema by calling
> `CronCreate` live and inspecting the file, **and** determine whether a live `query()` streaming session
> self-fires scheduled entries. If it self-fires, `CronPoller` collapses to a no-op and we wire nothing; if not
> (expected, per §2), the poller is the firing mechanism. The `CronReader` boundary keeps either outcome a
> one-file change.

### 5.5 Safety posture — `safety.ts`

```ts
resolveAssistantPosture(config?: { allowBypass?: boolean; denyTools?: string[] })
  -> { permissionMode: "auto", disallowedTools?: string[] }
```

Always sets `permissionMode: 'auto'`. If the embedder/CLI asks for `bypassPermissions` **without**
`allowBypass: true`, it is refused (throw) — autonomous mode never silently runs unguarded. `denyTools` (empty
default) maps to `disallowedTools` for users who want to hard-pin specific irreversible ops, documented as
footgun-mitigation, **not** a boundary. Spec note: for untrusted contexts, run with the existing `sandbox`
config.

### 5.6 Orchestrator — `assistant.ts`

```ts
export interface KairosConfig {
  cwd?: string; model?: string; sink?: BriefSink;
  proactive?: ProactiveConfigInput; posture?: { allowBypass?: boolean; denyTools?: string[] };
  cron?: { dir?: string; pollMs?: number };
}
export class KairosAssistant {
  constructor(deps: { query: QueryFn }, config?: KairosConfig);
  start(seedPrompt?: string): Promise<void>;   // spawn session, start proactive loop + cron poller, optional seed submit
  status(): { sessionId: string; proactive: ProactiveStatus; cron: { running: boolean } };
  stop(): Promise<void>;                        // stop poller, stopProactive, supervisor.stop; idempotent, drains in-flight
}
```

`KairosAssistant` constructs a `DaemonSupervisor({ query }, { sessionOptions })` where the factory builds the
**complete** assistant session options (the daemon session is otherwise bare): start from `{}`, run
`applyProactivePersona` + `applyAssistantPersona`, set `cwd`, the claude_code preset is created by the persona
appliers, spread `resolveAssistantPosture(posture)`, and inject `mcpServers: { "cc-brief": createBriefMcpServer(sink) }`
(plus `allowedTools: ["mcp__cc-brief__SendUserMessage"]` so the Brief channel itself is never gated by the
classifier). It then `spawn()`s one
session, `startProactive(id, proactive)`, and starts a `CronPoller` whose `submit` calls
`supervisor.submit(id, prompt, () => {})` (Brief output reaches the user via the sink, not this callback). The
single `sink` is shared across idle ticks and cron fires.

### 5.7 CLI — `cli.ts` / `cliArgs.ts`

A new `assistant` subcommand (sibling to `daemon`/`ps`/`submit`): `cc-harness assistant [--cwd <dir>]
[--model <m>] [--allow-bypass] ["<seed prompt>"]`. Builds a `KairosAssistant` with `stdoutBriefSink`, `start()`s
it (seed prompt optional), and runs until SIGINT/SIGTERM, on which it `stop()`s cleanly (mirrors `runDaemon`).
The subcommand itself is the explicit opt-in; `--allow-bypass` is the only escalation past forced `auto`.

### 5.8 Data flow

```
wake: proactive idle-tick  ──┐
wake: cron-due (poller)    ──┼─► supervisor.submit(id, prompt)   [session: permissionMode 'auto']
                             │      └─ model works; tool calls auto-gated by the native classifier
                             │      └─ model calls SendUserMessage ──► BriefSink ──► user (stdout/callback)
                             │      └─ model may call CronCreate (schedule) / PushNotification (urgent)
                             └─ on idle with no work: model replies IDLE ──► proactive loop backs off
```

## 6. Error handling / liveness

Per [[teardown-liveness-review-pattern]], write these before review: `CronPoller` — teardown-while-a-fire-is-
pending (drains, never hangs); fire-once (no double-fire of a due task); idempotent `stop()`. `KairosAssistant`
— `stop()` is idempotent and stops poller + proactive + session in order; `start()` is not re-entrant. The
proactive loop already owns idle/error backoff and pause-on-human-submit; Kairos does not duplicate it.

## 7. Verification / acceptance

- **Unit (zero-network, DI):** persona append composition (proactive + assistant order, preset creation);
  `BriefSink` stdout + status routing; `CronPoller` due/not-due, fire-once, teardown-while-pending, idempotent
  stop (injected clock/reader/submit); `resolveAssistantPosture` (default `auto`, refuse `bypass`, `allowBypass`
  escalation, `denyTools`→`disallowedTools`).
- **Integration (fake query/supervisor):** `KairosAssistant` builds session options correctly (`permissionMode
  'auto'`, `cc-brief` MCP present + allow-listed, both personas appended); `start`/`stop` lifecycle; both wake
  sources submit to the one session.
- **Live (real SDK, `.env`):** one assistant tick under `auto` emits a Brief to a captured sink end-to-end;
  the cron round-trip is asserted only after the §5.4 spike pins the mechanism.
- `npm run typecheck` clean; existing 222 unit tests stay green; `npm run build` + `verify:pack` still pass with
  the new exports.

## 8. Success criteria

- `cc-harness assistant` starts a persistent autonomous session under `permissionMode: 'auto'`, self-paces via
  the proactive heartbeat, fires scheduled wakes, and surfaces **all** user-facing output through the Brief
  channel (stdout by default).
- The model can schedule future work (`CronCreate`) and notify (`PushNotification`); both are reached, not
  rebuilt.
- Autonomous mode never runs `bypassPermissions` silently; the denylist is optional/empty; the sandbox is the
  documented hardening path.
- Clean teardown on signal; unit + integration green; one live `auto`-mode Brief tick verified.
- New `src/kairos/index.ts` exports are added to the public surface without breaking the package build.
