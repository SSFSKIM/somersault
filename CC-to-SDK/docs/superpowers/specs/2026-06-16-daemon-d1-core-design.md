# Daemon Core (D1) — In-Process Session Host — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** Genuine-gap cluster **33-mode-daemon** (parity targetPhase 2). First sub-project **D1** of the daemon line.
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity cluster 33 rows 33.1 (daemon supervisor), 33.2 (worker spawning — lifecycle half), 33.3 (session-kind PID/registry); the existing in-process multi-session pattern in `src/swarm/` (`SwarmRuntime`, `TeammateSession`, `AsyncQueue`).

> **Genuine gap — verified.** All four cluster-33 rows carry `sdkSurface: (none)`; the bridge notes state "The SDK is a headless library with no daemon/server runtime." A direct grep of `sdk.d.ts` confirms it: the only background surface is **per-session** agent tasks (`background?: boolean`, `BackgroundTaskSummary` — fire-and-forget *within* a query) and `forkSession`/`persistSession`. There is **no long-running daemon, supervisor, OS-process registry, or service host**. We build the daemon ourselves with `query()` as the per-session engine; we must not conflate it with the SDK's in-session background tasks (orthogonal: in-session vs cross-session-process host).

---

## 1. Goal

A long-running `cc-harness daemon` process that hosts a pool of persistent `query()` sessions, exposes them
for `ps`-style listing and lifecycle (spawn / submit / list / stop), reaps idle sessions, and shuts down
cleanly. The SDK-native realization of CC's `claude daemon` (33.1) + session registry (33.3) + lifecycle
(33.1/33.2).

## 2. Premise & scope

CC's daemon is a multi-process supervisor (a supervisor process spawns worker child processes, each with a
PID file). The SDK's `query()` already spawns its own CC subprocess per session, so the **in-process pool**
model is the natural fit: one supervised Node process hosting N logical `query()` sessions — the same shape
`SwarmRuntime` already proves. This sub-project re-composes existing primitives (`AsyncQueue`, the long-lived
`query()` session, a JSON record store) rather than introducing new machinery.

**In scope (D1):** the daemon process, the session pool + lifecycle, the session registry (`ps` foundation),
idle reaping, clean shutdown, a Unix-domain-socket client channel (spawn/submit/list/stop/shutdown), and thin
CLI wiring.
**Deferred:** **D2** — a faithful multi-process worker model + restart policy (33.2 full); **D3** — hosted
services multiplexing (API/MCP/LSP, 33.4, "inferred" confidence). True OS daemonization
(`fork`/`setsid`/`--detach`) — a small follow-up; the MVP daemon runs **foreground** so it stays testable.
Windows named-pipe transport — deferred (UDS only for now; Node `net` makes this a small later change).
**Non-goals:** per-session crash isolation (one process hosts all sessions — a daemon crash takes them all;
that is D2's multi-process job), authentication on the socket (local-user `0o700` dir only).

## 3. Architecture — one supervised process, clients over a UDS

```
   cc-harness ps / daemon stop / submit            (thin CLI = a UDS client)
              │  NDJSON ops over UDS   (~/.claude/cc-daemon/sock)
              ▼
   ┌──────────────────────────────────────────────┐
   │  DaemonSupervisor   (long-lived process)        │
   │   ├─ DaemonServer   (net UDS listener)          │  spawn/submit/list/stop/shutdown
   │   ├─ pool: Map<id, DaemonSession>               │
   │   │     DaemonSession = query() + AsyncQueue    │  (reuses the swarm primitive)
   │   ├─ SessionRegistry (~/.claude/cc-daemon/      │  JSON record per session → `ps`
   │   │     sessions/<id>.json, dir 0o700)          │
   │   ├─ idle reaper (interval) + maxSessions cap   │
   │   └─ SIGINT/SIGTERM → dispose all + unlink sock │
   └──────────────────────────────────────────────┘
              │ each DaemonSession owns one CC subprocess (via query())
```

Every stateful unit takes an **injected `query`** (the `QueryFn` DI seam already used across `swarm/`), so
the whole daemon unit-tests with a fake query and zero network.

## 4. Modules (new `src/daemon/`, mirroring `swarm/`/`tasks/`)

| File | Responsibility |
|---|---|
| `src/daemon/types.ts` *(new)* | `SessionStatus`, `SessionRecord`, `DaemonOptions`, the op-protocol union + zod request shapes, `DaemonError extends Error` |
| `src/daemon/registry.ts` *(new)* | `SessionRegistry`: `register / list / get / remove / reapStale`; JSON record per session under a `0o700` dir; `reapStale` drops records whose `daemonPid` is dead (`process.kill(pid,0)`) |
| `src/daemon/session.ts` *(new)* | `DaemonSession`: long-lived `query()` over `AsyncQueue`; `submit(prompt, onMessage)` streams a turn's messages then resolves; tracks `lastActiveAt`; `dispose()` graceful (close input → in-flight turn finishes) |
| `src/daemon/supervisor.ts` *(new)* | `DaemonSupervisor`: owns pool + registry + reaper + cap; `spawn / submit / list / stop / shutdown`; signal handlers |
| `src/daemon/server.ts` *(new)* | `DaemonServer`: `net.createServer` on the UDS path; parses NDJSON ops, routes to the supervisor, streams responses; stale-socket handling on bind |
| `src/daemon/client.ts` *(new)* | `DaemonClient`: connect to the UDS, send one op, yield NDJSON response lines (for the CLI + tests) |
| `src/daemon/index.ts` *(new)* | public exports |
| `src/cli.ts` *(mod)* | subcommand routing: `daemon` (start supervisor+server), `ps` (list), `daemon stop` (shutdown), `submit <id> <prompt>` |
| `src/index.ts` *(mod)* | export `DaemonSupervisor`, `SessionRegistry`, `DaemonError`, types |

`AsyncQueue` (currently `src/swarm/asyncQueue.ts`) is reused by `DaemonSession`. It is a generic primitive;
import it from `../swarm/asyncQueue.js` (a later refactor may hoist it to a shared `src/util/`, out of scope).

## 5. SessionRegistry (the `ps` foundation, 33.3)

A JSON-file record store, one file per session under `<root>/sessions/<id>.json` (`root` defaults to
`~/.claude/cc-daemon`, dir created `0o700`; overridable for tests via `DaemonOptions.dir`).

`SessionRecord = { id, daemonPid, status: SessionStatus, model?, createdAt, lastActiveAt }`
`SessionStatus = "idle" | "busy" | "errored"`  (stop removes the record rather than retaining a terminal status)

- `register(rec)` / `get(id)` / `list()` (sorted by `createdAt`) / `remove(id)`.
- `reapStale()` — removes records whose `daemonPid` is no longer alive (`process.kill(pid, 0)` throws `ESRCH`).
  Run on daemon **start** to clear records orphaned by a previous crash. In the in-process model every
  session shares the daemon's pid, so a dead daemon ⇒ all its records are stale.

## 6. DaemonSession (one hosted query)

Wraps a long-lived `query()` over `AsyncQueue` (same construction as `TeammateSession`): seed input, run the
read-loop, expose `submit`. Differs from `TeammateSession` only in output — it streams to the requesting
client instead of a coordinator bus, so it is a focused new unit rather than a bent `TeammateSession`.

- `submit(prompt, onMessage): Promise<{ result: unknown }>` — push a user turn; the read-loop forwards each
  SDK message to `onMessage` (the server relays them as NDJSON `chunk` lines); resolve with the turn's
  `result` when it settles. Updates `lastActiveAt` on every message.
- `dispose(): Promise<void>` — close the input queue (in-flight turn finishes), await the read-loop. A
  dead/errored query never rejects teardown (`.catch(() => {})` on the read-loop, as in `TeammateSession`).

## 7. DaemonSupervisor (lifecycle)

Owns `pool: Map<id, DaemonSession>`, the `SessionRegistry`, an idle reaper, and a `maxSessions` cap.

- `spawn({ model? }) → id` — mint an id (`sess-N`), build a `DaemonSession` (inject `query`, pass
  `{ model }`), add to pool, `register` an `idle` record. Throws `DaemonError` past `maxSessions`.
- `submit(id, prompt, onMessage)` — look up the session (throw on unknown id), mark record `busy`, run
  `session.submit`, mark `idle` (or `errored`) when done.
- `list()` → `registry.list()`.
- `stop(id)` — dispose the session, `remove` the record, delete from pool (throw on unknown id).
- `shutdown()` — dispose **all** sessions, clear the registry of this daemon's records, stop the reaper.
- **idle reaper:** an interval (`reapEvery`, default 30 s) stops sessions whose `lastActiveAt` is older than
  `idleTimeoutMs` (default 30 min; `0` disables).

## 8. IPC protocol (NDJSON over UDS)

One JSON request per client connection; the daemon replies with one or more NDJSON lines, then ends the
connection. zod shapes validate every request.

| op | request | response line(s) |
|---|---|---|
| `spawn` | `{op:"spawn", model?}` | `{ok:true, id}` |
| `submit` | `{op:"submit", id, prompt}` | `{type:"chunk", message}` × N, then `{type:"done", result}` |
| `list` | `{op:"list"}` | `{ok:true, sessions:SessionRecord[]}` |
| `stop` | `{op:"stop", id}` | `{ok:true}` |
| `shutdown` | `{op:"shutdown"}` | `{ok:true}` then the daemon exits |

Errors come back as `{ok:false, error}` (e.g. unknown id, cap exceeded, bad op).

## 9. Error handling

- **Bind / stale socket:** on start, if the socket path exists, the server tries to connect; if no live
  daemon answers, it `unlink`s and rebinds; if one does, it refuses to start (single-daemon invariant).
- **Crashed session query:** the read-loop ends; `submit` resolves/throws, the record flips to `errored`
  and is kept for `ps` visibility until `stop`.
- **Client disconnect mid-stream:** the session keeps running (the turn completes); only the stream is lost.
- **Crash recovery:** the next daemon start runs `reapStale()` (dead-pid records) and clears the stale socket.
- **Signals:** `SIGINT`/`SIGTERM` → `shutdown()` (dispose all, unlink socket, clear records) → exit.

## 10. Verification

- **Unit (no network, DI fake query):** `SessionRegistry` (register/list/get/remove + `reapStale` with an
  injected pid-alive predicate); `DaemonSession` (`submit` streams chunks then resolves with the result;
  `lastActiveAt` advances; `dispose` ends the query); `DaemonSupervisor` (spawn registers an `idle` record;
  `maxSessions` throws; `submit` flips busy→idle; `stop`/unknown-id; `shutdown` disposes all + clears
  registry; idle reaper stops a stale session with a fake clock); protocol zod shapes parse/reject.
- **Integration (real UDS, fake query):** start `DaemonServer` on a temp socket, drive `DaemonClient`
  through `spawn → submit → list → stop → shutdown` end-to-end over the actual socket; assert streamed
  `chunk`/`done` framing and that the second daemon bind on the live socket is refused.
- **Live (one cheap test, gated on `ANTHROPIC_API_KEY`):** start a daemon with the real `query`, `spawn` a
  session, `submit` "reply PONG", assert a streamed `done` result contains `PONG`. Proves a real SDK session
  is hosted and driven through the daemon end-to-end.

## 11. Success criteria

- `cc-harness daemon` starts a single long-running process that hosts `query()` sessions and answers
  `spawn/submit/list/stop/shutdown` over a UDS.
- `cc-harness ps` lists live sessions from the registry; records survive client disconnects and are reaped
  when stale (dead daemon pid) or idle past the timeout.
- `submit` streams a turn's messages back to the client and settles with the result.
- `shutdown`/signals dispose every session and remove the socket + this daemon's registry records.
- The whole daemon is DI-testable with a fake query (zero network); one live test proves a real session.
- `tsc --noEmit` clean; `vitest` green; no secret committed; the genuine-gap (no SDK daemon surface) is
  documented and not conflated with the SDK's in-session background tasks.
```
