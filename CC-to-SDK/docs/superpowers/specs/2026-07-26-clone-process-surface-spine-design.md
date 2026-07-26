# Clone spine — process & surface architecture (Goal A) — design

## Purpose

Make `ccx` a single binary in which **interactive, headless, and fleet are three arrangements of one
process model**, so that the doperpowers agent system — which drives durable background sessions
through `claude --bg` / `agents` / `attach` / `stop` / `rm` — runs on our binary, and so that a human
can attach a full REPL to any running session and detach again without killing it.

This is the spine of the clone track (`docs/parity/clone-roadmap.md`). It replaces that document's
C1–C4 sequencing with a single coherent architecture, and it supersedes the roadmap's F2/F3 findings
where they conflict (see **Surprises & Discoveries**).

**North star, as stated by the project owner (2026-07-25):** the **CC-compatible control plane must be
high-fidelity, because that UX is itself excellent** — all slash commands, subagent view, background
shell view/control, answering `AskUserQuestion`. Our harness superset is layered *on top of* that
compatible layer, never in place of it. Surface compatibility is leverage, not imitation: it is how we
inherit an existing ecosystem (doperpowers) for free.

## Goal boundary

This spec is **Goal A only** — the process/surface spine. It was split from Goal B during
brainstorming because B is independent of the process model and improves local sessions immediately.

| | In this spec |
|---|---|
| **Goal A — spine** | one binary + CC argument grammar · `--bg` / `--detachable` detached sessions · `ccx agents` fleet view · `ccx attach` with a full REPL | ✅ |
| **Goal B — control plane fidelity** | `AskUserQuestion` interactive answering · background shells (`Ctrl+B`, list/control) · `ExitPlanMode` approval dialog · subagent view | ❌ separate spec |
| **Goal C — harness superset surfacing** | warm pool, OTel, store, tenant presets exposed through the new CLI | ❌ later |

Goal B's audit result is recorded here because it motivated the split: a `tui/src` sweep found
**zero** references to `AskUserQuestion`, background-shell control (`Ctrl+B` / `BashOutput` /
`KillShell`), or `ExitPlanMode`; subagent support is a `subagentActive` boolean plus nested-line
indentation, not a navigable view. The `tui-ux.md` score of ~82% measures *look-and-feel* and does not
cover control-plane capability at all — B exists to close that, and a control-plane axis should be
added to that scorecard.

## Grounding

Every load-bearing premise below was verified this session against the live SDK or by reading the
locally installed `claude` binary (`~/.local/share/claude/versions/2.1.220`, a Bun-compiled Mach-O
whose JS is greppable). No premise here rests on documentation alone.

| Evidence | What it settled |
|---|---|
| **probe 56** | An SDK-spawned session **self-registers** `~/.claude/sessions/<pid>.json` with `entrypoint:"sdk-cli"`, and unlinks it on exit |
| **probe 56b** | That row **is surfaced by the real `claude agents --json --all`** (our pid 84377 appeared among 38 rows) — interop is the default state, not a feature to build |
| **probe 57** | `CLAUDE_CODE_SESSION_NAME` and `CLAUDE_CODE_SESSION_KIND` passed via the SDK `env` option are **both honored** (`name:"ccx-spike-worker"`, `kind:"bg"`) — we need write no registry state of our own |
| **probe 55** | `usage().rate_limits` is auth-mode-coupled, not bridge-coupled (informs the status bar; not required by this spec) |
| binary: registry write | Every session writes `<pid>.json` at start with `pid`/`sessionId`/`cwd`/`startedAt`/`procStart`/`version`/`peerProtocol`/`kind`/`entrypoint`/`name`, `unlink` on `process.exit` |
| binary: `gB(pid, procStart)` | Liveness compares stored `procStart` against **`LC_ALL=C TZ=UTC ps -o lstart= -p <pid>`**; returns `true` when `procStart` is absent |
| binary: `Jnd(sock)` | Liveness of a peer session = **connect to its socket** (250 ms timeout; `EBUSY` counts as alive) |
| binary: enums | `kind ∈ {interactive, bg, daemon, daemon-worker}` · `status ∈ {busy, shell, idle, waiting}` |
| binary: `claude daemon` | A hidden supervisor command exists (`run`/`status`/`install`/`stop --keep-workers`), started **on demand** by `claude agents` and exiting once workers settle |
| binary: config keys | `leftArrowOpensAgents` ("← opens agents") and `defaultToAgentsView` ("Start in agent view") |

## Architecture

One **Session Host** and one **Client**. The four invocations are arrangements of those two.

**Session Host** — owns an SDK session; exposes it on a UDS socket at a path derived from the session
id; answers status queries; routes permission requests.

**Client** — the existing Ink REPL. It talks to a host through the existing `ChatSession` interface,
whether that host is in-process or across a socket.

| Invocation | Host | Client | Host exits when |
|---|---|---|---|
| `ccx` | in-process | yes | the client exits |
| `ccx --detachable` | forked, detached | yes (may come and go) | the work finishes |
| `ccx --bg "<task>"` | forked, detached | none | the work finishes |
| `ccx attach <id>` | pre-existing | yes | unaffected |

**The default invocation also opens a socket.** The cost is negligible — the UDS machinery already
exists in `daemon/server.ts` — and it buys two things: any session is attachable from another
terminal, and there is exactly one code path. A socket-less fast path would give `ChatSession` two
implementations that drift apart in ways that are hard to reproduce; keeping one path makes every
local run a continuous test of the remote path.

`--detachable` is therefore **not a different process model — it is a termination policy**: "when the
last client leaves, keep running." This reduction is the design's main saving.

**Deliberate asymmetry:** a default `ccx` session can be attached to, but closing its original
terminal ends it, because its host lives in that process. Surviving terminal close requires starting
with `--detachable`. Auto-promotion (keep the host alive if another client is attached) was rejected
as a surprising rule.

## Zero-state fleet

Goal A writes **no fleet state of its own**. Every fact is either derived or asked for live.

```
identity   CLAUDE_CODE_SESSION_NAME / _KIND  → the engine writes the registry row  (probe 57)
socket     /tmp/ccx-$UID/<sessionId>.sock    → derived from session id, never recorded
liveness   connect to the socket             → same trick as the binary's Jnd()
process    compare procStart                 → PID-reuse guard, same as the binary's gB()
status     RPC over that same connection     → the process's present, not a file's past
```

`ccx agents` reads `~/.claude/sessions/*.json`, checks `procStart` liveness, then connects to each live
socket in parallel (250 ms timeout) and asks for status. Because `agents` must connect anyway to know
what is attachable, asking for status costs nothing extra — and there is no stored status that can
disagree with reality.

Two consequences worth stating plainly:

- **There is nothing to reap.** The whole class of orphan/stale-state bugs comes from code that
  deletes dead records; with no records, the class does not exist.
- **The real `claude agents` will not show our park state**, because it does not query sockets. Our
  rows appear with correct name and kind but an empty status column. Accepted.

## Components

**New**

- `harness/src/host/` — `SessionHost`: wraps the lib `Session` and adds
  - `follow(onMessage): Unsubscribe` — broadcast of the live stream to N attached clients
  - permission routing — on `canUseTool`, broadcast to followers; park when there are none
  - `status()` — `busy` / `idle` / `waiting` (+ what it is waiting for)
- `harness/src/fleet/` — registry reader (parse + `procStart` liveness), socket probe, status query.
- `harness/src/cli/` — Claude Code argument grammar → `HarnessConfig`; subcommand dispatch. Every
  supported flag maps to a config field; a recognized-but-unsupported flag **fails loudly** rather than
  silently no-opping (a silently ignored `--permission-mode` in a background worker is a safety bug).
- `RemoteChatSession` — implements `ChatSession` over the socket.

**Changed**

- `ChatSession` gains `follow()` and a permission-request subscription. Today permission requests
  arrive out-of-band through the injected `ui: UiBrokerHandle`; for a remote host they must travel over
  the wire. `useChat`'s logic is otherwise untouched — it receives a different `makeSession`.

**Reshaped / retired**

| Today | After |
|---|---|
| `cc-harness-chat` | `ccx` (default) |
| `cc-harness "<prompt>"` | `ccx -p` |
| `cc-harness-console` | `ccx agents` |
| `cc-harness daemon` / `ps` / `submit` / `top` | retired — there is no supervisor |
| `daemon/server.ts` | **survives**, as a per-session server |
| `daemon/supervisor.ts` + warm pool | out of Goal A; may return as an optional pool in Goal C |

## Data flow — the park → attach → answer loop

The doperpowers scenario end to end:

```
1. daemon-spawn.sh → ccx --bg -n worker-3 --worktree wt "<task>"
2. ccx forks a detached host, prints the short id, exits      ← the parent shell may die
3. host: opens its socket, starts the SDK session
        (CLAUDE_CODE_SESSION_NAME=worker-3, _KIND=bg)          ← engine self-registers
4. the turn runs; canUseTool fires on something policy cannot settle
5. host: no followers → park (hold the promise), state = waiting
6. ccx agents → worker-3 · waiting · Bash(rm -rf build/)
7. ccx attach worker-3 → scrollback replay + follow + the pending dialog, immediately
8. human answers → host resolves canUseTool → turn resumes, state = busy, broadcast to followers
9. Ctrl+Z → the client detaches; the host keeps running
```

**Park is a held promise, not a state machine.** The promise `canUseTool` must return *is* the park;
resolving it is the answer. No park store, no persistence, no reconciliation.

**Multiple clients:** broadcast to all followers, **first answer wins**, the others are told who
answered. Answering is deliberately not locked to one client — a lock whose holder dies would park the
session permanently.

## CLI grammar (Goal A subset)

Mirrors `claude`'s grammar for what this goal covers:

- bare / `-p --print` / `-c --continue` / `-r --resume <id>`
- `--bg --background` · `--detachable` (ours) · `-n --name` · `--worktree <name>` · `--add-dir`
- `--model` · `--permission-mode` · `--effort` · `--settings` · `--mcp-config` · `--agents`
- subcommands: `agents [--json] [--all] [--cwd]` · `attach <id>` · `stop <id>` · `rm <id>`

`stop` ends the turn and keeps the conversation resumable; `rm` deletes the session and its worktree
**when clean** and must work on already-exited sessions. `--resume` is scoped to the cwd's project.

**Identifier resolution.** `attach` / `stop` / `rm` accept, in order: the short id printed by `--bg`,
a full session id, or a session name. Ambiguity across live sessions is an error listing the matches,
never a silent pick — doperpowers addresses daemons by name *and* by uuid, so both must resolve, and a
wrong guess would act on someone else's worker.

**Worktree semantics.** `--worktree <name>` creates or reuses `<repo>/.claude/worktrees/<name>` on
branch `worktree-<name>`, and the session's cwd becomes that path (so its registry row, `--resume`
scoping, and reply reading all follow it automatically). `rm` deletes the worktree only when clean;
a dirty worktree is kept and reported. This mirrors the layout doperpowers' `daemon-spawn.sh` already
assumes, which is why the paths are fixed rather than configurable.

**Scrollback on attach** is read from the persisted transcript via the existing
`getSessionMessages` + `replay.ts` path (shipped in the resume increment), not from a buffer held in
the host. The host therefore keeps no conversation history of its own — consistent with the
zero-state principle — and an attaching client sees the same rendering that `--resume` produces.

## Acceptance (observable behavior)

1. `ccx --bg -n w "<task>"` prints a short id and returns immediately; killing the spawning shell
   leaves the session running.
2. `ccx agents --json` lists that session with `name: "w"`, `kind: "bg"`, and a live status.
3. The **real** `claude agents --json --all` also lists it, with the same name and kind.
4. `ccx attach w` replays the prior conversation, follows the in-flight turn, and renders a pending
   permission dialog if one is parked.
5. Answering in an attached client resumes the session; `Ctrl+Z` detaches and the session keeps running.
6. Two clients attached to one session both see the turn; the first answer wins and the second client
   is told who answered.
7. A default `ccx` session is attachable, and closing its original terminal ends it.
8. `SIGKILL`ing a host leaves a stale socket that the next `ccx agents` treats as dead and unlinks.
9. A recognized-but-unsupported CLI flag exits non-zero with a message naming the flag.
10. `ccx --bg --worktree wt "<task>"` runs in `<repo>/.claude/worktrees/wt` on branch `worktree-wt`;
    `ccx rm` afterwards removes it when clean and refuses — reporting why — when dirty.
11. `attach`/`stop`/`rm` resolve a short id, a full session id, or a name; an ambiguous name exits
    non-zero listing the matches rather than picking one.
12. `ccx stop <id>` ends the turn and leaves the session resumable; `ccx rm <id>` succeeds on a session
    that has already exited.
13. doperpowers' `daemon-spawn.sh`, `daemon-resume.sh`, `daemon-list.sh`, and the `_lib.sh` purge path
    (which calls `rm`) succeed against `ccx` via a `CLAUDE_BIN`-style override, with no other change to
    those scripts.

## Testing

- **Unit** — derived socket path; registry parse + `procStart` liveness; CLI grammar → `HarnessConfig`;
  and the park promise's teardown quartet (settles / does not leak / rejects a duplicate answer /
  survives client loss). Those four are written **before** the implementation — this project's recurring
  bug class is parked promises that hang, leak, or fake-settle on teardown.
- **Integration (no API key)** — a real UDS between a host built on a fake `QueryFn` and a real client.
  This is the center of gravity: attach, follow, park, multi-client, and detach are all verifiable
  without the network, which the existing DI-by-deps pattern already supports.
- **Live (gated)** — survival past parent exit; attach catching an in-flight turn; the real
  `claude agents` listing our bg row correctly.
- **Acceptance** — the doperpowers scripts, per acceptance item 10.

## Non-goals

- A central supervisor, and therefore automatic restart of a dead session — restart belongs to the
  spawner, which is what doperpowers already does.
- Co-registering hand-written registry rows (unnecessary — the engine writes ours).
- Matching the binary's `peerProtocol` wire format; we own both ends of our fleet.
- Goal B's control-plane surfaces and Goal C's harness-superset surfacing.

## Decision Log

| Decision | Rejected alternative | Why |
|---|---|---|
| **Hybrid process model with opt-in `--detachable`** | *Uniform: every session is a supervisor worker, TUI always a client.* | Conceptually cleanest, but every keystroke and render frame crosses IPC, TTY resize/mouse/raw-mode must be proxied, supervisor death takes the whole fleet, and cold start waits on the supervisor. |
| | *Exactly CC's hybrid, no detachable.* | Cheapest and most faithful, but gives up detach/re-attach for interactive sessions — the one part of the owner's vision the hybrid does not already provide. |
| **Supervisor-less: per-session process + per-session socket** | *Mirror CC's central supervisor (on-demand start, `control.sock`, `roster.json`).* | The supervisor's two main jobs — discovery and an attach endpoint — are already solved more cheaply by the registry plus per-session sockets. Cost: Wave 3's warm pool loses its home (deferred to Goal C, not deleted). |
| | *Supervisor-less by default plus an optional pool daemon.* | Two paths to maintain from day one, and the unused path rots. Deferred rather than rejected. |
| **Full REPL on attach** | *Follow + answer only.* | Cheaper and adequate for doperpowers, but the owner's stated surface is "the human-facing surface that comes with the TUI when you attach." Affordable because `ChatSession` is already an interface — a remote adapter plus a follow channel, not a REPL rewrite. |
| | *Read-only follow with a separate `ccx answer` command.* | Simplest and script-friendly, but too thin to call a clone. |
| **Zero-state fleet (derive + probe)** | *Sidecar file per session for our metadata.* | Buys room for park reason / worktree / tenant, at the price of a second file to write, refresh, and reap, plus orphans. Can be added later non-destructively, so there is no reason to buy it now. |
| | *Our own registry with full rows.* | Avoids depending on undocumented env vars, but duplicates the row the engine writes anyway and reimplements what we get free. |
| **The default `ccx` also opens a socket** | *Socket-less fast path for local sessions.* | Two `ChatSession` implementations drift apart in hard-to-reproduce ways; one path makes local runs test the remote path continuously. |
| **Explicit `--detachable`** | *Auto-promote a default session when another client is attached.* | Convenient but surprising — session lifetime would depend on who happened to be watching. |
| **First answer wins across clients** | *Lock answering to the first attached client.* | If the lock holder dies, the session parks permanently. |

## Surprises & Discoveries

- **Our sessions were already in CC's fleet.** Probes 56/56b: because our engine *is* the `claude` CLI,
  SDK-driven sessions self-register and appear in the real `claude agents`. Interop was never a decision
  to make — it was the existing state. This is a structural dividend of wrapping the engine rather than
  reimplementing it: we inherit the surrounding ecosystem without intending to.
- **`clone-roadmap.md` F2 was wrong twice, and this spec supersedes it.** It concluded co-registration
  was "guarded and fragile" after a hand-written registry row failed to appear. The real cause was a
  format bug in the experiment: liveness compares `procStart` against `LC_ALL=C TZ=UTC ps -o lstart=`,
  and the test supplied locale-formatted output (Korean). Worse, the experiment was the wrong shape —
  fabricating a row instead of exercising the real code path. **Lesson: an experiment that mimics the
  production path is not evidence about the production path.**
- **`claude daemon` exists and is undocumented in `--help`.** A full supervisor with
  `run`/`status`/`install`/`uninstall`/`stop --keep-workers`, launchd/systemd installable, but normally
  **transient** — started on demand by `claude agents` and exiting once workers settle. We chose not to
  need one; the lifecycle idea (nothing resident unless work is resident) is worth remembering.
- **`~/.claude/sessions/` is not the whole fleet.** `agents --all` returned more rows than live files
  because completed background sessions come from the supervisor's `roster.json`. Any "read the registry
  and you have the fleet" assumption is incomplete for `--all`.
- **The registry schema already contains agent-coordination vocabulary** we had not planned for:
  `waitingFor`, `needs`, `tempo`, `parkedJobId`, `bridgeSessionId`, and `status: waiting`. Park is a
  first-class concept in CC's model, which is corroboration that Goal A's park design belongs in the
  spine rather than in a later goal.
- **The TUI parity score hid a functional gap.** `tui-ux.md`'s ~82% is a look-and-feel measure with no
  axis for "can a human answer what the model asked." `AskUserQuestion` has no handler at all, so the
  model can call it and the turn proceeds with the human unable to respond — a **silent** capability
  loss rather than an error. This produced the A/B split.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-07-26 — initial spec, from the brainstorming session that reframed the roadmap's three-faces
  framing (interactive / headless / fleet as separate things) into one process model with four
  arrangements. Supersedes `docs/parity/clone-roadmap.md` §3 F2 and §C2.
