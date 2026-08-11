# Agent app server M3 — fleet adoption, workspace, shell (design)

**Date:** 2026-08-11 · **Status:** approved (design presented and confirmed; controlled track)
**Parent:** `2026-07-30-agent-appserver-m2-design.md` (M1+M2 complete: 51 methods / 26 notifications,
all-inProcess) · **Scorecard:** `docs/parity/appserver.md`

## Purpose

M2 finished the inProcess control plane: every capability the SDK engine exposes on a thread the app
server itself spawned is reachable over the wire. M3 makes the app server a **fleet surface**: it
attaches to the running ccx background fleet (detached `ccx --detachable` / `ccx --bg` sessions), so
a browser console or IDE client can list, adopt, drive, and stop sessions it did not spawn — the
capability that makes `ccx serve` a control plane for the *product*, not just for its own children.
Alongside adoption, M3 ships the workspace pair (`fs/read`, `fs/search`), the `thread/shellCommand`
escape hatch, the gap-10 re-open path, and the SDK 0.3.220 → 0.3.227 bump. After M3, the deliberate
scope of the Codex comparison's "adoptable half" is done; review/config-write/reverse-request remain
future spec work.

## Research ground (what the design stands on)

Two mapping reports (2026-08-11, this repo) plus the Codex v2 reference. Load-bearing facts:

1. **Two unrelated "daemons" exist; the fleet is NOT `src/daemon/`.** The ccx fleet is one process
   per session (`src/cli/spawn.ts:42-71`), each with its own UDS (`~/.claude/ccx/run/<pid>.sock`,
   `src/fleet/paths.ts:31-33`) speaking the 44-op host wire (`src/host/ops.ts:35-86`), roster rows at
   `~/.claude/ccx/roster/<short>.json`, live state derived at read time (`src/fleet/index.ts:24-39` —
   "live is asked, terminal is recorded"). `src/daemon/` is the retiring `cc-harness` supervisor and
   M3 does not touch it.
2. **The host wire is rich.** Beyond lifecycle it carries ops for rewind (anchors/dryrun/rewind),
   tasks (tasks/background/stop_task), MCP (status/reconnect/toggle), compact, usage, context_usage,
   capabilities, setters (set_model/set_permission_mode/set_thinking), and the full settings/flag
   nonet (get_settings, list_dirs, add_dir, remove_dir, set_output_style, set_effort, add_rule,
   remove_rule — never busy-gated). The **host owns the flag accumulator** and replays it across its
   own swaps (`host/host.ts:432-437`) — so a fleet bridge forwards and never keeps a second copy.
3. **An engine-shaped façade over the host socket already exists** — `RemoteChatSession`
   (`src/client/remote.ts:50-231`) + `chatAdapter` (`src/client/chatAdapter.ts`), with the
   turn-seq/ends-before-waiter ledger pattern the fleet engine needs. `EngineSession`
   (`appserver/registry.ts:20-107`) is structural with 4 required members, designed for a second
   implementation. `ThreadOrigin` is a single-member union (`registry.ts:10`); `-33006`'s emit
   sites are already commented in place (`settings.ts:134`, `mcp.ts:104`, `mcp.ts:127`).
4. **Follow is replay-first with a fixed order** (`host/host.ts:513-546`): turn-start (if
   in-flight) → buffered messages (`replay: true`, `stream_event` partials excluded) → parked
   decisions → task snapshot → state. Attach's transcript comes from disk (`src/cli/attach.ts:19-35`);
   probe 62 proved disk and socket do not overlap (no uuid-dedup layer needed).
5. **Codex v2 reference shapes** (`app-server-protocol/src/protocol/`): `fs/readFile {path}` →
   `{dataBase64}` — server-side, sandbox-None, whole file, absolute path; `fuzzyFileSearch
   {query, roots, cancellationToken?}` → ≤50 scored matches, empty query → `[]`, fs failure → empty
   (never an RPC error); `thread/shellCommand {threadId, command}` — deliberately **unsandboxed**
   shell string whose output streams into the turn; resume-of-a-running-thread = atomic
   rejoin-and-replay; interrupts are per-turn from any subscribed connection; only one process holds
   a thread for writing (`-32600` for the second — their analog of our `-33006` split).
6. **SDK 0.3.227 delta is five declared properties, zero export changes.** `resumeDropsTurn` is a
   truncating-resume validator (fork-time check that discarded entries all belong to the named
   turn) — a **rewind** hardening, not an attach primitive. `crossSessionInbound`, `dialogExpiry`,
   `awsPairs`, `forceLoginGatewayUrl`: CLI settings/auth knobs, recorded, no action.

## Scope

**In:** fleet adoption (`thread/attach`, `thread/stop`, `fleet/list`, origin widening, the full
bridge, `-33006` activation), workspace (`fs/read`, `fs/search`), `thread/shellCommand`,
`thread/reopen` (gap 10), SDK 0.3.227 bump (+ `resumeDropsTurn` adoption in the rewind seam),
schema/console/scorecard/drift-gate follow-through, keyed live acceptance.

**Out (recorded, future):** Codex's sandboxed `command/exec` + `process/*` families (PTY streaming,
stdin/resize/terminate follow-ups); `fs` write/watch families; content (grep) search; a backpressure
policy (`-32001 overloaded` stays N/A-deferred); review / config-write / thread search+archive /
reverse-request domains; any change to `src/daemon/`.

## Design

### §1 Fleet adoption

**`FleetEngineSession`** (new module, `appserver/fleetEngine.ts`) implements `EngineSession` over
the host socket:

| `EngineSession` member | backing |
|---|---|
| `submit(prompt, onMessage, {uuid})` | `prompt` op → `{accepted, seq}`; refuse busy on `accepted:false`; settle on the seq-matched `turn end` event (ends-before-waiter ledger, `chatAdapter.ts` pattern); `onMessage` fed from `{kind:"message"}` frames in the seq window; `result` captured from the result-type SDK frame (probe P106) |
| `interrupt()` | `interrupt` op |
| `dispose()` | `detach` — the host lives on (close ≠ stop) |
| `onFrame(cb)` | `{kind:"message"}` and `{kind:"task"}` frames → the existing router |
| `isEnded()` | socket-close latch |
| `sessionId` | from `state` / roster row |
| optional members | present exactly where a host op exists: `rewind` trio, `stopTask`/`backgroundAll`/`listBackgroundTasks`, `mcpServerStatus`/`reconnectMcpServer`/`toggleMcpServer`, `compact`, `usage`, `getContextUsage`, `capabilities`, `setModel`/`setPermissionMode`/`setMaxThinkingTokens`, `getSettings`, `applyFlagSettings` (forwarded per-op — see below); **absent**: `steer`, `setMcpServers`, `setMcpPermissionModeOverride`, `reloadPlugins`, `reloadSkills`, `reinitialize` |

Host-**synthesized** frames (`state`, `decision`, `decision_settled`, `rewound`, `turn`,
`tasks_changed`) are control signals, not SDK messages: a fleet-specific layer beside the router
consumes them —

- `turn` (phase start/end, seq) → busy tracking + `turn/started`/`turn/completed` broadcast. Turns
  originated by *other* clients (or the session's own REPL user) mint a turnId keyed by seq, so
  foreign turns are first-class on our wire; the turn view carries no initiator claim.
- `decision` → parks on the app-server wire as usual, **but as a view of the host's park**:
  `decision/respond` forwards to the host `answer` op (outcome vocabularies map 1:1 — both sides
  derive from the same park model: allow_once/allow_with_updates/allow_always/deny/question_answer/
  plan_approve/plan_reject). First-answer-wins stays host-side; a losing race maps the host refusal
  to `-33002 ALREADY_SETTLED`. `decision_settled` (settled by anyone) broadcasts `decision/settled`
  with the host's `by` attribution. The app server **never settles a fleet decision locally.**
- `state` → settings-mirror updates (permissionMode, sessionId) + `thread/status/changed`.
- `rewound` → a host-side engine swap happened (another client's resume/clear/rewind): bump
  `record.epoch`, reconcile sessionId, broadcast `thread/rewound` — the established resync signal.
- `tasks_changed` → `task/changed`.

**Flag layer:** fleet records leave `flagPerms`/`flagOutputStyle`/`flagEffort` untouched. The nonet
forwards per-op (`add_dir`, `set_effort`, …) and `thread/settings/read` forwards `get_settings` —
the host is the single owner of accumulator truth, and `repushThreadState` never runs for fleet
threads (the host does its own replay across its own swaps).

**Origin:** `ThreadOrigin` widens to `"inProcess" | "fleet"` — the compiler surfaces every site
needing a branch. `threadView` already carries `origin`; it gains `cwd` (both origins) and, for
fleet, the roster `short` + `name`.

**`-33006 UNSUPPORTED_FOR_ORIGIN` activates** for fleet threads exactly where the wire lacks an op:
`turn/steer`, `turn/start {queue:true}` (the server queue rides ownership of the engine chain,
which fleet threads don't have; retrying over `accepted:false` would be race-prone against other
clients), `mcp/servers/set`, `mcp/permissionOverride/set`, `plugin/reload`, `skill/reload`,
`thread/reinitialize` (no host passthrough op), `thread/resume` (spawn-from-transcript semantics do
not apply to a live foreign engine), and `thread/reopen` (the host owns its engine lifecycle).
**Refusal precedence:** for fleet threads the origin gate answers `-33006` *before* the
absent-optional-member convention can produce `-32601` — a wire-gap refusal reads as origin-scoped,
never as an engine-capability accident.

**New methods:**

- **`fleet/list {}`** → roster-derived rows via `collectFleet`: `{short, name, kind, state, pid,
  cwd, sessionId?, startedAt, endedAt?, threadId?}` — `threadId` present when this server has the
  session attached. Terminal rows are listed (they carry outcome) but refuse attach.
- **`thread/attach {target}`** — `target: string`, resolved in CLI-parity order: roster short id
  first, then numeric pid, then sessionId uuid → resolves the roster row (the
  `prepareAttach` rule: terminal rows refused), dials the socket, sends `follow`, seeds the
  transcript from disk (`getSessionMessages`) exactly as `ccx attach` does — the follow replay
  covers the live turn with no overlap — and registers a record with `origin:"fleet"`. Reply:
  `threadView`; broadcast: `thread/started`. Attaching a target this server already holds returns
  the existing thread (idempotent), mirroring Codex's rejoin. Failures: `-33008 ATTACH_FAILED`
  (unknown target, terminal row, dead socket), `-32602` malformed target.
- **`thread/stop {threadId}`** → the host `stop` op (interrupt → bounded dispose → roster finalize →
  socket close). The record closes; broadcast `thread/closed {reason:"stopped"}`. On an inProcess
  thread `thread/stop` behaves as `thread/close` does today (dispose our own engine) — one method,
  origin-appropriate meaning, matching the scorecard's gap-4 framing.

**`thread/close` on a fleet thread = detach** (unfollow + socket close, host lives on) — the
asymmetry that made `thread/stop` a separate method. `thread/read` for fleet threads serves disk
transcript entries + the live buffer under the same epoch-qualified cursor scheme (the attach
`initialEntries` model). Settings mirror seeds from `status` + `get_settings` at attach.

### §2 Workspace: `fs/read`, `fs/search`

Server-scoped, explicit paths/roots — Codex's trusted-client semantics (their reads are
sandbox-None server-side; the SDK `readFile` seam is probe-dead, probe 104, and stays out).

- **`fs/read {path}`** → `{dataBase64, size}`. Absolute path required (`-32602` otherwise); missing
  file → `-32602` with the fs error; **size cap 4 MiB** — oversize answers a clear refusal rather
  than OOMing a browser client (deviation from Codex, which has no cap; recorded).
- **`fs/search {query, roots?, limit?}`** → `{matches: [{root, path, score}]}`, default/max limit
  50 (Codex's MATCH_LIMIT). Backed by the existing ranker (`src/tui/fileComplete.ts` —
  `collectEntries` with real `readdir`, `fuzzyScore`, `rankCandidates`); `roots` defaults to the
  server cwd. Empty query → `[]`; fs errors degrade to empty matches, never an RPC error (Codex's
  behavior). No highlight indices (our ranker doesn't produce them; recorded deviation). No warm
  index / session variant (Codex marks theirs experimental; our repos re-walk — acceptable, same
  note as the TUI's).

`threadView.cwd` lets a client root a search at a thread's workspace.

### §3 `thread/shellCommand`

`{threadId, command}` → `{code, output, timedOut?}` over the existing `runBash` primitive
(`src/tui/bash.ts` — full shell string, 30 s timeout, 4 MiB combined-output cap, never rejects),
executed in the **thread's cwd** (record config cwd for inProcess; roster cwd for fleet — same
machine, guaranteed by the UDS transport). Output returns to the calling client only; conversation
state untouched. **Recorded deviation from Codex**, whose `thread/shellCommand` streams output into
the turn so the model sees it — ours matches the TUI's display-only `!cmd` semantics (user-confirmed
fork). Unsandboxed by design, like Codex's. Busy is allowed (the TUI permits `!` mid-turn); the
command runs concurrently with the engine.

### §4 `thread/reopen` (gap 10)

Client-driven recovery for a record whose engine is dead (`isEnded()` — the factory-throw wedge or
any future death): rebuild from `record.config` + `resume` of the retained sessionId through the
same `swapEngine` machinery with a tolerate-dead-dispose guard (disposing an already-ended engine
is a no-op, not an error). Post-swap `repushThreadState` runs as for rewind/clear. Emits
`thread/rewound {sessionId}` — the established "engine swapped, resync" signal (epoch bumps,
cursors invalidate). Refusals: `-33001` busy/closing/swapping, `-33006` fleet, and — when the
engine is *alive* — `-32602` ("engine is not dead; nothing to reopen"), so reopen can't be used as
a covert restart. Closes scorecard gap 10.

### §5 Wave 0 — SDK 0.3.227 bump

Bump `@anthropic-ai/claude-agent-sdk` to `^0.3.227`, run the drift ritual (SDK-drift script +
scorecard sweep). Adopt `resumeDropsTurn` in the truncating-rewind seam where the dropped turn's
prompt uuid is already known (`rewindSession` callers), so the CLI validates the fork point —
refusals surface as the rewind error they are. The other four new properties: recorded in the drift
notes, no action.

## Wire surface delta

Methods **51 → 58**: `fleet/list`, `thread/attach`, `thread/stop`, `thread/reopen`,
`thread/shellCommand`, `fs/read`, `fs/search` — all **stable** (turn/steer remains the sole
experimental). Notifications **26, unchanged** — fleet threads reuse `thread/started`,
`thread/status/changed`, `thread/rewound`, `thread/closed`, `turn/*`, `decision/*`, `task/*`.
New error code: **`-33008 ATTACH_FAILED`**. `-33006` becomes emittable (scorecard rows flip from
defined-unemitted). Schema artifacts regenerate; `methodSchemas` gains seven entries; the drift
gate's bijection pass forces seven new scorecard rows in the same change.

## Testing & acceptance

**The high-fidelity trick:** the host wire's server side is in-repo, so fleet-bridge unit tests spin
a **real `HostServer` over a real UDS with a stubbed engine behind it** — actual NDJSON framing,
replay ordering, first-answer-wins, busy gating — no API key. An engine-faithful fake host harness
(`test/appserver/fakeHost.ts` or similar) becomes the fleet analog of the existing engine fakes.

**Premise probes (run before the plan hardens; numbers = next free in the corpus at execution):**

- **P106 — result frame reaches followers.** Does the host's `{kind:"message"}` stream include the
  SDK result-type message (the buffer excludes only `stream_event` partials)? Drives whether
  `FleetEngineSession.submit` captures a real result or synthesizes a minimal one from the turn-end
  event. Either way the design stands; the probe picks the arm.
- **P107 — mid-turn attach + answer forwarding.** Attach while a turn is in flight: verify the
  replay order and seq correlation live; park a permission on the host, answer over the wire from a
  second client, verify first-answer-wins receipt shapes and `decision_settled` attribution.

**Unit surface:** FleetEngineSession over the fake host (submit/settle/foreign-turn/interrupt/
detach/socket-death); decision forwarding incl. the losing race; -33006 matrix per method × origin;
fs/read caps + fs/search degradation; shellCommand cwd resolution both origins; reopen (dead-engine
guard, alive-engine refusal, post-reopen repush); origin-widening exhaustiveness (typecheck).

**Keyed live acceptance (one scenario, M2-style):** spawn a real detached ccx session → `fleet/list`
shows it → `thread/attach` → drive a turn through the app server → park a permission and answer it
from a second WS client → interrupt a turn → `fs/search` + `fs/read` on the repo → `thread/shellCommand`
→ `thread/close` (detach; host survives, verified by re-attach) → `thread/stop` (roster finalizes).
Plus a reopen leg on an inProcess thread. Console smoke: new fleet panel (list/attach/stop) and
workspace panel (search/read/shell) driven in a browser with zero JS errors.

**Docs/gates:** scorecard rows for the seven methods; origin-scope column made real (gap 4 closes,
gap 2 closes — `host/ops.ts` becomes imported under `appserver/`, gap 10 closes); coverage.md
refresh; drift gate (presence + staleness + bijection) green per task.

## Delegated unknowns (empirical residue)

P106 (result frame), P107 (replay/receipt shapes), live `stop` receipt behavior vs. socket close
race, and whether `get_settings` over the wire returns everything the mirror seed needs — all
answered by probes/implementation contact, none architectural.

## Decision Log

- **D-M3-1 — Full bridge, not core bridge** (user, 2026-08-11): every method with a host-op backing
  gets a fleet arm; `-33006` only where the wire lacks an op. *Rejected:* core-bridge-first — would
  retreat ~20 scorecard "both" rows to inProcess and force a second fleet milestone.
- **D-M3-2 — shellCommand returns output to the caller; conversation untouched** (user,
  2026-08-11): matches the TUI's display-only `!cmd`. *Rejected:* Codex-faithful stream-into-turn —
  mutates conversation state as a side effect, needs idle/busy branching, and has no fleet path
  (steer is wire-absent), so fleet threads would refuse it anyway.
- **D-M3-3 — attach is its own method; resume keeps shipped semantics.** Codex merges
  attach into `thread/resume`; ours has shipped spawn-from-transcript meaning. *Rejected:*
  overloading resume — silently changes a shipped method's contract.
- **D-M3-4 — the app server is a follower, never a second engine owner.** Decisions forward to the
  host park; the flag accumulator stays host-side; queue/steer refuse. *Rejected:* mirroring park
  state or accumulator state server-side — the M2b external review already showed what a
  second copy of engine-owned state does (gap 9).
- **D-M3-5 — `thread/stop` is origin-appropriate stop, `thread/close` is origin-appropriate
  release.** Stop kills (host stop op / own-engine dispose); close releases (detach / dispose). No
  separate `thread/detach` method. *Rejected:* a fleet-only stop that errors on inProcess — needless
  origin asymmetry on the wire.
- **D-M3-6 — fs is server-scoped with explicit roots; base64; 4 MiB read cap; no indices; no warm
  index.** Follows Codex except the cap (browser-client protection). *Rejected:* thread-scoped fs
  (Codex doesn't; roots + `threadView.cwd` compose); text-mode reads (not binary-safe).
- **D-M3-7 — reopen requires a dead engine.** Alive-engine reopen refused so the method can't be a
  covert restart (that's `thread/clear`/`thread/resume`'s job). *Rejected:* reopen-as-restart.
- **D-M3-8 — command/exec + process/* families deferred** with review/config-write. One-off
  `thread/shellCommand` covers the escape-hatch need; PTY streaming is a milestone of its own.
- **D-M3-9 — SDK bump is Wave 0** (ritual + `resumeDropsTurn` rewind adoption), not a design
  dependency — the delta contains no attach primitive.

## Surprises & Discoveries

- **The repo has two unrelated "daemons", and the M2-era docs pointed at the wrong one.** The ccx
  fleet is per-session processes + per-session sockets (`src/fleet/` + `src/host/`); `src/daemon/`
  is the retiring `cc-harness` supervisor. "Attach to the fleet" therefore means dialing a
  session's own socket as another follower — there is no central daemon to integrate with.
- **The host wire is far richer than the fleet-adoption framing assumed** (44 ops incl. rewind,
  tasks, MCP, the flag nonet) — which is what made the full bridge (D-M3-1) cheap: the feared
  two-accumulator drift dissolves because the host owns the accumulator and the bridge forwards.
- **`resumeDropsTurn` is a rewind validator, not an attach primitive** — the 0.3.227 loose end
  reclassified from "maybe fleet-relevant" to a Wave-0 hardening of the existing rewind seam.
- *(during execution — append here)*

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-08-11 — initial version (brainstorm: full bridge and shellCommand-as-RPC confirmed by the
  user; controlled track confirmed). Research ground: two mapping reports (harness fleet
  architecture; Codex v2 fleet/workspace surface), SDK 0.3.227 delta check.
