# Daemon Observability Dashboard (`cc-harness top`) — Design

> **Phase 3, increment 1 of 3.** The first slice of the deferred "observability/control UI" frontier
> (coverage.md Domain 10, ~10%). This increment is **read-only**: a terminal dashboard that attaches to a
> running `cc-harness` daemon and renders its live state. The **interactive control TUI** (increment 2) and a
> **Claude-Code-style chat REPL** (increment 3) are explicitly deferred to later specs. Phase 3 is, per
> coverage.md, *"a rendering layer over data Phases 1–2 already produce"* — this spec confirms that and builds
> the first renderer.

## §1 — Goal

Ship `cc-harness top`: a terminal command that attaches to a running daemon over its existing UDS op
protocol and renders an **auto-refreshing, read-only** view of the live session pool — per session: id,
status, model, context-usage %, token usage, age — plus the daemon's proactive-heartbeat state. It polls on
an interval (default 1 s), survives the daemon not being up (waiting state, retried), and restores the
terminal cleanly on every exit path. No control, no navigation, no new library exports.

## §2 — Grounding (verified against source, 2026-06-18)

All wire facts below were read from the daemon, bridge, proactive, and CLI sources — not assumed.

- **The daemon is a separate process with a UDS NDJSON op protocol** (`src/daemon/server.ts`,
  `src/daemon/types.ts`). Each op is **one request per connection** — the server reads a single line then
  `sock.end()`s; there is **no persistent subscribe/stream channel**. This forces a **poll-on-interval** model
  for observability (short-lived connection per refresh). The client helper is
  `daemonRequest(socketPath, op, onLine?): Promise<any[]>` (`src/daemon/client.ts`), which resolves with all
  response lines.
- **The read data the dashboard needs is already on the wire**, except proactive heartbeat:
  - `{ op: "list" }` → `{ ok: true, sessions: SessionRecord[] }`. `SessionRecord` (`src/daemon/types.ts:10`)
    = `{ id, daemonPid, status: "idle"|"busy"|"errored"|"restarting", model?, restart?, sessionId?,
    createdAt, lastActiveAt, restarts? }`.
  - `{ op: "control", id, frame: { type: "context_usage" } }` → `{ ok: true, usage: <getContextUsage
    payload> }` (the bridge wraps the payload under key `usage`, `src/bridge/control.ts:23`).
    `getContextUsage()`'s payload carries token/percent fields (e.g. `percentUsed`, `totalTokens`,
    `maxTokens`) — the dashboard reads them **defensively** (any missing → `—`).
  - `{ op: "usage", id }` and `{ op: "init", id }` exist too but are **not needed for v1** (the
    `context_usage` control frame already yields the percent + tokens the table shows).
- **Proactive heartbeat is the one wire gap.** The supervisor exposes
  `proactiveStatus(id): ProactiveStatus | undefined` (`src/daemon/supervisor.ts:224`;
  `ProactiveStatus = { state: "idle"|"running"|"paused"|"stopped", tickCount, idleCount, errorCount,
  reason? }`, `src/proactive/types.ts:6`), but the op protocol has only `start_proactive` / `stop_proactive`
  — **no read op**. v1 closes this by **enriching the `list` response** (see §4.C), not by adding an op or
  changing `SessionRecord`.
- **Swarm is a different subsystem, not daemon-managed.** `SwarmRuntime` runs in-process in a host app and is
  not registered with the daemon, so a *daemon* dashboard cannot observe it. Swarm is **out of scope** for v1
  (a cross-subsystem view could be a later increment).
- **The CLI already dispatches subcommands** (`src/cli.ts`) and already has a one-shot `ps` that prints
  `{ op: "list" }` as text. `top` is its **live sibling**; `--once` makes `top` ≈ an enriched `ps`. The
  default socket is `daemonSocketPath()` → `~/.claude/cc-daemon/sock`, overridable via `CC_DAEMON_SOCK`
  (`src/daemon/paths.ts`).

## §3 — Scope

**In:** a new CLI subcommand `cc-harness top` and a self-contained `src/monitor/` module (snapshot collector
+ pure renderer + lifecycle loop), plus one surgical enrichment of the daemon `list` response to carry
proactive state, plus unit + integration + one gated live test.

**Out (non-goals):**
1. **Control** — no `interrupt`/`setModel`/`setPermissionMode`/`compact`/`spawn`/`stop` from the UI. v1 is
   read-only. (→ increment 2, interactive control TUI.)
2. **Navigation / drill-down** — no session selection, no per-session detail/message pane. (→ increment 2.)
3. **Chat REPL** — no input composer, streaming message renderers, permission dialogs, or pickers.
   (→ increment 3.)
4. **Swarm view** — swarm is not daemon-observable (§2); excluded.
5. **Persisted-session browser** — `sessions`/`messages` ops exist but browsing transcripts is a later view.
6. **Web / HTTP transport** — terminal only.
7. **Ink / React** — a flat auto-refresh table needs no reconciler; v1 uses a dependency-free ANSI renderer.
   The Ink decision (and a likely separate `cc-harness-tui` package) is deferred to increment 2.
8. **Public API surface change** — `src/monitor/` is **CLI-internal**; it is **not** added to the frozen
   44-export `src/index.ts` barrel. (Expose later when the UI stabilizes.)

## §4 — Design

### 4.A — Architecture & data flow

`cc-harness top` runs a poll loop against a separately-running daemon:

```
cc-harness top [--socket P] [--interval MS] [--once]
  → runMonitor(opts)
      every <interval>:
        collect(client, opts)  ──UDS──▶  daemon
            1× { op:"list" }                          → ListEntry[]  (pool + proactive, §4.C)
            N× { op:"control", id, frame:context_usage } → per-session ctx% + tokens
          → DashboardSnapshot
        render(snapshot, view)  → frame string  → write to alternate screen
      raw stdin:  q / Ctrl-C → quit   ·   p → pause/resume refresh
```

Poll-on-interval is mandated by the wire (§2: one request per connection, no push). "Live" = the refresh
cadence. Default interval 1000 ms.

### 4.B — Components (small, isolated, independently testable)

- **`src/monitor/snapshot.ts`** — the `DashboardSnapshot` type + `async collect(client, opts):
  Promise<DashboardSnapshot>`. **Pure data assembly** over a minimal injected client interface
  (`MonitorClient = { list(): Promise<ListEntry[]>; contextUsage(id): Promise<unknown> }`) so unit tests run
  keyless with canned responses. `collect` issues one `list`, then one `context_usage` per non-errored
  session, and normalizes each into a row. A `context_usage` failure for one session yields `ctx: undefined`
  for that row only — never throws. If the `list` call itself fails (daemon down), `collect` returns a
  snapshot with `daemonUp: false` (it does not throw to the loop).
- **`src/monitor/render.ts`** — `render(snapshot: DashboardSnapshot, view: ViewState): string`. **Pure
  function** → the full-screen frame (header line with daemon up/down + session count + proactive glyph;
  a column-aligned table; a footer with refresh interval + `[p]ause [q]uit` + paused indicator). No I/O →
  snapshot-tested with vitest. Renders three top-level states: populated pool, empty pool ("no sessions"),
  and daemon-down ("waiting for daemon at <path>…").
- **`src/monitor/client.ts`** — `daemonMonitorClient(socketPath): MonitorClient` — the real adapter that
  implements `MonitorClient` via `daemonRequest`: `list()` sends `{op:"list"}` and returns `lines[0].sessions`
  as `ListEntry[]`; `contextUsage(id)` sends the `context_usage` control frame and returns `lines[0].usage`.
  Thin; the transport already exists.
- **`src/monitor/app.ts`** — `async runMonitor(opts): Promise<void>` — owns **all** side effects and
  lifecycle: enter alternate screen + hide cursor; tick on a timer (`collect` → `render` → write); read
  raw stdin for `q`/`p`; and an **idempotent teardown** (restore cursor, leave alternate screen, clear the
  timer, detach/unref stdin, set TTY back to cooked mode) wired to `q`, `SIGINT`, `SIGTERM`, and normal
  return. Injectable seams (clock/`schedule`, `out` stream, `input` stream) mirror the codebase's DI pattern
  so the loop is testable without a real terminal.
- **CLI wiring (`src/cli.ts`)** — a `top` branch parses `--socket` (overrides `CC_DAEMON_SOCK` overrides the
  default), `--interval` (ms), `--once`, builds `daemonMonitorClient(sock)`, and calls `runMonitor`.

### 4.C — The one harness change: enrich the `list` response

To surface the proactive heartbeat **without** adding an op or mutating the persisted `SessionRecord`, the
server's `list` handler attaches each session's live proactive status at response time:

```ts
// src/daemon/server.ts — case "list"
case "list": {
  const entries = this.supervisor.list().map((r) => ({ ...r, proactive: this.supervisor.proactiveStatus(r.id) }));
  send({ ok: true, sessions: entries }); sock.end(); break;
}
```

`ListEntry = SessionRecord & { proactive?: ProactiveStatus }` is added to `src/daemon/types.ts` as an exported
type. `proactiveStatus(id)` already returns `undefined` for sessions with no proactive loop
(`src/daemon/supervisor.ts:224`), so the field is naturally optional. This is **backward-compatible**: the
existing `ps` subcommand reads only `s.id/s.status/s.model` and is unaffected by the extra field.

### 4.D — `--once` and non-TTY

When `--once` is passed, or when `out` is not a TTY (piped), `runMonitor` performs **one** `collect` +
`render` (with `paused`/footer omitted), writes it to stdout without entering the alternate screen, and
returns. This makes `top` scriptable and degrades to a richer `ps` with zero extra code (same pure functions).

### §4 column set (v1)

`id` · `status` (glyph + word: `● busy` / `○ idle` / `⚠ err` / `↻ restarting`) · `model` · `ctx%` (the
context-usage payload's `percentUsed`) · `usage` (that same payload's `totalTokens`, humanized e.g. `12.4k`
— **not** the separate `usage` op) · `age` (now − `createdAt`, humanized). Header carries `daemon: ● up`/`○
down`, `sessions N`, and `proactive ● running` (derived: the highest-priority proactive state across
sessions, priority `running > paused > stopped > idle`; `none` when no session has a loop).

## §5 — Error handling, teardown, edge cases

- **Daemon down / connection refused** → `collect` returns `{ daemonUp: false, … }`; `render` shows the
  waiting frame; the loop keeps ticking and **recovers automatically** when the daemon appears. Launch order
  is irrelevant.
- **Per-session `context_usage` failure** (session errored or raced a teardown mid-poll) → that row's `ctx`
  is `undefined` → renders `—`. One bad session never blanks the frame.
- **Terminal restoration is guaranteed.** Teardown is idempotent and runs on `q`, `SIGINT`, `SIGTERM`, and
  normal return — restoring the cursor, leaving the alternate screen, clearing the interval, and returning the
  TTY to cooked mode. This targets the project's recurring **teardown-liveness** bug class (parked
  timers/handles that leak or wedge on exit) by designing the off-ramp in from the start, with tests for it.
- **`context_usage` on a busy session is safe** — `getContextUsage()` is call-during-stream-safe (verified
  previously: it does not deadlock on a late-bound Query), so polling a `busy` session is fine.
- **Overlapping ticks** — a tick that outlives its interval must not stack. The loop guards with an
  in-flight flag (skip a tick if the previous `collect` hasn't resolved) rather than queuing.

## §6 — Verification (how we prove it before shipping)

Three layers, matching the project discipline (unit DI-keyless + integration + one gated live):

1. **`render` snapshot tests** (vitest, pure, keyless): populated pool, empty pool, daemon-down waiting
   state, a row with an errored session (`ctx —`), and the paused footer. Deterministic via an injected
   clock so `age` is stable.
2. **`collect` unit tests** (keyless, fake `MonitorClient`): assembles rows from canned `list` + `control`
   responses; a per-session `contextUsage` rejection yields `ctx: undefined` for that row only; a `list`
   rejection yields `daemonUp: false`; proactive enrichment is read from `ListEntry.proactive`.
3. **Teardown/lifecycle unit tests** (injected fake `out`/`input`/clock): `q` and a simulated `SIGINT`
   each run teardown exactly once (idempotent), clear the timer, and emit the alternate-screen-exit + show-
   cursor sequences; a tick is skipped while a prior `collect` is in flight.
4. **Keyless integration test over a real UDS socket:** stand up a real `DaemonServer` backed by a
   DI-faked supervisor (canned `list`/`proactiveStatus`/`control`), point `daemonMonitorClient` at the
   socket, and assert one `collect` round-trips the real wire into the expected snapshot — and that the
   enriched `list` carries `proactive`.
5. **One gated live e2e** (`ANTHROPIC_API_KEY`): spawn a real daemon session, run one `collect`, and assert
   the snapshot reflects the live session with a populated `ctx%`/usage. Skips cleanly without a key.

GitHub-Actions note: layers 1–4 are keyless and run in the `cc-to-sdk` CI gate; layer 5 stays manual/local.

## §7 — Testing summary

- **New tests:** `test/unit/monitor-render.test.ts`, `test/unit/monitor-collect.test.ts`,
  `test/unit/monitor-app.test.ts` (lifecycle/teardown), `test/unit/daemon-list-proactive.test.ts` (the §4.C
  enrichment), and `test/live/monitor.e2e.test.ts` (gated).
- **No existing test changes** beyond any assertion that pins the `list` response shape (update to allow the
  added optional `proactive` field).

## §8 — Non-goals (restated)

Per §3: no control, no navigation/drill-down, no chat REPL, no swarm view, no persisted-session browser, no
web transport, no Ink/React, no public-API export. Beyond those: no color theming beyond minimal status
glyphs; no config file (flags + `CC_DAEMON_SOCK` only); no multi-daemon aggregation (one socket per run).
