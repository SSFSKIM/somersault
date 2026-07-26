# Clone spine — process & surface architecture (Goal A) — design

> **Revision 3 (2026-07-26).** Two review rounds. Rev 2 fixed four false or unverified premises from
> rev 1; rev 3 fixes four more that rev 2 introduced or left open — most importantly a default
> ask-policy that would have parked every doperpowers worker. Every load-bearing premise is now backed
> by a probe or a source read (see **Grounding**); the four remaining unknowns are isolated in **Open
> Questions**. Revisions 1 and 2 should not be implemented.
>
> **Revise this spec by targeted edit, never by rewrite.** Rev 2 was a wholesale rewrite and silently
> dropped two contracts it was not trying to change.

## Purpose

Make `ccx` a single binary in which **interactive, headless, and fleet are three arrangements of one
process model**, so that the doperpowers agent system — which drives durable background sessions
through `claude --bg` / `agents` / `attach` / `stop` / `rm` — runs on our binary, and so that a human
can attach a full REPL to any running session and detach again without killing it.

This is the spine of the clone track (`docs/parity/clone-roadmap.md`), replacing that document's C1–C4.

**North star, as stated by the project owner (2026-07-25):** the **CC-compatible control plane must be
high-fidelity, because that UX is itself excellent** — all slash commands, subagent view, background
shell view/control, answering `AskUserQuestion`. Our harness superset is layered *on top of* that
compatible layer, never in place of it. Surface compatibility is leverage, not imitation: it is how we
inherit an existing ecosystem for free.

## Goal boundary

| | |
|---|---|
| **Goal A — spine** (this spec) | one binary + the doperpowers CLI contract · `--bg` / `--detachable` detached sessions · `ccx agents` fleet view · `ccx attach` with a full REPL | ✅ |
| **Goal B — control plane fidelity** | `AskUserQuestion` interactive answering · background shells (`Ctrl+B`, list/control) · `ExitPlanMode` approval dialog · subagent view | ❌ separate spec |
| **Goal C — harness superset surfacing** | warm pool, OTel, store, tenant presets through the new CLI | ❌ later |

Goal B's motivation, recorded here because it drove the split: a `tui/src` sweep found **zero**
references to `AskUserQuestion`, background-shell control (`Ctrl+B` / `BashOutput` / `KillShell`), or
`ExitPlanMode`; subagent support is a `subagentActive` boolean plus nested-line indentation, not a
navigable view. `tui-ux.md`'s ~82% measures *look-and-feel* and has no control-plane axis — one should
be added there.

## Grounding

Every load-bearing premise was verified against the live SDK, the doperpowers scripts, or the installed
`claude` binary (`~/.local/share/claude/versions/2.1.220` — Bun-compiled, so its JS is greppable).

| Evidence | What it settled | Strength |
|---|---|---|
| **probe 56** | An SDK-spawned session self-registers `~/.claude/sessions/<pid>.json`, `entrypoint:"sdk-cli"` | row observed live; **unlink-on-exit is from binary read, not observed** |
| **probe 56b** | That row **is listed by the real `claude agents --json --all`** (our pid among 38 rows) | direct |
| **probe 57** | `CLAUDE_CODE_SESSION_NAME` / `_KIND` via SDK `env` are both honored on the **disk row** | direct; composed end to end into the agents view by **probe 60** |
| **probe 58** | A `canUseTool` decision **can be parked 25 s and answered late**; `options.signal` did not abort; the turn resumed and completed cleanly | direct |
| **probe 58 (secondary)** | `canUseTool` fires **only for tools a rule routes to `ask`** — with no rules everything is auto-approved and there is no human seam | direct, and safety-relevant |
| **probe 59** | A forked session's transcript **physically contains** the parent conversation (marker present, 18 lines), and the child still recalls it **after the parent transcript is deleted** | direct — this is what makes doperpowers' purge-after-resume safe |
| **probe 60** | Env-set identity reaches the **real** `claude agents --json --all`: `name` verbatim, on-disk `kind:"bg"` rendered there as `"background"`. An inherited `CLAUDE_JOB_DIR` absorbs the session into the parent's job row and hides it | direct; closes Open Question 1 |
| doperpowers `_lib.sh` / `daemon-*.sh` | The real CLI contract (below) | direct source read |
| binary: registry write | `<pid>.json` written at start, `unlink` on `process.exit` | source read |
| binary: `gB(pid, procStart)` | Liveness compares `procStart` against `LC_ALL=C TZ=UTC ps -o lstart= -p <pid>`; absent `procStart` ⇒ alive | source read |
| binary: `Jnd(sock)` | Peer liveness = connect, 250 ms timeout, `EBUSY` counts alive | source read |
| binary: enums | `kind ∈ {interactive,bg,daemon,daemon-worker}` · `status ∈ {busy,shell,idle,waiting}` | source read |
| binary: `claude daemon` | Hidden supervisor (`run`/`status`/`install`/`stop --keep-workers`), transient by default | source read |

## The actual integration contract

**This section is normative.** Revision 1 assumed a `CLAUDE_BIN`-style override and a loose flag list;
an audit of `skills/orchestrating-daemons/scripts/` shows neither is right.

**Binary resolution.** The scripts invoke `claude` **bare from `PATH`** — there is no override variable.
doperpowers' own test suite substitutes a stub by **prepending it to `PATH`**. Therefore the integration
mechanism is **PATH shadowing in a scoped environment** (the spawn wrapper's `PATH`, not the user's
login shell), and *optionally* contributing a `CLAUDE_BIN` override to the owner's doperpowers fork.
Adding that override is **in scope for Goal A** if we take that route; it is not a pre-existing seam.
This is safe: the SDK resolves its own engine package-relative, never from `PATH`, so shadowing `claude`
does not recurse.

**Output contract (`daemon-spawn.sh`).** The short id is parsed out of our stdout banner by

```
sed -n 's/.*backgrounded · \([0-9a-f][0-9a-f]*\).*/\1/p'
```

so `--bg` **must** print `backgrounded · <lowercase-hex>` on stdout, with U+00B7 (`·`). The banner must
survive `</dev/null` and `2>&1 |` piping.

**Exactly 8 hex digits is normative, not cosmetic.** The `sed` above accepts one or more, but the purge
path gates on the length: `_lib.sh` runs `[ "${#short}" -eq 8 ]` before `claude rm` and before
`rm -rf ~/.claude/jobs/<short>`. A short id of any other length makes **the entire purge silently
no-op** — superseded turns would accumulate forever with no error anywhere.

**Fleet contract (`_poll_until_done`).** Polls `claude agents --json --all` every 2 s and reads, per row:
`id` (the short id), `sessionId`, `state`, `status`, `cwd`. It finishes when `state ∈ {done, blocked,
error}`, and coerces `state=="working" && status=="idle"` to `done`. A row whose `sessionId` is empty is
treated as not-yet-ready and polling continues. State vocabulary consumed by the scripts:
`working | blocked | done | error | stopped`; status: `busy | idle`. `daemon-finalize.sh` handles
`error|stopped` on one arm (both finalize down the error path), and coerces `done-blocked` to an idle
record — so `stopped` is a state we may emit, not merely one we must tolerate.

**`stopped` is deliberately absent from `_poll_until_done`'s terminal set** (`done|blocked|error`).
That is harmless in the current flow because nothing polls a stopped session — `daemon-resume.sh` stops
the old turn and then polls the *new* short id. Recorded so a future reader does not misfile "the
poller doesn't finish on `stopped`" as a bug in our projection.

**Reply channel.** Replies are read from the **transcript** (`~/.claude/projects/**/<uuid>.jsonl`), not
from stdout. `~/.claude/jobs/<short>` is removed by the purge path.

**Resume model.** `--bg --resume <uuid>` **forks a new turn under a new short id**, carrying the whole
conversation forward; the superseded turn is then purged via `rm`. The conversation must be copied
forward rather than chained by reference, because the purge deletes the parent's transcript —
**verified by probe 59**: the forked child's jsonl physically contains the parent's messages and the
child still recalls them after the parent file is deleted. This is a property of the engine we inherit,
not something Goal A implements; the acceptance test guards against regressing it.

**Pinned to a specific lever:** `ccx --bg --resume <uuid>` **must** use the SDK's
`resume: <uuid>` + `forkSession: true`, which is exactly the path probe 59 exercised. An in-place
resume (same session id, no fork) is outside the verified property and would put the parent's
transcript — which the purge then deletes — back on the critical path.

**Required grammar** (restored — rev 2 dropped this list while rewriting):

| | |
|---|---|
| session shape | `-p/--print` · `-r/--resume <uuid>` · `--bg` · `--detachable` · `--idle-timeout` |
| identity/placement | `-n/--name` · `--worktree <name>` |
| engine config | `--model` · `--permission-mode` · `--effort` · `--settings` |
| subcommands | `agents [--json] [--all] [--cwd]` · `attach <id>` · `stop <id>` · `rm <id>` · `fleet gc` |

**`stop` semantics** (restored — this was in rev 1 and lost in rev 2; `daemon-resume.sh` depends on all
four): it ends the current turn; the session **remains resumable by uuid**; it is removed from the
active fleet view; and it is **idempotent on an already-dead session**. `stop` records roster
`state: "stopped"`, which `daemon-finalize.sh` handles on its `error|stopped` arm.

**`rm` semantics:** deletes the session and its worktree **when clean**, works on already-exited
sessions (resolved from the roster), and is idempotent.

**Not used by the scripts** and therefore out of Goal A's required grammar: `-c/--continue`,
`--add-dir`, `--mcp-config`, `--agents`. `attach` appears only in human-facing guidance, not in script
paths — it remains in scope because the owner requires it, but it is not part of the script contract.

**Addressing.** The scripts address daemons by **short id and full uuid**; name resolution happens in
their own meta files, not through the CLI.

## Architecture

One **Session Host** and one **Client**; the four invocations are arrangements of those two.

| Invocation | Host | Client | Host exits when |
|---|---|---|---|
| `ccx` | in-process | yes | the client exits |
| `ccx --detachable` | forked, detached | yes (may come and go) | explicit `stop`, or idle beyond `--idle-timeout` (default: never) |
| `ccx --bg "<task>"` | forked, detached | none | the task's turn completes |
| `ccx attach <id>` | pre-existing | yes | unaffected |

**The default invocation also opens a socket** — negligible cost, and it keeps exactly one
`ChatSession` code path so local runs continuously exercise the remote one.

**`--detachable` is a termination policy, not a process model.** For `--bg` the host's life is one
task; for `--detachable` an interactive session is idle between turns by nature, so "the work finishes"
is undefined — its host lives until an explicit `stop` or an optional idle timeout.

**Deliberate asymmetry:** a default `ccx` session is attachable, but closing its original terminal ends
it, because its host lives in that process. Auto-promotion was rejected as surprising.

## Fleet state: live is asked for, terminal is recorded

Revision 1 claimed a "zero-state fleet." That was wrong in a way that broke the north star: the engine
**unlinks its registry row on exit**, so a purely live view loses a session the moment it finishes —
and `_poll_until_done` waits for exactly that finished state. Every spawn would have succeeded and then
timed out. The real CLI solves this with a two-layer store (live registry + the supervisor's
`roster.json` of completed sessions); this spec's own Surprises section had noted that and failed to
act on it.

The principle survives in narrowed form:

```
LIVE      — never stored, always asked
  identity   CLAUDE_CODE_SESSION_NAME / _KIND     → the engine writes the registry row (probe 57)
  socket     ~/.claude/ccx/run/<pid>.sock          → derived from the row's pid
  liveness   connect to the socket (250 ms)        → the binary's Jnd() trick
  process    compare procStart                     → PID-reuse guard, the binary's gB() trick
  status     RPC over that same connection         → the process's present, not a file's past

TERMINAL  — recorded, because the past cannot be interrogated
  ~/.claude/ccx/roster/<short>.json
  { short, sessionId, pid, cwd, worktree, kind, name, state, startedAt, endedAt }
```

The roster row is written **at spawn** (so `short` exists before the session id does) and updated on
exit with its terminal `state`. It is the resolution source for `rm` on an already-exited session, the
short↔uuid↔worktree mapping, and `agents --all`.

**Crash projection (normative).** A host that is `SIGKILL`ed never writes its terminal state, so its
roster row is stuck at a non-terminal value. Projecting that verbatim would report `working` forever and
hang `_poll_until_done` to its timeout. The rule follows the live/terminal split rather than adding
another stored field — **state is derived at read time**:

```
roster state is terminal                                                 → project it as-is
roster state non-terminal + pid live (procStart matches) + socket answers → project the live status
roster state non-terminal + pid live (procStart matches) + socket silent  → project the roster state
                                                                            (non-terminal ⇒ "working"),
                                                                            flagged unresponsive
roster state non-terminal + pid dead                                      → project state = "error"
```

The third arm is the hung-host case, and it deliberately does **not** report failure: the process
exists, so we have no evidence it failed, and adjudicating that is the spawner's timeout to make — not
a read command's. (The startup window, before the host has begun listening, is absorbed earlier by the
empty-`sessionId` rule, which the poller already treats as not-yet-ready.) `agents` surfaces the
unresponsive flag so a human can see the difference.

`error` is the honest projection — the session did not finish — and `daemon-finalize.sh` already routes
`error` correctly. The roster row is *not* rewritten during this projection; `agents` stays read-only
and `ccx fleet gc` owns any cleanup.

**Socket keyed by pid, not session id.** Revision 1 derived the socket path from the session id; that is
broken at both ends. `Session._sessionId` is captured from the first `system/init` frame
(`harness/src/session/session.ts`), so it does not exist when `--bg` must already be listening and
printing its banner; and it **rotates** mid-life — `useChat` does `setSession(makeSession(id))` on
`/resume`, which would invalidate the socket name under attached followers. `pid` is immutable for the
host's life and is already in the registry row. (For reference, the real CLI does not derive its path
either — it records `messagingSocketPath` in the row.) Sockets live under `~/.claude/ccx/run/`, not
`/tmp`, because macOS periodically cleans unaccessed `/tmp` files.

**Reaping is reduced, not eliminated.** A `SIGKILL`ed host leaves a stale socket and the engine's row;
a completed session leaves a roster row. `agents` is **read-only** — it reports staleness but never
unlinks, because unlinking races a host that is restarting. A separate `ccx fleet gc` (and a
best-effort sweep on host start) owns deletion.

## Components

**New**

- `harness/src/host/` — `SessionHost`: wraps the lib `Session` and adds
  - `follow(onMessage): Unsubscribe` — broadcast of the live stream to N clients
  - permission routing (below)
  - `status()` → `working|blocked|done|error` + `busy|idle` + what it is waiting for
  - roster write at spawn / update at exit
- `harness/src/fleet/` — registry reader (`procStart` liveness) + roster reader + socket probe + status
  query + row projection into the doperpowers JSON shape.
- `harness/src/cli/` — argument grammar → `HarnessConfig`; subcommand dispatch; the banner. A
  recognized-but-unsupported flag **fails loudly** — a silently ignored `--permission-mode` in a
  background worker is a safety bug. `--permission-mode auto` is model-gated and must resolve or
  report, never silently degrade.
- `RemoteChatSession` — `ChatSession` over the socket.

**Changed**

- `ChatSession` gains `follow()`, a permission subscription, and — critically — **`detach()` distinct
  from `dispose()`** (see permissions below). `sessionId` is a synchronous getter today and is
  `undefined` before the first turn; the remote adapter must model it as such rather than promising a
  value.
- `useChat` reads `listSessions`/`getSessionMessages` from local disk directly, outside the
  `ChatSession` seam. That is harmless while host and client share a machine; the spec records it as a
  known seam leak and a blocker for any future cross-machine attach.

**Reshaped / retired**

| Today | After |
|---|---|
| `cc-harness-chat` | `ccx` (default) |
| `cc-harness "<prompt>"` | `ccx -p` |
| `cc-harness-console` | `ccx agents` |
| `cc-harness daemon` / `ps` / `submit` / `top` | retired — no supervisor |
| `cc-harness assistant` | retired (Kairos persona folds into Goal C or drops) |
| `daemon/server.ts` | **the NDJSON + zod + connect-probe pattern survives (~15 lines); the file does not.** Its 26 ops are supervisor-id-addressed, it is one-shot per connection, and it has no fan-out. `follow()` needs new framing: a long-lived multiplexed connection. |
| `daemon/supervisor.ts` + warm pool | out of Goal A; may return as an optional pool in Goal C |

## Permissions: park is verified, but it inverts a deliberate rule

Probe 58 confirms the mechanism: a `canUseTool` decision held 25 s, `options.signal` never aborted, the
tool then ran and the turn completed. **But the current codebase deliberately does the opposite** —
`uiBroker.ts` denies when no handler is set ("never hang"), `useChat` denies pending on dispose, and
`daemon/permissions.ts` auto-denies at 30 s. So Revision 1's "`useChat`'s logic is otherwise untouched"
was false.

Resolution:

- **Deny-on-lost-UI stays the default for interactive sessions.** It is correct there: a human who
  closed the window is not going to answer.
- **Park is opt-in and `kind`-scoped.** `--bg` / `--detachable` hosts park indefinitely by default,
  because surviving unattended is their purpose.
- **`detach()` ≠ `dispose()`.** Detach must not run the deny path. `Ctrl+Z` (verified unused in our
  keymap) means detach in an attached client; it must not be routed to the existing quit path.
- **Park requires an `ask` policy to exist at all.** Probe 58's secondary finding: `canUseTool` fires
  only for tools a rule routes to `ask`. A bg worker with no rules auto-approves everything and never
  parks — a *safety* outcome, not just a UX one.

  **Priority rule (normative — rev 2 omitted this and it broke the north star).** `daemon-spawn.sh`
  spawns every worker as `--bg --permission-mode auto -n <name>`: unattended auto-approval is the
  intended posture. An unconditional default ask-policy would park each worker at its first tool,
  report `state: "blocked"`, and make `_poll_until_done` return early — reproducing rev 1's failure by a
  different route. Therefore:

  - **Any explicit permission configuration wins.** If `--permission-mode` is given, or settings supply
    permission rules, the default ask-policy is **not applied at all**.
  - **The default applies only to a bare `--bg`** with no permission configuration from any source —
    the case where the alternative is silently approving everything.
  - **Acceptance 9's "no human seam" flag is for that bare case only.** A worker running under an
    explicit `auto` has a policy and must not be flagged.

  In short: we supply a floor for the unconfigured case, never a ceiling over an expressed intent.

## Data flow — spawn → park → attach → answer

```
1. daemon-spawn.sh → PATH-shadowed ccx --bg -n worker-3 --worktree wt "<task>"
2. ccx mints short id, writes the roster row, forks a detached host,
   prints "backgrounded · a1b2c3d4", exits                     ← parent shell may die
3. host: listens on ~/.claude/ccx/run/<pid>.sock, starts the SDK session
        (CLAUDE_CODE_SESSION_NAME=worker-3, _KIND=bg)          ← engine self-registers
4. turn runs; a tool routed to `ask` reaches canUseTool
5. no followers → park (hold the promise, probe 58), state=blocked
6. ccx agents --json --all → {id, sessionId, state:"blocked", status:"idle", cwd}
7. ccx attach a1b2c3d4 → transcript replay + follow + the pending dialog
8. human answers → host resolves canUseTool → state=working → broadcast
9. Ctrl+Z → detach (NOT dispose); host keeps running
10. turn ends → host updates the roster row to state=done, exits, engine row vanishes
11. _poll_until_done sees state=done from the ROSTER and returns
```

**Multiple clients:** broadcast to all, **first answer wins**, others told who answered. Answering is
not locked to one client because a dead lock-holder would park the session forever.

## Acceptance (observable behavior)

1. `ccx --bg -n w "<task>"` prints `backgrounded · <8-hex>` on stdout and returns immediately; the
   banner survives `</dev/null 2>&1 |` piping; killing the spawning shell leaves the session running.
2. `ccx agents --json --all` emits rows carrying `id`, `sessionId`, `state`, `status`, `cwd`, with
   `state ∈ {working, blocked, done, error, stopped}` and `status ∈ {busy, idle}`.
3. **A session that has finished still appears** in `--all` with `state: "done"` — verified by polling
   after exit, which is the exact failure Revision 1 would have shipped.
4. While running, the **real** `claude agents --json --all` also lists the session with the name we
   requested and `kind: "background"` — the view's rendering of the on-disk `kind: "bg"` we set, so the
   test asserts `"background"` there and `"bg"` only on the registry row (probe 60). The spawn path
   must **scrub `CLAUDE_JOB_DIR`** from the child environment: inherited from a parent Claude Code
   agent — which is exactly how doperpowers spawns — it absorbs our session into that parent's job row,
   after which it is findable by neither name, pid, nor session id.
5. `ccx attach <id>` replays the conversation, follows the in-flight turn, and renders a parked
   permission dialog if there is one.
6. Answering resumes the session; `Ctrl+Z` detaches **without denying** the pending permission, and the
   session keeps running.
7. Two attached clients both see the turn; the first answer wins; the second is told who answered.
8. A `--bg` host parks indefinitely on an `ask`-routed tool with no client attached, and `agents` shows
   `state: "blocked"`.
9. ~~A **bare** `--bg` with no permission configuration is reported by `agents` as having no human
   seam.~~ **Retired 2026-07-27** (owner decision, plus probe 64). The background permission posture is
   the SDK's `auto` classifier, and the human seam is summoned by an `ask` rule — which `auto` honours
   just as `default` does. There is no unconfigured-and-therefore-unsafe case left to flag, so both the
   `noHumanSeam` marker and the default ask-policy floor are removed (plan A2a, Task 8). What survives
   is the precedence rule: **any explicit permission configuration wins.**
9b. A host killed with `SIGKILL` mid-turn projects `state: "error"` in `agents --json --all` — not
    `working` — so `_poll_until_done` terminates instead of running to its timeout.
10. A default `ccx` session is attachable; closing its original terminal ends it.
11. `SIGKILL`ing a host leaves a stale socket that `agents` reports as dead **without unlinking**;
    `ccx fleet gc` removes it.
12. `attach`/`stop`/`rm` resolve a short id or a full session id; ambiguity exits non-zero listing
    matches. `rm` succeeds on an already-exited session, resolving it from the roster.
13. `ccx --bg --worktree wt` runs in `<repo>/.claude/worktrees/wt` on branch `worktree-wt`, its
    registry `cwd` is the worktree path, and a `--resume` turn inherits the worktree without repeating
    the flag. `rm` deletes the worktree when clean and **keeps it, saying so, when dirty — while still
    deregistering the session**, because the consumer dirties it on purpose to protect the shared
    checkout (see Revision Notes, rev 3.5).
14. `ccx --bg --resume <uuid>` forks a new short id whose transcript contains the prior conversation,
    and the parent remains removable without destroying that history (probe 59 property; this test
    guards against regression).
15. A recognized-but-unsupported flag exits non-zero naming the flag.
16. `ccx stop <id>` ends the turn, leaves the session resumable by uuid, drops it from the active view,
    records roster `state: "stopped"`, and is idempotent when re-run on the now-dead session.
17. The short id is **exactly 8 lowercase hex** — asserted directly, because `_lib.sh` gates the whole
    purge on `[ "${#short}" -eq 8 ]` and any other length disables it silently.
18. doperpowers' `daemon-spawn.sh`, `daemon-resume.sh`, `daemon-list.sh`, `daemon-reply.sh`,
    `daemon-finalize.sh`, and the `_lib.sh` purge path succeed against `ccx` under PATH shadowing, with
    no change to those scripts.

## Testing

- **Unit** — short-id minting; socket path from pid; registry + roster readers and `procStart`
  liveness; row projection into the doperpowers shape; banner formatting (including the U+00B7 and the
  `sed` round-trip); grammar → `HarnessConfig`; and the park quartet (settles / does not leak / rejects
  a duplicate answer / **survives detach without denying**). Written **before** implementation — parked
  promises that hang, leak, or fake-settle on teardown are this project's recurring bug class.
- **Integration (no API key)** — host on a fake `QueryFn` + real client over a real UDS: attach, follow,
  park, multi-client, detach-vs-dispose, and roster transition on exit.
- **Contract test** — run the real `_poll_until_done` shell function against `ccx agents --json --all`
  fixtures, so the JSON shape is verified by the actual consumer rather than by our reading of it.
- **Live (gated)** — survival past parent exit; attach catching an in-flight turn; the real
  `claude agents` listing our row correctly.
- **Acceptance** — the doperpowers scripts under PATH shadowing (item 16).
- **Measurement, not assumption** — `includePartialMessages` is on by default, so follow fan-out is
  per-token per-client over UDS. Measure before assuming it is free.

## Open questions (resolve during planning)

2. The binary whitelists `kind` to `{bg, daemon, daemon-worker}` and ignores others; with `kind=bg` and
   no `-n`, `name` is `undefined` with no derived fallback. doperpowers always passes `-n`, so this is
   currently harmless — confirm and record.
3. Whether `options.signal` aborts a park on `interrupt()` (probe 58 only proved it does not abort
   spontaneously). Desired behavior is that it does; verify. **Fold in the soak**: "park indefinitely"
   is extrapolated from a 25 s hold, so run one 10 min+ park in the same gated live test to close both
   questions at once.
4. Whether the real `claude stop` / `rm` can act on our rows, which would matter if a user mixes CLIs.
5. A parked permission and an in-flight `AskUserQuestion` both surface as `state: "blocked"`, and
   doperpowers' reply reader parses the question out of the transcript — which a permission park does
   not put there, so it falls back to the last assistant text. Behaviour is acceptable; recorded so it
   is not mistaken for a bug. Goal B may distinguish them once `AskUserQuestion` has a handler.

## Non-goals

- A central supervisor, and therefore automatic restart of a dead session — restart belongs to the
  spawner, which is what doperpowers already does.
- Matching the binary's `peerProtocol` wire format; we own both ends of our fleet.
- Cross-machine attach (blocked by the `useChat` local-disk seam leak, recorded above).
- Goal B's control-plane surfaces and Goal C's harness-superset surfacing.

## Decision Log

| Decision | Rejected alternative | Why |
|---|---|---|
| **Hybrid process model with opt-in `--detachable`** | *Uniform: every session a supervisor worker.* | Cleanest conceptually, but every keystroke and frame crosses IPC, TTY resize/mouse/raw-mode must be proxied, supervisor death takes the fleet, and cold start waits on it. |
| | *Exactly CC's hybrid, no detachable.* | Cheapest and most faithful, but gives up detach/re-attach — the one part of the owner's vision the hybrid lacks. |
| **Supervisor-less: per-session process + per-session socket** | *Mirror CC's central supervisor.* | Discovery and the attach endpoint are solved more cheaply by registry + per-session sockets. Cost: the warm pool loses its home (deferred to Goal C). |
| **Two-layer state: live asked, terminal recorded** | *Zero-state (Revision 1).* | **Reversed by review.** The engine unlinks its row on exit, so a live-only view loses finished sessions — and `_poll_until_done` waits for exactly that state. Every spawn would have timed out. The real CLI's registry+roster split is not incidental. |
| | *Record everything, poll files only.* | Reintroduces stale-status bugs the live layer exists to avoid. |
| **Socket keyed by pid, under `~/.claude/ccx/run/`** | *Derived from session id (Revision 1).* | **Reversed by review.** The session id does not exist when `--bg` must listen (captured from the first `system/init`) and it rotates on `/resume`, invalidating the name under followers. `/tmp` additionally is swept by macOS. |
| **Full REPL on attach** | *Follow + answer only / read-only follow.* | Cheaper and adequate for the scripts, but the owner's stated surface is the full TUI on attach; affordable because `ChatSession` is already an interface seam. |
| **Park opt-in and `kind`-scoped; deny-on-lost-UI kept for interactive** | *Park everywhere (Revision 1).* | **Corrected by review.** Blanket park inverts a deliberate rule (`uiBroker` "never hang", 30 s auto-deny) and would hang interactive sessions whose human has gone. |
| **PATH shadowing as the integration mechanism** | *A `CLAUDE_BIN` override "with no other change" (Revision 1).* | **False premise.** No such variable exists; the scripts call `claude` bare and doperpowers' own tests substitute via `PATH`. Contributing an override upstream is now explicit scope, not an assumption. |
| **`agents` is read-only; a separate `gc` deletes** | *`agents` unlinks stale entries.* | Unlinking races a restarting host, and a read command should not mutate. |
| **First answer wins across clients** | *Lock answering to one client.* | A dead lock-holder would park the session permanently. |
| **Default ask-policy is a floor for bare `--bg` only; any explicit permission config wins** | *An unconditional default ask-policy for `--bg` (rev 2).* | **Reversed by review.** doperpowers spawns every worker `--permission-mode auto`; an unconditional default would park each at its first tool and make the poller return `blocked` early — rev 1's failure by another route. Supply a floor for the unconfigured case, never a ceiling over expressed intent. |
| **Crashed-host state derived at read time** | *Store a heartbeat / rewrite the roster from `agents`.* | A heartbeat adds the stale-state class back; rewriting from a read command races a restarting host. Deriving from `procStart` + socket keeps `agents` read-only. |

## Surprises & Discoveries

- **Our sessions were already in CC's fleet.** Probes 56/56b: because our engine *is* the `claude` CLI,
  SDK-driven sessions self-register and appear in the real `claude agents`. Interop was never a decision
  — a structural dividend of wrapping the engine rather than reimplementing it.
- **…but the registry follows `CLAUDE_CONFIG_DIR`, so our own tenant isolation would have hidden those
  sessions.** Probe 61: a session spawned with `CLAUDE_CONFIG_DIR` set to a fresh directory writes its
  row to `<CLAUDE_CONFIG_DIR>/sessions/<pid>.json` and writes **nothing** under `<HOME>/.claude`
  (observed: `{"pid":77810,…,"entrypoint":"sdk-cli","name":"ccx-probe61-1hjl30"}` in the config dir, no
  row in HOME). Probes 56 and 57 both hard-coded the HOME path and never varied the config dir, so the
  question went unasked — and `tenantHarnessConfig` sets a per-tenant `CLAUDE_CONFIG_DIR` on every
  tenant session. A HOME-only reader would have reported every one of them as *no sessions running*,
  because a missing directory is swallowed into `[]`. `sessionsDir()` now derives from
  `CLAUDE_CONFIG_DIR` first. **Lesson: "the engine self-registers" was verified only at the default
  path; a location premise has to be re-probed under each environment we ourselves create.**
- **`clone-roadmap.md` F2 was wrong, and this spec supersedes it.** It concluded co-registration was
  "guarded and fragile" after a fabricated registry row failed to appear. **Lesson: an experiment that
  mimics the production path is not evidence about the production path.** The *cause* of that failure
  remains a strong hypothesis, not a fact: the liveness check compares `procStart` against
  `LC_ALL=C TZ=UTC ps -o lstart=` and the test supplied locale-formatted output, but the confirming
  re-run (same row, C-locale `procStart`) was never done. Revision 1 stated this as settled; it is not.
- **`canUseTool` is a *rule-gated* seam, not a blanket hook** (probe 58 secondary). It fires only for
  tools an `ask` rule routes to it. A background worker with no policy auto-approves everything, so
  "no human seam" is the default rather than an error state — a safety finding that changes what `--bg`
  must ship with.
- **`claude daemon` exists and is absent from `--help`** — a full supervisor, normally *transient*
  (started on demand by `claude agents`, exits once workers settle). We chose not to need one, but
  "nothing resident unless work is resident" is worth remembering.
- **The registry schema already carries agent-coordination vocabulary** we had not planned for:
  `waitingFor`, `needs`, `tempo`, `parkedJobId`, and `status: waiting`. Park is first-class in CC's
  model, corroborating that it belongs in the spine.
- **The TUI parity score hid a functional gap.** `AskUserQuestion` has no handler at all, so the model
  can call it and the turn proceeds with the human unable to answer — a *silent* capability loss. This
  produced the A/B split.
- **A fix can delete the semantics it was standing on.** Rev 2 was a wholesale rewrite, and three of
  its four new defects were *omissions* rather than errors: the `stop` contract present in rev 1
  vanished, the required-grammar list vanished, and the new ask-policy sentence silently dropped the
  precedence question. The way they were caught was reading the **deletion side** of the rev1→rev2 diff
  rather than re-reading the new text. Rev 3 was therefore applied as **targeted edits, never a
  rewrite** — and that rule now applies to every future revision of this spec.
- **Two of my own "corrections" to the review were wrong, in the same way.** I claimed the 8-hex short
  id was cosmetic because the `sed` accepts one-or-more — but the load is at `_lib.sh`'s
  `[ "${#short}" -eq 8 ]` purge gate, a different line than the one I checked. And I claimed `stopped`
  was absent from the scripts because I grepped for the quoted string; the real occurrence is an
  unquoted `case` arm, `error|stopped)`. **Checking the site you thought of is not the same as checking
  the claim.**
- **Env identity does reach the real agents view — and the probe that proved it failed twice first,
  both times for reasons worth keeping.** Probe 60 composes probes 57 and 56b: a session started with
  `CLAUDE_CODE_SESSION_NAME` / `_KIND=bg` is listed by the real `claude agents --json --all` under the
  name we set, so acceptance 4 is achievable. The two false failures: (1) the view **renders `kind:"bg"`
  as `"background"`** — the on-disk row is `"bg"`, so an end-to-end test must expect a different string
  at each end, and asserting the literal `"bg"` in the view reads as "the whitelist dropped it" when the
  kind was in fact honored (without the variable the same row reads `"interactive"`); (2) an inherited
  **`CLAUDE_JOB_DIR` silently absorbs the session into the parent's job**. A child that declares
  `kind=bg` while that variable is in its environment adopts the parent's `jobId`, the view then renders
  the row from the **job** record — the job's name and state, not ours — and our session is findable by
  neither name, pid, nor session id. This one is not a lab artifact: doperpowers' `daemon-spawn.sh` is
  itself run by a Claude Code agent, so a real `ccx --bg` inherits it. **The spawn path must scrub it.**
- **The real view's live rows carry neither `id` nor `state`.** For our live sdk-cli row the key set is
  exactly `pid, cwd, kind, startedAt, sessionId, name`; the historical rows in the same `--all` output
  carry `id, cwd, kind, startedAt, sessionId, name, state` and no `pid`. So the real binary's own view
  does not satisfy the row contract `_poll_until_done` needs (`id`, `sessionId`, `state`, `status`,
  `cwd`) — `id` and `state` arrive only once a session is job-backed or terminal, and `status` appears
  in neither shape. That contract is ours to satisfy in `ccx agents`; the real view is interop evidence,
  not a template to copy.
- **Three of the review's four critical findings share one root:** Revision 1 adopted "store no state"
  as a slogan and then implicitly denied it in three separate sentences that each needed state
  (completion polling, `rm` on a dead session, socket discovery). A principle stated as an absolute
  invites exactly this failure; the narrowed form — *live is asked, terminal is recorded* — keeps the
  benefit without the contradiction.
- **A rate-limited account is a *complete* test bed for the process surface, and that is worth knowing
  rather than working around.** The whole acceptance run of 2026-07-26 was made on an OAuth subscription
  whose weekly limit was exhausted: every turn's reply was
  `You've hit your weekly limit · resets Jul 29 at 1pm (Asia/Seoul)`. The model did no work at all — and
  every acceptance item still passed, including the doperpowers scripts end to end, because the SDK
  returns that message as a **normal successful result**: `submit()` resolves, the host records `done`,
  the session id materializes, the transcript is written, and `_poll_until_done` terminates. The
  contract under test is the process surface, and the process surface never touches the reply.
  **Lesson: separate what an experiment needs a live model FOR. Here the credential was needed only to
  make a real session exist, not to make it produce anything** — so the limit cost nothing but the
  ability to hold a session open, which is a *second* fact worth writing down: at the limit every turn
  finishes in six to eleven seconds, so any "while it is running" assertion needs a poll loop rather than
  a `sleep`. The task brief's `sleep 5`-then-look shape missed the window on the first attempt.
- **The brief's `CLAUDE_JOB_DIR` diagnostic is a false positive by construction.**
  `grep -q '"jobId"' ~/.claude/sessions/*.json` matches **any** row on the machine, and on a developer
  box every ordinary Claude Code session carries a `jobId` — ten rows matched here while our own spawn
  was demonstrably clean. The scrub can only be checked against *our* row (by name, while the host is
  alive) or, better, functionally: acceptance 4 listing our session under our own name **is** the proof,
  because a session that had adopted the parent's job would render under the parent's identity instead.
- **The `cwd` a caller passes is not the `cwd` it gets back.** `daemon-spawn.sh` was given
  `/tmp/ccx-accept-repo` and its registry meta recorded `/private/tmp/ccx-accept-repo`: the row reports
  the host's `process.cwd()`, which on macOS has resolved the `/tmp` symlink. Correct — that *is* the
  real path, and `renderAgents` already `resolve()`s both sides of `--cwd` — but a consumer that
  string-compares the path it passed against the path it reads back will not match on macOS.
- **macOS `kern.boottime` drifts, and doperpowers' host-identity gate silently disables the purge when it
  does.** In the resume-half acceptance run of 2026-07-26 the first `daemon-resume.sh` forked correctly but
  purged nothing. `_lib.sh` derives `DAEMON_BOOT_ID` from `sysctl -n kern.boottime` and treats a mismatch
  against the meta's recorded value as "this daemon belongs to another host boot", which makes
  `daemon-resume.sh` set `cur_is_local=0` and skip **both** `claude stop "$curshort"` and `_session_purge`.
  The field reported second `1784385968` at 12:25:12 and `1784385966` at 12:26:04 on a machine that never
  rebooted — a two-second correction inside one minute, enough to fail the gate. Our binary was never
  invoked, so this is not a `ccx` defect; but a macOS fleet will intermittently accumulate superseded turns,
  roster rows and transcripts with no error anywhere (`_session_purge`'s `claude rm` is `>/dev/null 2>&1 ||
  true`, and the skip is silent by construction). Re-running with `DAEMON_BOOT_ID` pinned — an override
  `_lib.sh` documents for tests — exercised the purge path immediately and cleanly. **Lesson: an identity
  gate is a liveness dependency; when a consumer's gate can fail on the same host, a passing fork tells you
  nothing about whether the cleanup half ran. Check the effect, not the exit code.**

## Outcomes & Retrospective

**A1 (fleet substrate) shipped 2026-07-26.** Fourteen tasks: the short-id/socket/banner primitives, the
roster and registry readers with `procStart` liveness, `projectRow`, the UDS host and its framed ops, the
`ccx` grammar, detached spawn, `agents`, `stop`/`rm`/`fleet gc`, worktree layout, and the doperpowers
contract tests. **A2 (attach & the human seam) is not built** — `ccx attach` exits 2 with
`attach ships in plan A2`, so acceptance 5–8 and 10 are untouched by this run.

**Pre-flight.** Unit 768/768 green (94 files); contract 7/7 green; `tsc --noEmit` clean; `tsc -p
tsconfig.build.json` clean. One flake, recorded rather than fixed: on the first full-suite run
`fleet-status.test.ts > "gives up on a reply larger than the frame cap"` failed `expected 203 to be less
than 200` — a wall-clock budget asserted under a loaded 94-file parallel run. The same file passed 3/3 in
isolation and the full suite passed on re-run. The assertion is measuring scheduler latency, not the
frame cap; it wants a wider budget or an event-based assertion.

**Acceptance executed by hand against real detached processes** (verbatim output in
`.doperpowers/sdd/task-14-report.md`):

| # | Verdict | Evidence |
|---|---|---|
| 1 | **PASS** | `backgrounded · 2724ec15`, parent returned exit 0 immediately; `od -c` confirms the separator is `302 267` (U+00B7) and nothing else changed. |
| 2 | **PASS** | Observed *while working*: `{"id":"769dd293",…,"sessionId":"","state":"working","status":"busy"}` — all five poller keys present, `sessionId` legitimately empty during the startup window. |
| 3 | **PASS** | After exit the row is still there under `--all` (`state:"done"`, `status:"idle"`, uuid filled in) and correctly absent without `--all`. |
| 4 | **PASS** | The real `claude` 2.1.220 listed it: `{"pid":65337,…,"kind":"background",…,"name":"ccx-accept4"}`. `kind` renders as `background`, as rev 3.3 predicted. |
| 9 (positive half) | **PASS** | The doperpowers worker, spawned by the real script with `--permission-mode auto`, carries **no** `noHumanSeam` on its roster row and ran to `done` without parking. |
| 9b | **PASS** | `SIGKILL` on a live host → `agents` projects `state:"error"`, while the row on disk still reads `working`. State is derived, never rewritten by a read. |
| 11 | **PASS** | The killed host left `run/79554.sock`; `agents` reported the dead row without unlinking it; `ccx fleet gc` printed `removed …/79554.sock`. |
| 12 | **PASS** | `ccx rm 2724ec15` on an already-exited session: exit 0, roster file gone, row gone from the listing. |
| 15 | **PASS** | `ccx --bg --gateway foo "x"` → `ccx: --gateway is not supported by ccx (recognized, deliberately unimplemented)`, exit 2. |
| 17 | **PASS** | The consumer's own `sed` extraction yields `2724ec15`, length 8. |
| 18 (spawn + list) | **PASS** | Unmodified scripts, MD5-identical before and after, `claude` shadowed on PATH: `daemon spawned: ccx-accept  [ff99d9e8 / d69a9632-673d-4168-adb9-79c2b09c2277]  state=done`, then `daemon-list.sh` rendered the row. |

Acceptance 13, 14, 16 and the rest of 18 (`daemon-resume.sh`, `daemon-reply.sh`, `daemon-finalize.sh`,
the `_lib.sh` purge path) were **not exercised** in this run — they were outside its brief, and the
resume-shaped ones are the load-bearing gap, since forking is how doperpowers continues a daemon.

The hand run is now repeatable as `harness/test/live/ccx-fleet.e2e.test.ts` (credential-gated, 2/2 green
in 11.9s): acceptance 1, 2, 3, 12, 17 in one detached lifecycle, and 9b in a second.

**Retrospective.** The design's one genuinely load-bearing decision — *live is asked, terminal is
recorded* — is also the only one that could not have been validated by unit tests, and both of its edges
held under real processes: a finished session stays listed (acceptance 3) and a killed one is not
believed (9b). The two things this run could not settle are the resume/fork half of the doperpowers
contract, and anything that needs a human seam, because A2 does not exist yet.

**Resume half of the doperpowers contract closed 2026-07-26** (verbatim output in
`.doperpowers/sdd/acceptance-resume-half-report.md`). The gap named just above — `daemon-resume.sh`,
`daemon-reply.sh`, `daemon-finalize.sh` and the `_lib.sh` purge path — has now been run by the unmodified
scripts against `ccx` on PATH (all eight script MD5s identical before and after; marketplace checkout
clean). Four daemons, ten turns, four sequential forks of one worktree'd daemon.

| script | verdict | evidence |
|---|---|---|
| `daemon-spawn.sh` | **PASS** | `daemon spawned: ccx-acc  [5403606b / fa9c1a57-…]  state=done  worktree=…/accres (branch worktree-accres)`; `--no-wait` form also passed, once registering `status=working`. |
| `daemon-resume.sh` | **PASS** | Four turns, four distinct shorts and uuids, one stable daemon id; `turns` reached 4. |
| `daemon-reply.sh` | **PASS** | Resolved by post-fork short *and* by stable uuid to the same daemon. |
| `daemon-finalize.sh` | **PASS on `noop` and `done`→`idle`** | `live`, `absent` and `error`/`stopped` were unreachable — see the limitation below. |
| purge (`_session_purge`) | **PASS** | 10 ms watcher: sentinel appears `21:30:39.949`, superseded roster row disappears `21:30:40.025` **while the sentinel is still present and the worktree still `PRESENT`**, sentinel removed `21:30:40.064`. Superseded transcripts deleted too. |

Both fixes under test are confirmed by observation, not inference. **Mid-turn uuid:** a 0.5 s sampler
caught `{"id":"5403606b",…,"sessionId":"fa9c1a57-…","state":"working","status":"busy"}` one second before
the row flipped to `done` — the uuid is reported during the turn, which is what the consumer's 30×2 s
`_poll_uuid` needs. Its second-order effect showed up too: `daemon-spawn.sh --no-wait` registered
`status=working`, which is only possible if the uuid materializes before the turn ends. **Forking:** the
daemon's stable id `fa9c1a57-…` never moved while the current session went `fa9c1a57 → 3a63bf12 →
574c23be → 3ebe9aa0`; since `daemon-resume.sh` guards its purge with `[ "$cur" != "$newuuid" ]`, a
non-forking resume would have made the purge unreachable forever, and the purge did fire.

Two limits bound what this proves. The account's weekly limit was exhausted, so every reply was
`You've hit your weekly limit …` and every turn ended in about eight seconds. Nothing in the process
surface reads replies, so the state machine is genuinely exercised; but no turn was ever still running
when a probe landed, which is why `daemon-finalize.sh`'s `live`, `absent` and `error`/`stopped` arms went
untested. Attempts to force them failed benignly: `DAEMON_TIMEOUT=2` still found the turn already `done`,
and `ccx stop` on an already-`done` row correctly preserved `done` (first-terminal-wins) rather than
reaching `stopped`. The brief's note therefore stands on inspection only — `daemon-finalize.sh` maps
`stopped` to `error`, while `_poll_until_done` terminates on `done|blocked|error` alone, so a session
reaching `stopped` would spin that watcher to its iteration cap.

**The three unreached `daemon-finalize.sh` arms closed 2026-07-27** (verbatim output in
`.doperpowers/sdd/acceptance-finalize-arms-report.md`). The limit had *not* reset — every turn still
ends in about three seconds — but the limit turned out to be the wrong thing to wait for. None of the
three arms tests the model; they test what `daemon-finalize.sh` reads out of the fleet **while a turn
is in flight**. So the turn was held open at the transport layer instead: `ANTHROPIC_BASE_URL` pointed
at a local endpoint that accepts `POST /v1/messages` and never answers. The engine issued a real
109 KB request that never got a reply, so the host was genuinely inside `submit()`, `agents` genuinely
read `state=working status=busy`, and `ccx stop` genuinely landed on a running turn. All eight script
md5s unchanged.

| arm | verdict | evidence |
|---|---|---|
| `live` | **PASS** | probed mid-turn; printed `live` by short id and by stable uuid; meta untouched, `updated` unchanged |
| `absent` | **PASS** | `ccx rm` deregistered a running session; finalize printed `absent` both ways, wrote no reply file |
| `error`/`stopped` | **PASS** | `ccx stop` on a running turn drove the row to `stopped`; finalize printed `error`, finalized the meta with a fresh timestamp, and returned `noop` on the next call |

**This technique generalizes and should be reached for before waiting on quota**: any question about
what the fleet *reports* during a turn — as opposed to what the model *says* — can be answered by
stalling the transport. It cannot manufacture model output, so it does not help the three A2 probes
(62, 63, 63b), which need real assistant text and a real `tool_use`.

Three findings came out of that run.

1. **Ours, Medium — `stop` and `rm` report success over a host that never dies.** When the in-flight
   turn cannot return, `Session.dispose()` (`input.close(); await this.done`) never resolves, so
   `SessionHost.stop()` never reaches `server.close()`, `runHostMain`'s `finally` never returns, and
   the process, its engine subprocess and its listening socket all survive indefinitely. No poller is
   deceived — the terminal roster state is written first — which is exactly what hides it: `agents`
   says `stopped` and `ccx fleet gc` sweeps only sockets that do **not** answer, and this one answers.
   For a session removed with `ccx rm` the roster row is gone too, so nothing names the process any
   more. Fixed in plan A2a, Task 10.
2. **The consumer's, Medium — the two halves of doperpowers disagree about `stopped`.**
   `daemon-finalize.sh` maps `stopped` into its `error` arm, while `_lib.sh`'s `_poll_until_done`
   terminates only on `done|blocked|error`. Now observed, not merely inferred: with a 40 s cap, a
   session stopped 10.7 s in kept the watcher polling a further 40.8 s before giving up — at the
   default `DAEMON_TIMEOUT` of 18000 that is roughly five hours spent polling a dead session. A
   secondary effect: `daemon-spawn.sh` then registers the daemon as `working` on the line right after
   its own banner printed `state=stopped`. Not ours; recorded for an upstream report.
3. **Ours, Low — `blocked` is declared but never assigned.** The projection accepts it and
   `daemon-finalize.sh` has arms for it, but `SessionHost` only ever sets `working`, `done`, `error`
   and `stopped`, so the consumer's whole blocked-reply renderer is dead code against `ccx`. Plan A2a
   Task 5 makes `status()` report it.

**A2's four probes, resolved 2026-07-27** (on a fresh account, after the owner replaced the token).
They were written a day earlier and every verdict came back INCONCLUSIVE under the exhausted limit;
each now gates its verdict on having actually measured something, because the first run of 63 printed
a confident *"interrupt() RELEASES a parked permission"* off a turn that never parked — the exact
false premise this project's live-probe-first discipline exists to prevent. Re-run, they settle four
design questions:

| probe | question | result |
|---|---|---|
| 62 | can an attaching client replay an **in-flight** turn from the engine's on-disk transcript? | **No.** Fourteen samples across a 21.6 s turn all read one message (the user's prompt); it reached three only after the turn ended. The host must keep its own record of the live turn. |
| 62 | how expensive is per-client fan-out with `includePartialMessages`? | **Free.** 61 messages / 30.2 KiB over 21.6 s — 2.8 msg/s, 1.4 KiB/s, 47 of them partial `stream_event`. No coalescing needed. |
| 63 | does `interrupt()` release a parked `canUseTool`? | **Yes.** The request's signal aborted 4.7 s into the park, exactly when `interrupt()` was called. Note the stream then **throws** (`stop_reason=tool_use`) instead of returning a result — so a terminal state must be recorded *before* interrupting. |
| 63b | does a park survive long enough for "indefinitely" to be honest? | **Yes.** Held the full 600 s across ten heartbeats, signal never fired, the tool then ran and the turn completed with `is_error: false`. |
| 64 | does `permissionMode: "auto"` consult `canUseTool` at all? | **Yes — and this corrects our own record.** With an explicit `ask` rule present, `auto` fired the broker exactly as `default` did. `config/types.ts` had `auto` filed as "broker-replacing — verified"; that is wrong for this combination. **What summons the broker is the ask rule, not the mode.** |

Probe 64's result matters beyond the comment it corrects: it means the human seam is reachable in the
posture we actually ship, including doperpowers' `--bg --permission-mode auto` workers, whenever a rule
routes a tool to `ask`. Combined with the owner's decision to keep the `auto` classifier as the
background posture, it also retires the "default ask-policy floor" and the `noHumanSeam` flag
altogether — the flag marked a supported configuration, and its stated reason ("auto-approves
everything") was untrue.

**A2a (attach transport & the human seam) shipped 2026-07-27.** Eleven tasks, 24 commits: the park
registry promoted out of the retiring daemon with a required `expireAfterMs: number | "never"`,
correlation ids and pushed event frames on the host socket, `TurnBuffer`, `SessionHost.follow()` with
late-joiner replay, the kind-scoped park, the six socket ops, `RemoteChatSession`, deletion of the
`noHumanSeam` flag, an integration suite, and a bounded-teardown fix. 839 tests green; typecheck,
build and the keyless-skip guarantee all clean; the consumer contract unmoved.

**Acceptance 8, executed live against a real model** (not simulated through our own broker):

```
$ ccx --bg --permission-mode default --settings '{"permissions":{"ask":["Bash(*)"]}}' -n acc8live \
      "Run the bash command: echo PARKED-OK. Use the Bash tool."
backgrounded · 628c26dd
{"id":"628c26dd","sessionId":"1f5673b1-…","state":"blocked","status":"idle"}   ← 60s, no client
```

Then a `RemoteChatSession` attached *after* the park and was replayed `["message"×10,
"permission:Bash", "state"]` — the late-joiner sequence Tasks 4, 9 and 10 built; `pending()` returned
the real input `{command:"echo PARKED-OK"}`; answering `allow_once` resumed the turn, which finished
`done`. **Spawn → park → attach → answer → done, end to end.** Acceptance 7 is covered by the
integration suite. Acceptance 5, 6 and 10's client halves stay deferred: `attach`, foreground `ccx`
and `--detachable` all still exit 2 naming the missing client.

**What the process caught, and where.** Per-task reviews found the usual crop, but the two that
mattered most were found by the two mechanisms that read *across* tasks:

- The **integration suite**, the first thing to route `follow()` through a real socket, found that a
  late joiner was replayed the buffered turn but **not the parked permissions** — so a client
  attaching after a park never learned of it through the live stream. No task owned that seam: the
  task that built `follow()` predated the registry, and the task that built the registry never
  mentioned replay.
- The **final whole-branch review** found a Critical the eleven per-task reviews could not: the socket
  `prompt` gate asked `status().status`, which is `idle` while parked, so the gate was open for the
  whole duration of a park. A prompt arriving then re-entered `runTask`, wiped the in-flight turn, and
  let turn one's completion finalize the roster `done` while turn two ran. **The plan authored it** —
  its comment said "the busy check is the host's" while the code two lines below asked the consumer
  projection.

**Carried into A2b, deliberately unbuilt:** `runHostMain` still stops an interactive host after its
initial turn, so no idle host can yet take a second turn over the socket; event fan-out has no write
backpressure; the interactive deny rule counts *followers*, so a client that connects without
following is invisible to it; and a live interactive host will report `state:"done"` between turns
once such hosts stay alive.

## Revision Notes

- **2026-07-26 rev 3.5 (final review) — acceptance 13's dirty-worktree clause was normatively wrong and
  is inverted.** It said `rm` must *refuse* when the worktree is dirty. The consumer requires the
  opposite: `_session_purge` in doperpowers' `_lib.sh` deliberately writes a `.daemon-turn-live` sentinel
  into the worktree *before* calling `rm`, precisely because the real CLI's `rm` keeps a dirty worktree
  while still deregistering the session — that is how a worktree'd daemon retires a superseded turn
  without deleting the checkout every later turn still runs in. Against a refusing `rm` the whole command
  fails, so every worktree'd daemon leaks its first-turn roster row permanently, which then also makes
  the daemon's name ambiguous and breaks `stop`/`rm` by name. `rm` now unlinks the roster row and keeps
  the worktree, reporting on stderr what was kept and why. Unchanged: `rm` still never deletes a worktree
  `git worktree remove` refused, which is what protects a main checkout.
- **2026-07-26 rev 3.4 (planning drift)** — acceptance 9 requires `agents` to *report* the
  no-human-seam condition, but no wire carrier was ever named. The projected row gains an optional
  `noHumanSeam?: boolean`, set when a bare `--bg` ran with no permission configuration from any source.
  This does not touch the doperpowers contract: its poller reads named keys with `.get()`, so extra
  keys are inert.
- **2026-07-26 rev 3.3 — Open Question 1 closed by probe 60: PASS.** Env-set identity does reach the
  real `claude agents --json --all` — our `name` verbatim, and `kind:"bg"` surfaced there as
  `"background"` — so acceptance 4 stands, with its assertion pinned to the rendered value. Two
  corrections came out of the run and are recorded in Grounding, acceptance 4, and Surprises: the
  `bg`→`background` rendering, and the requirement that the spawn path **scrub `CLAUDE_JOB_DIR`**, since
  inheriting it from a parent Claude Code agent absorbs our session into that agent's job row and hides
  it from the view entirely. Also recorded: the real view's live-row key set is
  `pid, cwd, kind, startedAt, sessionId, name` — no `id`, no `state`, no `status`.
- **2026-07-26 rev 3.2 (planning)** — Goal A is implemented as **two plans**, split where the state
  owner changes: **A1 (fleet substrate)** owns process/registry/roster state and is verified by the
  doperpowers scripts; **A2 (attach & the human seam)** owns interaction state and is verified by TUI
  tests. A1 delivers acceptance 1–4, 9, 9b, 11–18; A2 delivers 5–8 and 10. A2 is written after A1
  lands, because `follow()`'s framing depends on A1's transport.
  **One staged divergence, recorded so it is not read as a spec violation:** the default ask-policy
  floor for a bare `--bg` (see *Permissions*) ships in A1 as **deny-and-record**, and A2 upgrades it to
  **park-and-wait** once there is a client that can answer. Parking in A1 would strand a worker with no
  recourse; denying is the safe interim and never silently approves. Workers with an explicit
  `--permission-mode` — which is every doperpowers worker — are unaffected in both stages.
- **2026-07-26 rev 3.1** — four one-line closures from the rev-3 review, all internal-consistency:
  acceptance 2's state set widened to include `stopped` (rev 3 widened the contract vocabulary and the
  acceptance list but missed this one — the same adjacent-semantics drift, caught a third time);
  recorded that `stopped` is intentionally outside `_poll_until_done`'s terminal set and why that is
  harmless; defined the hung-host arm of crash projection (pid live + socket silent ⇒ project the
  roster state, flagged unresponsive, because a live process is not evidence of failure); and pinned
  `--bg --resume` to SDK `resume` + `forkSession: true`, the exact lever probe 59 verified.
- **2026-07-26 rev 3** — second review round; four new issues, all introduced or left open by rev 2.
  (1) **The rev-2 default ask-policy broke the north star**: doperpowers spawns every worker
  `--bg --permission-mode auto`, so an unconditional default would park each at its first tool and
  return `blocked` to the poller. Added the precedence rule — explicit permission config always wins,
  the default is a floor for bare `--bg` only — and narrowed acceptance 9. (2) **Fork-copy was still an
  assertion**; probe 59 added and it PASSES — the child transcript physically contains the parent
  conversation and survives the parent's deletion, so the purge is safe. (3) **Restored the required-
  grammar list and the `stop` semantics**, both silently lost in rev 2's rewrite; `stop` now records
  roster `stopped`, which `daemon-finalize.sh` already routes. (4) **Defined crash projection**: a
  roster row that is non-terminal with a dead pid projects `state: "error"` at read time, so a
  `SIGKILL`ed host cannot hang the poller. Also: 8-hex is now normative with its real reason
  (`_lib.sh`'s `[ "${#short}" -eq 8 ]` purge gate); `stopped` restored to the state vocabulary;
  `daemon-finalize.sh` added to the acceptance script list; the park soak folded into open question 3;
  the `blocked` ambiguity between a permission park and `AskUserQuestion` recorded as open question 5.
  **Applied as targeted edits, not a rewrite** — see Surprises.
- **2026-07-26 rev 2** — critical review; four load-bearing premises reproduced as broken and fixed.
  (a) `CLAUDE_BIN` override does not exist → PATH shadowing, and the real script contract (banner
  format, `agents` row keys and state vocabulary, transcript reply channel, fork-on-resume) is now
  normative. (b) Zero-state broke `_poll_until_done` because the engine unlinks on exit → two-layer
  live/terminal state with a roster. (c) Socket path derived from session id is impossible at listen
  time and unstable across `/resume` → keyed by pid, moved off `/tmp`. (d) Park was unprobed and
  inverted the codebase's deny-on-lost-UI rule → probe 58 added (park verified, plus the `ask`-gating
  finding), park scoped to `kind`, `detach()` separated from `dispose()`. Also: `daemon/server.ts`
  reuse narrowed to the pattern; "nothing to reap" corrected; `--detachable` lifetime defined;
  grammar trimmed to the script contract; `assistant` bin retirement recorded; F2 causal claim softened
  to a hypothesis; Open Questions section added.
- **2026-07-26 rev 1** — initial spec from the brainstorming session that reframed the roadmap's three
  faces into one host+client process model. **Superseded; do not implement.**
