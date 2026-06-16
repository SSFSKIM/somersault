# Phase 2 C — Proactive Mode (Heartbeat) — Design

**Date:** 2026-06-17
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** Phase 2, track **C** (Proactive), parity cluster **31-mode-proactive**.
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity rows **31.1–31.6** (heartbeat half of the cluster); the D1–D3 `DaemonSupervisor`/
`DaemonSession` streaming-input substrate; the Phase 2 B Bridge (`interrupt`/`setPermissionMode`).

> **Reinterpretation.** Cluster 31 has two distinct products sharing one loop core: an **autonomous
> heartbeat** (31.1/31.2/31.3/31.6 — keep the agent alive between user turns, self-wake on a timer) and a
> **goal-completion loop** (`/goal`, 31.7 — work until a judged condition is met). C builds the **heartbeat**
> first. The goal-loop becomes a second continuation policy on the same core, in a later sub-project.
> **31.5 (terminalFocus autonomy calibration) is out of scope:** a headless SDK has no terminal-focus
> signal, and the parity doc agrees pure-SDK consumers have no focus concept to wire.

---

## 1. Goal

Keep a live streaming session **alive between human turns** and let it **self-wake on a timer** to do
autonomous work, then go quiet when there is nothing useful to do. The runtime is a pacing-and-gating loop
on top of the existing daemon session: on each heartbeat it injects a synthetic user message (a configurable
"tick"), reads the turn's result to decide whether the agent did anything, and reschedules — backing off and
eventually stopping when the agent reports idle, when an error budget is exhausted, or when a hard tick cap
is reached. A human turn auto-pauses the heartbeat and it resumes afterward.

## 2. Premise & scope — verified against the foundation

The daemon already provides everything the heartbeat sits on:

- **`DaemonSession` is a streaming-input loop.** `session.ts:27` opens `query({ prompt: this.input, options })`
  where `input` is an `AsyncQueue<SDKUserMessage>`; a turn is "push a user message, await the result"
  (`submit`, `session.ts:34`). Self-driving = pushing our own synthetic messages instead of a human's.
- **The control levers exist (Phase 2 B).** `interrupt()` and `setPermissionMode()` are guarded delegations
  to the underlying `Query` (`session.ts:55–58`). Pausing an in-flight tick uses `interrupt()` — its first
  load-bearing consumer.
- **The DI pattern to mirror is present.** The supervisor injects `now: () => number` (`supervisor.ts:42`)
  and `scheduleRestart: (fn, ms) => cancel` (`supervisor.ts:47`) so its time-based machinery unit-tests with
  zero real time. `ProactiveLoop` takes the same injected clock + scheduler.

**In scope (C):** a transport-agnostic `src/proactive/` core (a `ProactiveLoop` state machine + config +
default prompts/idle-detector) and a thin daemon binding (`start_proactive`/`stop_proactive` ops; supervisor
coordination; auto-pause around human `submit`).
**Delivered as part of C:** 31.4 (autonomous-work system-prompt section) as an **opt-in spawn append**.
**Deferred / out of scope:** 31.5 terminalFocus (no headless signal); 31.7 `/goal` (the second policy, its
own sub-project); budget-USD caps (count-based `maxTicks` is the MVP ceiling — see §7); non-daemon
transports (the core is transport-agnostic so they can bind later, but C ships only the daemon binding); a
UI for surfacing tick activity (Phase 3).

## 3. Architecture — transport-agnostic core + daemon binding

Mirrors `src/bridge/` exactly: a pure core that knows nothing about sessions or networks, plus a thin daemon
binding. The core depends on **nothing** in `src/daemon/`; the daemon depends on the core.

```
src/proactive/ (NEW)
  types.ts    ProactiveConfig, ProactiveStatus, ProactiveDeps (the injected seams)
  loop.ts     ProactiveLoop — the pacing/gating state machine (the only stateful unit)
  prompts.ts  DEFAULT_TICK_PROMPT, defaultIdleDetector, AUTONOMOUS_SECTION + applyProactivePersona (31.4)
  index.ts    re-exports

src/daemon/ (EXTEND)
  types.ts      daemonOp += startProactiveOp { op:"start_proactive", id, config? }
                            + stopProactiveOp  { op:"stop_proactive",  id }
  server.ts     route "start_proactive" → supervisor.startProactive; "stop_proactive" → supervisor.stopProactive
  supervisor.ts startProactive(id,cfg) / stopProactive(id); wrap submit() with pause/resume;
                stop loops before dispose in stop()/shutdown(); skip proactive sessions in reapIdle()
```

## 4. Modules

| File | Change |
|---|---|
| `src/proactive/types.ts` *(new)* | `ProactiveConfig`, `ProactiveStatus`, `ProactiveDeps`; the `proactiveConfig` zod schema used by the `start_proactive` op (all fields optional, defaulted). |
| `src/proactive/loop.ts` *(new)* | `ProactiveLoop` — the four-state machine (`idle → running ⇄ paused → stopped`), tick algorithm, control surface (`start`/`pause`/`resume`/`stop`/`status`/`done`). Never throws out of a tick. |
| `src/proactive/prompts.ts` *(new)* | `DEFAULT_TICK_PROMPT`, `defaultIdleDetector`, `AUTONOMOUS_SECTION`, `applyProactivePersona(options)` (31.4, mirrors `applyCoordinatorPersona`). |
| `src/proactive/index.ts` *(new)* | re-exports. |
| `src/daemon/types.ts` *(mod)* | add `startProactiveOp`/`stopProactiveOp` to the `daemonOp` discriminated union; import `proactiveConfig`. |
| `src/daemon/server.ts` *(mod)* | `case "start_proactive"`/`case "stop_proactive"` → supervisor → `send(response); sock.end()`. |
| `src/daemon/supervisor.ts` *(mod)* | `proactive` map; `startProactive`/`stopProactive`/`runProactiveTurn`; `submit` pause/resume wrap; loop teardown in `stop`/`shutdown`; `reapIdle` skip. |

No `client.ts` change required (the existing `daemonRequest` sends any op and returns response lines); a
typed convenience wrapper is optional, not required for C.

## 5. The `ProactiveLoop` core

A four-state machine; everything stateful lives here, everything external is injected.

```ts
interface ProactiveDeps {
  runTurn: (prompt: string) => Promise<{ result: unknown }>;  // daemon passes a session.submit wrapper
  now: () => number;                                          // clock
  schedule: (fn: () => void, ms: number) => () => void;       // returns a cancel (mirrors scheduleRestart)
  idleDetector: (result: unknown) => boolean;                 // "did this tick do nothing?"
  interrupt?: () => Promise<void>;                            // bridge.interrupt — pause an in-flight tick
}

interface ProactiveConfig {
  tickPrompt: string;            // default DEFAULT_TICK_PROMPT
  intervalMs: number;            // base cadence (default 60_000)
  maxTicks?: number;             // hard cap; undefined → rely on idle/error stop
  idleBackoff:  { factor: number; maxIntervalMs: number; stopAfterIdle: number };   // default {2, 900_000, 3}
  errorBackoff: { factor: number; maxIntervalMs: number; stopAfterErrors: number }; // default {2, 300_000, 5}
}

type ProactiveState = "idle" | "running" | "paused" | "stopped";
interface ProactiveStatus { state: ProactiveState; tickCount: number; idleCount: number; errorCount: number; reason?: string; }
```

**Tick algorithm** (never throws out of a tick — mirrors the bridge's never-throw discipline):

```
tick():
  if state !== "running": return
  if maxTicks != null && tickCount >= maxTicks: stop("maxTicks"); return
  this.inFlight = runTurn(tickPrompt)                 // track the promise for clean teardown
  try:
    result = await this.inFlight; tickCount++
    idle = idleDetector(result)
    idleCount = idle ? idleCount + 1 : 0; errorCount = 0
    if idleCount >= idleBackoff.stopAfterIdle: stop("idle"); return
    delay = idle ? min(intervalMs * idleBackoff.factor ** idleCount, idleBackoff.maxIntervalMs) : intervalMs
  catch e:
    errorCount++
    if errorCount >= errorBackoff.stopAfterErrors: stop("error"); return
    delay = min(intervalMs * errorBackoff.factor ** errorCount, errorBackoff.maxIntervalMs)
  finally:
    this.inFlight = undefined
  if state === "running": this.pending = schedule(() => this.tick(), delay)   // self-reschedule
```

**Control surface:**

- `start()` — `idle → running`; schedules the first tick at `intervalMs`. Idempotent (no-op if not `idle`).
- `pause()` — `running → paused`: cancel `pending`; if a tick is in flight, `await interrupt?.()` so it
  yields promptly. Idempotent. (The in-flight tick still resolves; its `if state==="running"` guard then
  refuses to reschedule.)
- `resume()` — `paused → running`: reschedule at base cadence. Idempotent (no-op if not `paused`).
- `stop(reason)` — `→ stopped` (terminal): cancel `pending`, set `state="stopped"` + `reason`. `done`
  resolves once any in-flight tick drains. Idempotent (double-stop keeps the first reason).
- `status(): ProactiveStatus` and `done: Promise<void>` (resolves when no timer is pending and no tick is in
  flight after stop).

**Liveness/teardown ([[teardown-liveness-review-pattern]]).** The dangerous moment is `stop()` *while a tick
is awaiting `runTurn`*. Handled without a race: `stop()` flips `state` synchronously; the awaiting tick's
`if state === "running"` guard refuses to reschedule, so it settles instead of leaking a timer or hanging.
`done` lets the daemon `await` a clean drain (same shape as `DaemonSession.dispose()` awaiting `this.done`).

## 6. Daemon binding & the pause/resume coupling

Supervisor gains `private proactive = new Map<string, ProactiveLoop>()` and:

```ts
startProactive(id, cfg): ProactiveStatus            // mirrors control() lookup (supervisor.ts:97)
  session = pool.get(id); if (!session || session.isEnded()) → DaemonError (missing/dead)
  if (proactive.has(id)) → DaemonError(`session ${id} already proactive`)
  loop = new ProactiveLoop(resolveConfig(cfg), {
    runTurn:  (p) => this.runProactiveTurn(id, p),
    now:      this.now,
    schedule: this.scheduleRestart,                 // reuse the injected scheduler
    idleDetector: defaultIdleDetector,
    interrupt: () => session.interrupt(),           // ← bridge.interrupt
  })
  proactive.set(id, loop); loop.start(); return loop.status()

async stopProactive(id): { ok: true }
  loop = proactive.get(id); if (!loop) → DaemonError(`session ${id} is not proactive`)
  await loop.stop("stopped"); proactive.delete(id); return { ok: true }

private runProactiveTurn(id, prompt): Promise<{ result: unknown }>
  session = pool.get(id); if (!session || session.isEnded()) throw new DaemonError(...)  // loop catches → backoff
  return session.submit(prompt, () => {})           // tick output discarded; result drives idleDetector
```

**Human submit auto-pauses the heartbeat:**

```ts
async submit(id, prompt, onMessage):
  const loop = this.proactive.get(id);
  if (loop) await loop.pause();                     // interrupts any in-flight tick so the human isn't stuck behind it
  try { ...existing submit body unchanged (supervisor.ts:84–92)... }
  finally { if (loop && loop.status().state !== "stopped") loop.resume(); }
```

**Lifecycle safety.** `stop(id)` and `shutdown()` must `await loop.stop()` **before** `session.dispose()` —
otherwise the loop keeps submitting into a disposed session. `reapIdle()` skips sessions with an active loop
(`!this.proactive.has(id)` in the stale filter, `supervisor.ts:131`), so a ticking session is never
idle-reaped even when idle-backoff has stretched its interval past the reap timeout.

The `start_proactive`/`stop_proactive` ops are one-op-per-connection like every daemon op, so a driver can
`stop_proactive` (or human-`submit`) on a second connection while ticks run on the session.

## 7. Defaults, the 31.4 autonomous content & error-backoff

`src/proactive/prompts.ts`:

- **`DEFAULT_TICK_PROMPT`** — the injected heartbeat:
  `"<heartbeat> Autonomous tick — no human is waiting. If there's a concrete next step toward the current
  goal, take it now. If there's nothing useful to do, reply with exactly IDLE and nothing else."`
- **`defaultIdleDetector(result)`** — `String(result).trim().toUpperCase() === "IDLE"`. Overridable per loop.
- **`AUTONOMOUS_SECTION` + `applyProactivePersona(options)`** (this is **31.4**) — a `systemPrompt` append
  with standing autonomous-work instructions, mirroring `applyCoordinatorPersona` (`coordinator.ts:35`).
  **Opt-in at spawn, not at `start_proactive`** — `systemPrompt` is fixed at session creation. *Verified
  against `sdk.d.ts`: the `Query` runtime control surface exposes only `setPermissionMode`/`setModel`/
  `setMaxThinkingTokens`/`setMcpServers` — there is no `setSystemPrompt`/`appendSystemPrompt` mutator, and
  `systemPrompt` is a creation-time-only option.* A caller who intends proactivity spawns the session with
  this append via the existing `sessionOptions`; the per-tick instruction rides the tick prompt regardless.
  This delivers 31.4's content without coupling `start_proactive` to session re-creation.

**Why `maxTicks` (count) over budget-USD for the MVP ceiling.** `DaemonSession.submit` resolves only the
result *string* (`session.ts:72`), not the `SDKResultMessage`'s `total_cost_usd` — a budget cap would need
threading cost through the whole submit path. Count-based `maxTicks` + idle-auto-stop is deterministic,
testable with a fake clock, and YAGNI-correct; budget-USD is a noted future extension.

**Error-backoff (31.6)** is in the loop, not separate machinery: `runProactiveTurn` rethrows on a
dead/erroring session → the loop's `catch` grows `errorCount`, backs off exponentially, and stops after
`stopAfterErrors`. A session that ends mid-heartbeat throws `"not running"` → counts as an error → bounded
stop.

## 8. Error handling

- Unknown/malformed op or config → rejected at the `daemonOp`/`proactiveConfig` zod boundary (the server's
  existing `bad request` path), never reaching the supervisor.
- `start_proactive`/`stop_proactive` on a missing/dead session → `DaemonError` from the supervisor (same
  shape as `submit`/`control`).
- `start_proactive` on an already-proactive session → `DaemonError` (stop first; explicit over implicit).
- A tick's `runTurn` rejecting (session error, dead session) → caught in the loop → error-backoff → bounded
  stop. The loop never throws out of a tick.
- `stop`/`shutdown` racing an in-flight tick → settles via the `done`-drain + state-guard (§5).

## 9. Verification

- **Unit — loop core** (fake `runTurn`, manual clock/scheduler; zero network):
  - a tick fires every `intervalMs` and injects `tickPrompt`; `runTurn` receives `tickPrompt`.
  - a non-idle result keeps `idleCount` at 0 and the delay at `intervalMs`.
  - consecutive idle results grow `idleCount`, back the interval off by `factor**idleCount`, and stop with
    reason `"idle"` after `stopAfterIdle`.
  - `maxTicks` stops with reason `"maxTicks"` after N ticks.
  - `pause()` cancels the pending tick and (if in flight) calls `interrupt`; no further ticks until
    `resume()`, which reschedules.
  - `runTurn` rejecting grows `errorCount`, backs off, and stops with reason `"error"` after
    `stopAfterErrors`.
  - **[[teardown-liveness-review-pattern]] (written first):** stop-while-idle; stop-while-tick-in-flight
    (`done` resolves, no reschedule after the tick drains); double-stop idempotent (first reason kept);
    pause-then-stop.
- **Unit — daemon binding** (fake `query`):
  - `startProactive` on an unknown/dead id → `DaemonError`; a second `startProactive` → `DaemonError`.
  - `submit` pauses then resumes the loop (assert call order); no `resume` if the loop self-stopped during
    the human turn.
  - `stop(id)` and `shutdown()` stop the loop before `dispose` (no `submit` after dispose; `loop.done`
    resolved).
  - `reapIdle()` skips a session with an active loop.
  - `start_proactive`/`stop_proactive` parse through the `daemonOp` zod union.
- **Live (one test, gated on `ANTHROPIC_API_KEY`):** spawn a session; `start_proactive` with a short
  interval and the default tick prompt → with no task the model replies `IDLE` → assert the loop reaches
  `stopped` with reason `"idle"` within a few ticks (proves real ticks + idle detection + bounded auto-stop
  end-to-end); and that a concurrent human `submit` pauses then resumes it.

## 10. Success criteria

- A driver can `start_proactive` a live daemon session and the agent self-wakes on the configured cadence,
  injecting the tick prompt each beat over the existing UDS-NDJSON transport.
- The heartbeat **goes quiet on its own**: consecutive idle ticks back the interval off and stop the loop;
  `maxTicks` and the error budget are hard ceilings.
- A human `submit` auto-pauses the heartbeat (interrupting any in-flight tick) and it resumes after the turn.
- `stop_proactive`, `stop(id)`, and `shutdown()` tear the loop down cleanly — no submit into a disposed
  session, no leaked timer, no hang (`done` drains).
- The `src/proactive/` core is transport-agnostic and unit-testable with a fake (no daemon, no network); the
  daemon is one binding.
- 31.4's autonomous section ships as opt-in spawn content; 31.5 is documented as out of scope.
- D1–D3 and Phase 2 B behavior is unchanged when no `start_proactive` op is sent.
- `tsc --noEmit` clean; `vitest` green (all prior + new proactive tests); no secret committed.
