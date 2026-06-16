# Daemon D2 — Session Restart Policy (Crash Recovery) — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** Genuine-gap cluster **33-mode-daemon**, sub-project **D2** (builds on D1 in-process host).
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity row 33.2 (worker spawning + restart policy), reinterpreted for the in-process pool chosen in D1; the D1 `DaemonSupervisor`/`DaemonSession`/`SessionRegistry`.

> **Reinterpretation (read the D1 spec).** D1 chose an in-process session pool over CC's multi-process
> supervisor, so 33.2's "worker spawning + restart policy" lands as **session crash recovery**: when a
> session's `query()` dies unexpectedly, the supervisor auto-restarts it. The multi-process worker model
> (separate PID per worker) stays deferred — its marginal isolation is small because each session's LLM work
> already runs in its own CC subprocess via `query()`.

---

## 1. Goal

Close the resilience gap D1 left open: a session whose `query()` dies unexpectedly (network blip, OOM, host
crash) currently goes `errored` and is stuck until `stop`. D2 makes the supervisor detect that and
auto-restart the session per a configurable policy, with exponential backoff and a max-restarts cap.

## 2. Premise & scope

The load-bearing distinction is **intentional vs unexpected** session end. The supervisor disposes sessions
deliberately on `stop`/`shutdown`/`reapIdle`; any *other* end is an unexpected death to recover from. Get
this wrong and `stop()` triggers its own restart — an infinite loop. Everything else (backoff, counting,
status) is bookkeeping around that one invariant.

**In scope (D2):** restart policy (`"no" | "on-failure"`), unexpected-death detection, fresh-session
restart with exponential backoff + max-restarts cap, restart count + `restarting` status in the registry,
the infinite-loop guard.
**Deferred:** **resume-based restart** (restoring conversation history via the SDK's `resume`/`forkSession`
— needs capturing each session's SDK `session_id`; a restarted session is a clean slate for now); named
session "kinds" (a spawn config is passed directly, not via a registered template); D3 shared services;
the multi-process worker model.
**Non-goals:** restarting on *intentional* stop; per-restart history migration; a sliding-window restart
counter (the cap is cumulative).

## 3. Architecture — watch each session's end, discriminate, recover

```
spawn(id, cfg) ─► new DaemonSession ; configs.set(id,cfg)
                  session.done.then(() => handleSessionEnd(id))   ← end hook (read-loop finally)

session.query() dies  ─►  done resolves  ─►  handleSessionEnd(id):
   if shuttingDown || stopping.has(id):  return        ← intentional end, NEVER restart (the invariant)
   if cfg.restart !== "on-failure":      → errored
   restarts = (record.restarts ?? 0) + 1
   if restarts > maxRestarts:            → errored (give up)
   else: → restarting ; scheduleRestart(() => restart(id), backoff(restarts))

restart(id):
   if shuttingDown || stopping.has(id) || !configs.has(id): return   ← stopped during backoff
   pool.set(id, new DaemonSession(id, cfg)) ; → idle
```

`stop(id)`: `stopping.add(id)` → dispose → remove → `stopping.delete(id)`. `shutdown()`: set
`shuttingDown` → clear pending restart timers → dispose all. So every deliberate teardown is flagged before
the end hook can fire.

## 4. Modules (extend D1 files)

| File | Change |
|---|---|
| `src/daemon/types.ts` *(mod)* | `SessionStatus += "restarting"`; `SessionRecord += restarts?: number`; `DaemonOptions += restart?: RestartPolicy, maxRestarts?, backoffMs?, maxBackoffMs?, scheduleRestart?`; `RestartPolicy = "no" \| "on-failure"`; spawn op `+= restart?` (enum) |
| `src/daemon/session.ts` *(mod)* | make `done` a public `readonly` field (the supervisor attaches its end hook to it) — no behavior change |
| `src/daemon/supervisor.ts` *(mod)* | per-session `configs` map; `stopping: Set<string>` + `shuttingDown` flag; `restartTimers` map; attach the end hook in a `makeSession` helper used by both spawn and restart; `handleSessionEnd` + `restart`; clear timers in `shutdown`; `submit` reports the registry status when a session isn't in the pool (e.g. `restarting`) |

No new files. The `scheduleRestart` option defaults to `(fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }`; tests inject a synchronous or capturing scheduler so backoff is deterministic.

## 5. Restart policy & backoff

- **`restart` (default `"no"`):** `"no"` keeps D1 behavior (unexpected death → `errored`). `"on-failure"`
  restarts on unexpected death. (CC's `"always"` is omitted: a long-lived `query()` never ends
  "successfully" on its own, so any unexpected end is a failure — `"always"` would be identical.)
- **Backoff:** `min(backoffMs · 2^(restarts-1), maxBackoffMs)` (defaults `backoffMs=500`, `maxBackoffMs=30_000`).
- **Cap:** `maxRestarts` (default `5`) cumulative. Exceeding it → `errored`, no further restarts.
- **Config source:** daemon-wide defaults in `DaemonOptions`; per-spawn `restart` override via the spawn op.
  `maxRestarts`/backoff are daemon-wide (kept out of the per-spawn protocol to stay lean).
- A restarted session is a **fresh** `query()` with the original spawn config — no conversation history.

## 6. Behaviour during the backoff window

While a session is `restarting`, it is not in the pool. `submit` therefore looks up the registry when the
pool misses and throws a descriptive `DaemonError`: `unknown session <id>` if there is no record, else
`session <id> is <status>` (e.g. `is restarting`). `list()`/`ps` still show the record (status
`restarting`, with `restarts`). After backoff, the fresh session is swapped in and status returns to `idle`.

## 7. Error handling & teardown

- **Infinite-loop guard:** `handleSessionEnd` and `restart` both early-return when `shuttingDown` or
  `stopping.has(id)` — a deliberate dispose can never cause a restart.
- **Stopped during backoff:** `stop(id)` during `restarting` adds to `stopping` and removes the record; the
  pending `restart(id)` fires later but early-returns (id no longer configured / is stopping).
- **Shutdown:** sets `shuttingDown`, clears all pending restart timers, disposes all sessions; end hooks
  fire but early-return. No restart escapes shutdown; no timer leak.
- **Max restarts:** terminal `errored` state; the record is kept for `ps` visibility until `stop`.

## 8. Verification

- **Unit (no network, DI fake query that ENDS to simulate a crash + injected `scheduleRestart`):**
  - `"on-failure"` restarts a dead session: after the fake query ends, a synchronous `scheduleRestart`
    swaps in a fresh session; `submit` then succeeds and the record shows `restarts: 1`, status `idle`.
  - `maxRestarts` exceeded → status `errored`, no further restart.
  - policy `"no"` (default) → dead session stays `errored`, no restart.
  - **the invariant:** an intentional `stop(id)` and a `shutdown()` do **not** trigger a restart (a fake
    query that ends only on dispose; assert the pool/registry stay empty and no new session is created).
  - a `stop` during the `restarting` backoff window cancels the pending restart (no session reappears).
  - `submit` during `restarting` throws `session <id> is restarting`.
- **No new live test:** restart is control-flow exercised precisely by fakes (a real crash is hard to
  trigger cheaply); D1's live test still covers the real-SDK session happy path.

## 9. Success criteria

- A session spawned with `restart: "on-failure"` whose `query()` dies unexpectedly is auto-restarted into a
  working session (fresh history), with exponential backoff and a `maxRestarts` cap, all visible in the
  registry (`restarting`/`errored` status, `restarts` count).
- An intentional `stop`/`shutdown`/idle-reap never triggers a restart (the infinite-loop invariant holds).
- Default policy `"no"` preserves D1 behavior exactly.
- Pending restart timers are cleared on shutdown; no leaks.
- `tsc --noEmit` clean; `vitest` green (all prior daemon + new restart tests); no secret committed.
```
