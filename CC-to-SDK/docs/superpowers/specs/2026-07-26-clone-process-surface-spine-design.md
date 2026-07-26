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
| **probe 57** | `CLAUDE_CODE_SESSION_NAME` / `_KIND` via SDK `env` are both honored on the **disk row** | direct; *not* verified end-to-end into the agents view — see Open Questions |
| **probe 58** | A `canUseTool` decision **can be parked 25 s and answered late**; `options.signal` did not abort; the turn resumed and completed cleanly | direct |
| **probe 58 (secondary)** | `canUseTool` fires **only for tools a rule routes to `ask`** — with no rules everything is auto-approved and there is no human seam | direct, and safety-relevant |
| **probe 59** | A forked session's transcript **physically contains** the parent conversation (marker present, 18 lines), and the child still recalls it **after the parent transcript is deleted** | direct — this is what makes doperpowers' purge-after-resume safe |
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

**Reply channel.** Replies are read from the **transcript** (`~/.claude/projects/**/<uuid>.jsonl`), not
from stdout. `~/.claude/jobs/<short>` is removed by the purge path.

**Resume model.** `--bg --resume <uuid>` **forks a new turn under a new short id**, carrying the whole
conversation forward; the superseded turn is then purged via `rm`. The conversation must be copied
forward rather than chained by reference, because the purge deletes the parent's transcript —
**verified by probe 59**: the forked child's jsonl physically contains the parent's messages and the
child still recalls them after the parent file is deleted. This is a property of the engine we inherit,
not something Goal A implements; the acceptance test guards against regressing it.

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
roster state is terminal            → project it as-is
roster state non-terminal + pid live (procStart matches, socket answers) → project the live status
roster state non-terminal + pid dead                                     → project state = "error"
```

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
   `state ∈ {working, blocked, done, error}` and `status ∈ {busy, idle}`.
3. **A session that has finished still appears** in `--all` with `state: "done"` — verified by polling
   after exit, which is the exact failure Revision 1 would have shipped.
4. While running, the **real** `claude agents --json --all` also lists the session with the name and
   kind we requested.
5. `ccx attach <id>` replays the conversation, follows the in-flight turn, and renders a parked
   permission dialog if there is one.
6. Answering resumes the session; `Ctrl+Z` detaches **without denying** the pending permission, and the
   session keeps running.
7. Two attached clients both see the turn; the first answer wins; the second is told who answered.
8. A `--bg` host parks indefinitely on an `ask`-routed tool with no client attached, and `agents` shows
   `state: "blocked"`.
9. A **bare** `--bg` with no permission configuration is reported by `agents` as having no human seam;
   a `--bg --permission-mode auto` worker (doperpowers' actual spawn) is **not** flagged, is **not**
   given a default ask-policy, and runs its tools to completion without parking.
9b. A host killed with `SIGKILL` mid-turn projects `state: "error"` in `agents --json --all` — not
    `working` — so `_poll_until_done` terminates instead of running to its timeout.
10. A default `ccx` session is attachable; closing its original terminal ends it.
11. `SIGKILL`ing a host leaves a stale socket that `agents` reports as dead **without unlinking**;
    `ccx fleet gc` removes it.
12. `attach`/`stop`/`rm` resolve a short id or a full session id; ambiguity exits non-zero listing
    matches. `rm` succeeds on an already-exited session, resolving it from the roster.
13. `ccx --bg --worktree wt` runs in `<repo>/.claude/worktrees/wt` on branch `worktree-wt`, its
    registry `cwd` is the worktree path, and a `--resume` turn inherits the worktree without repeating
    the flag. `rm` deletes it when clean and refuses, reporting why, when dirty.
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

1. **Probe 57 verified env → disk row, and probe 56b verified row → agents view, but no single probe
   traced env → agents view end to end.** Close it with a one-run probe before relying on acceptance 4.
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
- **Three of the review's four critical findings share one root:** Revision 1 adopted "store no state"
  as a slogan and then implicitly denied it in three separate sentences that each needed state
  (completion polling, `rm` on a dead session, socket discovery). A principle stated as an absolute
  invites exactly this failure; the narrowed form — *live is asked, terminal is recorded* — keeps the
  benefit without the contradiction.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

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
