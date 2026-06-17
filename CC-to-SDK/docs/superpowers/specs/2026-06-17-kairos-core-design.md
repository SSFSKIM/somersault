# Kairos Mode — Core (Autonomous Scheduled Assistant) — Design

**Date:** 2026-06-17
**Status:** Approved; implemented (latch + Brief + safety + orchestrator + CLI). Cron/push deferred — see the Scope Revision.
**Track:** Parity cluster **32 (mode-kairos)**, **sub-project 1 of N**. Composes already-built Phase-2 substrate
(swarm/daemon/proactive/tasks) into the autonomous scheduled-assistant mode. Follow-ups deferred:
Dream skill (32.9), channels (32.4), assistant team-init, **calendar cron firing (32.5) + push (32.8)**.
**Working dir:** `CC-to-SDK/harness/`

---

## 0. Scope Revision (2026-06-17, post-verification — SUPERSEDES cron text below)

This design was written during brainstorming, before the cron firing mechanism was probed. During plan
authoring, **five live probes (`0.3.178`)** established that native `CronCreate` calendar scheduling is **not
usable in a standalone headless reconstruction**:

- In streaming-input mode the input queue is **caller-owned**, so the SDK scheduler *registers* cron jobs but
  **cannot self-inject** a fire into a stream it only reads (held a session open 125s with an every-minute job,
  zero injected fires).
- Even `durable:true` returned *"Session-only (not written to disk)"* and wrote **no**
  `.claude/scheduled_tasks.json` from a plain headless `query()` — the durable write + the firing both live in
  the bridge-coupled assistant worker, not a bare session. The in-memory job list is not exposed.

Net: a `CronPoller` over `scheduled_tasks.json` would have **nothing to read** headlessly. Honest calendar
scheduling requires a **harness-owned scheduler** (parse 5-field cron + timer + `submit`) — a real subsystem,
its own follow-up — not a thin wire. Push (32.8) likewise needs a transport (`disabledReason:'no_transport'`
headlessly). See [[sdk-native-assistant-worker-bridge-coupled]].

**Therefore the shipped core scope is: latch (32.1) + Brief (32.3) + safety posture + `KairosAssistant`
orchestrator + `cc-harness assistant` CLI**, with the **proactive heartbeat as the sole wake source**. The
`CronPoller` (§5.4), the cron config/`status().cron` field (§5.6), the second wake source (§5.8), and the
`CronCreate`/`PushNotification` persona lines (§5.2) are **deferred** to a "Kairos scheduling & notifications"
follow-up. Native cron/push tools remain *callable* by the model but the harness does not rely on them.
Sections §3–§8 below retain their original wording for history; where they describe a cron poller or
cron/push wiring, this revision governs.

---

## 1. Goal

Ship a **headless, self-hostable autonomous assistant**: a long-running session that keeps working between
human turns (idle self-pacing via the proactive heartbeat), gates its own tool use with no human in the loop,
and reports to the user through a dedicated **Brief** channel rather than raw assistant text. Started with
`cc-harness assistant`. This is parity **32.1 (latch + persona)** + **32.3 (Brief/SendUserMessage)**; calendar
cron (**32.5**) and push (**32.8**) are deferred (§0).

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
  from our own substrate.
- **Native cron does not self-fire headlessly** (§0): `CronCreate` registers jobs but the SDK cannot inject
  fires into a caller-owned stream, and `durable:true` writes no file from a bare `query()`. Calendar
  scheduling is therefore deferred to a harness-owned scheduler.

## 3. Scope

**In:** `KairosAssistant` orchestrator; assistant+Brief **persona** (systemPrompt append); the **Brief**
output channel (`SendUserMessage` MCP tool + a `BriefSink`); a **safety posture** resolver (force `auto`,
refuse silent `bypass`); the `cc-harness assistant` CLI subcommand; new public exports. Scheduled wakes are
provided by the **proactive heartbeat** (already built).

**Out / deferred:** **calendar cron firing (32.5)** and **push (32.8)** — a harness-owned scheduler +
notification transport, per §0; Dream skill (32.9); channels (32.4); **assistant team-init** (swarm
composition); a persisted trust-acknowledgment file; Brief attachments; claude.ai bridge attach (32.2 🚫),
remote Routines / PR-webhooks (🚫); voice (36).

## 4. Approach

A new isolated **`src/kairos/`** module. `KairosAssistant` owns **one** long-running `DaemonSupervisor` session
and configures it, through the supervisor's existing `sessionOptions(id)` seam, into "assistant" posture:
`permissionMode: 'auto'`, the persona appended to `systemPrompt`, a `cc-brief` MCP server injected. It then
drives that session from the **proactive loop** (`startProactive`, idle self-pacing). All user-visible output
flows through the **Brief** channel, not raw assistant text. *(Original text named a second cron wake source —
deferred per §0.)*

Rejected: routing through native `runAssistantWorker` (bridge-locked, §2); building a bespoke permission
classifier (native `auto` provides it); a default denylist (not a boundary, §2).

## 5. Design

### 5.1 Module layout (`src/kairos/`)

| File | Responsibility |
|---|---|
| `persona.ts` | `applyAssistantPersona(options)` + the reconstructed Brief/assistant prompt sections |
| `brief.ts` | `BriefSink` interface, `stdoutBriefSink`, `createBriefMcpServer(sink)` (the `SendUserMessage` tool) |
| `safety.ts` | `resolveAssistantPosture(config)` — force `auto`; refuse `bypass` without explicit escalation; optional `denyTools` |
| `assistant.ts` | `KairosAssistant` — composes supervisor session + proactive loop + brief; `start`/`status`/`stop` |
| `index.ts` | re-exports |
| ~~`cron.ts`~~ | *Deferred (§0): `CronPoller` belongs to the Kairos scheduling follow-up.* |

Mirrors the per-mode layout (`daemon/`, `proactive/`, `swarm/`). No additions to `codex-core`-style hot files.

### 5.2 Persona (32.1, reconstructed) — `persona.ts`

`applyAssistantPersona(options)` appends an assistant+Brief section to `systemPrompt` exactly like
`applyProactivePersona`/`applyCoordinatorPersona` (handles the `undefined`/preset/append-string cases). It is
applied **alongside** `applyProactivePersona` (Kairos runs the proactive loop, so the IDLE-backoff contract
still holds). Reconstructed content (the verbatim CC asset is missing-source):

> You are running as an autonomous scheduled assistant (Kairos mode); no human is watching in real time.
> Report progress, results, and anything the user should see by calling the **SendUserMessage** tool (the Brief
> channel) — plain assistant text is **not** surfaced to the user in this mode. Use `status:"proactive"` for
> messages worth a push; `status:"normal"` otherwise. On a heartbeat tick with nothing useful to do, reply with
> exactly `IDLE` so the loop backs off; never ask the human questions on a tick.

*(The original draft also instructed `CronCreate`/`PushNotification` use; dropped per §0 — those tools are not
relied upon in the core, so the persona does not direct the model to them.)*

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
tick already discards it). `status:"proactive"` is the push-eligibility signal (consumed once push lands in the
follow-up).

### 5.4 Cron poller — DEFERRED (§0)

**Superseded.** The original design specified a `CronPoller`/`CronReader` over `<cwd>/.claude/scheduled_tasks.json`.
Live verification proved native `CronCreate` neither self-fires into a caller-owned headless session nor writes
that durable store from a bare `query()` — so a poller has nothing to read. Calendar scheduling is deferred to
a harness-owned scheduler (parse 5-field cron + timer + `submit`) in a follow-up sub-project. The core's
scheduled-wake behavior is the **proactive heartbeat** (§4).

### 5.5 Safety posture — `safety.ts`

```ts
resolveAssistantPosture(config?: { permissionMode?: string; allowBypass?: boolean; denyTools?: string[] })
  -> { permissionMode: string, disallowedTools?: string[] }
```

Always resolves to `permissionMode: 'auto'` unless the caller explicitly escalates. If the embedder/CLI asks
for `bypassPermissions` **without** `allowBypass: true`, it is refused (throw) — autonomous mode never silently
runs unguarded. `denyTools` (empty default) maps to `disallowedTools` for users who want to hard-pin specific
irreversible ops, documented as footgun-mitigation, **not** a boundary. For untrusted contexts, run with the
existing `sandbox` config. (CLI adds a second layer: `--allow-bypass` also requires `KAIROS_ALLOW_BYPASS=1`.)

### 5.6 Orchestrator — `assistant.ts`

```ts
export interface KairosConfig {
  cwd?: string; model?: string; sink?: BriefSink;
  proactive?: ProactiveConfigInput; posture?: { permissionMode?: string; allowBypass?: boolean; denyTools?: string[] };
}
export class KairosAssistant {
  constructor(deps: { query: QueryFn }, config?: KairosConfig);
  start(seedPrompt?: string): Promise<void>;   // spawn session, optional seed submit, start proactive loop
  status(): { sessionId?: string; proactive?: ProactiveStatus };
  stop(): Promise<void>;                        // shutdown: stop heartbeat + dispose session; idempotent
}
```

`KairosAssistant` constructs a `DaemonSupervisor({ query }, { sessionOptions, idleTimeoutMs: 0 })` where the
factory builds the **complete** assistant session options (the daemon session is otherwise bare): start from
`{}`, run `applyProactivePersona` + `applyAssistantPersona`, set `cwd`, spread `resolveAssistantPosture(posture)`,
inject `mcpServers: { "cc-brief": createBriefMcpServer(sink) }` plus
`allowedTools: ["mcp__cc-brief__SendUserMessage"]` so the Brief channel itself is never gated by the classifier.
It then `spawn()`s one session, optionally `submit`s a seed, and `startProactive(id, proactive)`. *(Original
text started a `CronPoller` and exposed `cron` config + `status().cron` — deferred per §0.)*

### 5.7 CLI — `cli.ts`

A new `assistant` subcommand (sibling to `daemon`/`ps`/`submit`): `cc-harness assistant [--cwd <dir>]
[--model <m>] [--allow-bypass] ["<seed prompt>"]`. Builds a `KairosAssistant` with `stdoutBriefSink`, `start()`s
it (seed prompt optional), and runs until SIGINT/SIGTERM, on which it `stop()`s cleanly (mirrors `runDaemon`,
with a `stopping` re-entry guard and handlers registered before the running line). The subcommand is the
explicit opt-in; `--allow-bypass` (the only escalation past forced `auto`) additionally requires the
`KAIROS_ALLOW_BYPASS=1` env acknowledgment and prints a warning.

### 5.8 Data flow

```
wake: proactive idle-tick ──► supervisor.submit(id, prompt)   [session: permissionMode 'auto']
                               └─ model works; tool calls auto-gated by the native classifier
                               └─ model calls SendUserMessage ──► BriefSink ──► user (stdout/callback)
                               └─ on idle with no work: model replies IDLE ──► proactive loop backs off
```
*(A second `cron-due` wake source was in the original draft — deferred per §0.)*

## 6. Error handling / liveness

Per [[teardown-liveness-review-pattern]]: `KairosAssistant.stop()` is idempotent and `shutdown()`s in order
(stop the heartbeat loop, then dispose the session); `start()` is not re-entrant. The proactive loop already
owns idle/error backoff and pause-on-human-submit; Kairos does not duplicate it. *(CronPoller liveness tests
deferred with §5.4.)*

## 7. Verification / acceptance

- **Unit (zero-network, DI):** persona append composition (proactive + assistant order, preset creation);
  `BriefSink` stdout + status routing; `resolveAssistantPosture` (default `auto`, refuse `bypass`, `allowBypass`
  escalation, `denyTools`→`disallowedTools`); `KairosAssistant` session-options build + lifecycle.
- **Integration (fake query/supervisor):** `KairosAssistant` builds session options correctly (`permissionMode
  'auto'`, `cc-brief` MCP present + allow-listed, both personas appended); `start`/`stop` lifecycle; the
  heartbeat submits to the one session.
- **Live (real SDK, `.env`):** one assistant tick under `auto` emits a Brief to a captured sink end-to-end.
- `npm run typecheck` clean; the existing unit suite stays green; `npm run build` + `verify:pack` still pass
  with the new exports.

## 8. Success criteria

- `cc-harness assistant` starts a persistent autonomous session under `permissionMode: 'auto'`, self-paces via
  the proactive heartbeat, and surfaces **all** user-facing output through the Brief channel (stdout by default).
- Autonomous mode never runs `bypassPermissions` silently (CLI also gates `--allow-bypass` behind an env ack);
  the denylist is optional/empty; the sandbox is the documented hardening path.
- Clean teardown on signal; unit + integration green; one live `auto`-mode Brief tick verified.
- New `src/kairos/index.ts` exports are added to the public surface without breaking the package build.
- *(Deferred per §0: firing calendar cron wakes and reaching `CronCreate`/`PushNotification` — the Kairos
  scheduling follow-up.)*
