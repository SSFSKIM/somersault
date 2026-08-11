# Agent app server M3 — fleet adoption, workspace, shell (design)

**Date:** 2026-08-11 · **Status:** approved (design presented and confirmed; controlled track;
independent review folded in — see Revision Notes)
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

Two mapping reports (2026-08-11, this repo), the Codex v2 reference, and an independent spec review
that verified every load-bearing claim against code. Load-bearing facts:

1. **Two unrelated "daemons" exist; the fleet is NOT `src/daemon/`.** The ccx fleet is one process
   per session (`src/cli/spawn.ts:42-71`), each with its own UDS (`~/.claude/ccx/run/<pid>.sock`,
   `src/fleet/paths.ts:31-33`) speaking the 34-op host wire (`src/host/ops.ts:35-86`), roster rows at
   `~/.claude/ccx/roster/<short>.json`, live state derived at read time (`src/fleet/index.ts:24-39` —
   "live is asked, terminal is recorded"). `src/daemon/` is the retiring `cc-harness` supervisor and
   M3 does not touch it.
2. **The host wire is rich.** Beyond lifecycle it carries ops for rewind (anchors/dryrun/rewind),
   tasks (tasks/background/stop_task), MCP (status/reconnect/toggle), compact, usage, context_usage,
   capabilities, setters (set_model/set_permission_mode/set_thinking), `clear`, and the eight
   flag-layer ops (get_settings, list_dirs, add_dir, remove_dir, set_output_style, set_effort,
   add_rule, remove_rule — never busy-gated; the scorecard's gap-6 "nonet" is these eight *methods
   plus `thread/clear`*). The **host owns the flag accumulator** and replays it across its own swaps
   (`host/host.ts:432-437`) — so a fleet bridge forwards and never keeps a second copy.
3. **An engine-shaped façade over the host socket already exists** — `RemoteChatSession`
   (`src/client/remote.ts:50-231`) + `chatAdapter` (`src/client/chatAdapter.ts`), with the
   turn-seq/ends-before-waiter ledger pattern the fleet engine needs — and `chatAdapter.submit`
   **already captures the result-type SDK frame from `{kind:"message"}` frames in shipped `ccx
   attach` use** (`chatAdapter.ts:107`), so result delivery over the wire is production-proven, not
   an open premise. `EngineSession` (`appserver/registry.ts:20-107`) is structural with 4 required
   members, designed for a second implementation. `ThreadOrigin` is a single-member union
   (`registry.ts:10`); `-33006`'s emit sites are already commented in place (`settings.ts:134`,
   `mcp.ts:104`, `mcp.ts:127`).
4. **Follow is replay-first with a fixed order** (`host/host.ts:513-546`): turn-start (if
   in-flight) → buffered messages (`replay: true`, `stream_event` partials excluded) → parked
   decisions → task snapshot → state. A truncated-buffer replay emits a **seq-less**
   `{kind:"turn", phase:"start", truncated:true}` marker (`host.ts:524`, `wire.ts:39`). Attach's
   transcript comes from disk (`src/cli/attach.ts:19-35`); probe 62 proved disk and socket do not
   overlap (no uuid-dedup layer needed).
5. **Host wire facts the bridge must respect** (review-verified): only `rewind()` emits the
   `rewound` event today — `resumeSession`/`clearSession` swap silently (`host.ts:392-427`, `:705`);
   the `prompt` op carries no uuid (`ops.ts:42`); busy refusal is `{ok:false, error:"busy"}`
   (`host/server.ts:167`); `answer()` reports a lost race as `{ok:true, alreadyAnsweredBy}` — not a
   refusal (`host.ts:754-774`); `HostStatus` carries only state/status/waitingFor/sessionId/
   permissionMode (`ops.ts:4`); host `capabilities` returns 3 of the 4 engine catalogs
   (`host.ts:54`); the `turn start` event is written *before* the prompt reply that carries the seq
   (`host.ts:290-293` vs `server.ts:166-172`).
6. **Codex v2 reference shapes** (`app-server-protocol/src/protocol/`): `fs/readFile {path}` →
   `{dataBase64}` — server-side, sandbox-None, whole file, absolute path; `fuzzyFileSearch
   {query, roots, cancellationToken?}` → ≤50 scored matches, empty query → `[]`, fs failure → empty
   (never an RPC error); `thread/shellCommand {threadId, command}` — deliberately **unsandboxed**
   shell string whose output streams into the turn; resume-of-a-running-thread = atomic
   rejoin-and-replay; interrupts are per-turn from any subscribed connection; only one process holds
   a thread for writing (`-32600` for the second — their analog of our `-33006` split).
7. **SDK 0.3.227 delta is five declared properties, zero export changes.** `resumeDropsTurn` is a
   truncating-resume validator (fork-time check that discarded entries all belong to the named
   turn) — a **rewind** hardening, not an attach primitive. `crossSessionInbound`, `dialogExpiry`,
   `awsPairs`, `forceLoginGatewayUrl`: CLI settings/auth knobs, recorded, no action.

## Scope

**In:** fleet adoption (`thread/attach`, `thread/stop`, `fleet/list`, origin widening, the full
bridge, `-33006` activation, five additive host-wire revisions — §1a), workspace (`fs/read`,
`fs/search`), `thread/shellCommand`, `thread/reopen` (gap 10), SDK 0.3.227 bump (+
`resumeDropsTurn` adoption in the rewind seam), schema/console/scorecard/drift-gate follow-through,
keyed live acceptance.

**Out (recorded, future):** Codex's sandboxed `command/exec` + `process/*` families (PTY streaming,
stdin/resize/terminate follow-ups); `fs` write/watch families; content (grep) search; a backpressure
policy (`-32001 overloaded` stays N/A-deferred); review / config-write / thread search+archive /
reverse-request domains; any change to `src/daemon/`.

## Design

### §1 Fleet adoption

#### §1a Parent (host-wire) revisions carried by M3

The reviews found five places where bridging *around* the wire would encode a lie the wire could
cheaply stop telling. The host is in-repo, so M3 carries five **additive** host-side revisions
(each with its own host-side unit coverage; all optional-field or new-emission — no existing
client breaks):

- **(a) Every engine swap announces — with a single owner.** The `rewound` emission MOVES INTO
  `SessionHost.swapEngine` (callers pass the announce payload: rewind passes `prevUuid`/`cleared`,
  clear passes `cleared:true`, resume passes nothing), and `rewind()`'s own separate emission
  (`host.ts:705`) is REMOVED — `rewind()` already calls `swapEngine` (`host.ts:699-700`), so
  emitting in both places would double-announce every conversation rewind (two epoch bumps, two
  client rebuilds). Exactly one `rewound` per swap, on all three paths.
- **(b) The `prompt` op gains an optional `uuid`**, plumbed through to `Session.submit`'s existing
  `{uuid}` opt — preserving the user-item id stitch (`registry.ts:20-28`) on fleet threads, which is
  impossible with an unstamped prompt.
- **(c) `HostStatus` gains optional `model` and `thinkingTokens`, and `set_model`/`set_thinking`
  emit a `state` event** (today they emit nothing — a foreign client's model change could never
  reach a mirror).
- **(d) The host `capabilities` op returns the `agents` catalog** (fourth of the engine's four —
  today it returns three, and fleet `thread/capabilities/read` would silently lose subagents).
- **(e) `decision_settled` carries the full structured answer.** Today the event carries only the
  answer-kind string (`wire.ts`), which cannot reconstruct the shipped `decision/resolved`
  notification's `answer` payload when the settlement was won by another host client. The event
  gains an optional structured `answer` field (the same outcome object the `answer` op received),
  so the app server can translate every settlement — its own or a foreign one — into the existing
  `decision/resolved {threadId, toolUseId, by, answer}` contract.

#### §1b `FleetEngineSession`

New module (`appserver/fleetEngine.ts`) implementing `EngineSession` over the host socket:

| `EngineSession` member | backing |
|---|---|
| `submit(prompt, onMessage, {uuid})` | `prompt` op (now uuid-stamped, §1a-b) → success reply `{ok, accepted, seq}` (`host/server.ts:171`) or busy refusal `{ok:false, error:"busy"}` → mapped `-33001`; settle on the seq-matched `turn end` event (ends-before-waiter ledger, `chatAdapter.ts` pattern); `onMessage` fed from `{kind:"message"}` frames in the seq window; `result` captured from the result-type SDK frame (production-proven, `chatAdapter.ts:107`; probe leg confirms) |
| `interrupt()` | `interrupt` op |
| `dispose()` | `detach` — the host lives on (close ≠ stop) |
| `onFrame(cb)` | `{kind:"message"}` and `{kind:"task"}` frames → the existing router |
| `isEnded()` | socket-close latch |
| `sessionId` | from `state` / roster row |
| optional members **present** | `stopTask`/`backgroundAll`/`listBackgroundTasks`, `mcpServerStatus`/`reconnectMcpServer`/`toggleMcpServer`, `compact`, `usage`, `getContextUsage`, `capabilities`, `setModel`/`setPermissionMode`/`setMaxThinkingTokens`, `getSettings` |
| optional members **absent** | `steer`, `setMcpServers`, `setMcpPermissionModeOverride`, `reloadPlugins`, `reloadSkills`, `reinitialize`, `applyFlagSettings`, `rewind` — absence is *not* how fleet refusal happens (refusal precedence below); `rewind`'s absence means the **handler's fleet branch** forwards the host op directly (§1d) |

**Fleet turn identity is derived, not minted.** All fleet turn ids derive deterministically from the
host seq (e.g. `t<seq>@<epoch>`); `mintTurnId` is never called for fleet threads. This closes the
own-vs-foreign race (the `turn start` event beats the prompt reply carrying the seq — a
mint-on-foreign-start bridge would misclassify its own turn) and makes foreign turns first-class:
any seq-bearing `turn start` broadcasts `turn/started`; the turn view carries no initiator claim.
**Seq-less turn frames (truncated-buffer replay markers) are never busy-tracking inputs.**

Host-**synthesized** frames (`state`, `decision`, `decision_settled`, `rewound`, `turn`,
`tasks_changed`) are control signals, not SDK messages: a fleet-specific layer beside the router
consumes them —

- `turn` (phase start/end, seq) → busy tracking + `turn/started`/`turn/completed` broadcast (per
  the derivation rule above). **The fleet event layer is the SOLE lifecycle owner** for fleet
  threads — own and foreign turns alike: the inProcess turns spine's fleet branch performs its
  gates and calls `submit`, but never mints, never claims busy, never broadcasts; all lifecycle
  state rides the host `turn` events. Foreign-turn message frames route through the same item
  mapper own turns use, so foreign turns produce item notifications — one mapper owner per turn
  window, both origins of the turn.
- `decision` → parks on the app-server wire as usual, **but as a view of the host's park**:
  `decision/respond` forwards to the host `answer` op (outcome vocabularies map 1:1 — both sides
  derive from the same park model). **Receipt mapping is exact:** `{ok:true, alreadyAnsweredBy}` →
  `-33002 ALREADY_SETTLED` with `data.by`; `{ok:false}` "no parked request" → the same not-found
  error the local path answers; kind-mismatch → `-32602`. First-answer-wins stays host-side;
  `decision_settled` (settled by anyone, now carrying the structured answer — §1a-e) broadcasts
  the **existing** `decision/resolved {threadId, toolUseId, by, answer}` notification — no new
  notification name, no schema-count change. The app server **never settles a fleet decision
  locally**; view removal is settle-event-driven only.
- `state` → settings-mirror updates (permissionMode, sessionId, and — §1a-c — model/thinkingTokens)
  + `thread/status/changed`; `thread/settings/changed` when a mirrored knob moved.
- `rewound` → a host-side engine swap happened (any client's resume/clear/rewind — §1a-a makes all
  three announce): bump `record.epoch`, reconcile sessionId, broadcast `thread/rewound`.
- `tasks_changed` → `task/changed`.

**Flag layer:** fleet records leave `flagPerms`/`flagOutputStyle`/`flagEffort` untouched. The eight
flag ops forward per-op (`add_dir`, `set_effort`, …) and `thread/settings/read` forwards
`get_settings` — the host is the single owner of accumulator truth, and `repushThreadState` never
runs for fleet threads (the host does its own replay across its own swaps). `thread/settings/apply`
has **no** fleet backing (no host op carries an arbitrary flag-settings object) and answers `-33006`
— the emit site `settings.ts:134` anticipated.

**Origin:** `ThreadOrigin` widens to `"inProcess" | "fleet"` — the compiler surfaces every site
needing a branch. `threadView` already carries `origin`; it gains `cwd` (both origins) and, for
fleet, the roster `short` + `name`.

#### §1c Refusals

**`-33006 UNSUPPORTED_FOR_ORIGIN` activates** for fleet threads exactly where the wire lacks an op:
`turn/steer`, `turn/start {queue:true}` (the server queue rides ownership of the engine chain,
which fleet threads don't have; retrying over busy refusals would be race-prone against other
clients), `thread/settings/apply`, `mcpServer/set`, `mcpServer/permissionModeOverride/set` (the
registered method keys — copy from `methodSchemas`), `plugin/reload`, `skill/reload`,
`thread/reinitialize`, `account/read`, `thread/init/read` (no host `account`/`init` ops —
scorecard gap 3), and `thread/reopen` (the host owns its engine lifecycle; joins the gate when its
schema registers).
**Refusal precedence:** for fleet threads the origin gate answers `-33006` *before* the
absent-optional-member convention can produce `-32601` — a wire-gap refusal reads as origin-scoped,
never as an engine-capability accident.

**`thread/resume` is NOT origin-gated** (it creates a new thread from a sessionId; there is no
record to gate on). The real hazard is forking a second engine over a live conversation: the
handler gains a **live-session guard** — a sessionId that belongs to a live roster row or an
attached fleet record refuses with `-32602` ("sessionId belongs to a running fleet session; use
thread/attach").

#### §1d Orchestrating handlers get explicit fleet branches

Three inProcess handlers *orchestrate* rather than forward, and their fleet arms are branches with
different event-driven semantics — this is where the bridge is NOT transparent:

- **`thread/rewind`** (fleet): forwards the host `rewind_anchors`/`rewind_dryrun`/`rewind` ops
  verbatim — the host op carries `{uuid, prevUuid, scope}`, which the `EngineSession.rewind`
  optional member cannot express, hence the member stays absent and the handler branches. No local
  `swapEngine`, no `repushThreadState` (the host swaps and replays its own state); epoch bump +
  `thread/rewound` broadcast ride the host's `rewound` event (§1a-a), not the local swap path.
- **`thread/clear`** (fleet): forwards the host `clear` op; same event-driven resync.
- **`thread/compact/start`** (fleet): forwards the bare host `compact` op. **Recorded deviation:**
  inProcess compact rides the turn machinery (busy + `turn/started`/`turn/completed` — M2's
  decision); the host op has no turn events and the host stays promptable mid-compact. Synthesizing
  a local turn would fabricate busy state other clients don't observe, so the deviation stands;
  `thread/compacted` still reaches the wire (the compact-boundary frame arrives as a message frame
  through the router).

#### §1e New methods

- **`fleet/list {}`** → rows from a **roster + projection join** (`RosterRow` fields + derived live
  state — `AgentsRow` alone lacks short/pid/kind/startedAt): `{short, name, kind, state, pid, cwd,
  sessionId?, startedAt, endedAt?, unresponsive?, threadId?}` — `threadId` present when this server
  has the session attached. Terminal rows are listed (they carry outcome) but refuse attach;
  `unresponsive` rows (live pid, dead socket) are listed and an attach attempt fails naturally
  (`-33008`).
- **`thread/attach {target}`** — `target: string`, resolved by the CLI's actual rule
  (`src/cli/lifecycle.ts:15-27`): a simultaneous filter on roster `short` | `sessionId` | `name`;
  zero matches or a terminal/unreachable target → `-33008 ATTACH_FAILED`; **multiple matches →
  `-33008` with the match list in `data`** (CLI parity: ambiguity is an error, not a precedence).
  On success: dial the socket, send `follow`, seed the transcript from disk (`getSessionMessages`)
  exactly as `ccx attach` does — the follow replay covers the live turn with no overlap — and
  register a record with `origin:"fleet"`. Reply: `threadView`; broadcast: `thread/started`.
  Attaching a target this server already holds returns the existing thread (idempotent), mirroring
  Codex's rejoin — and idempotency holds **under concurrency**: an attach-in-flight reservation
  keyed by roster short makes simultaneous attaches collapse to one record (reservation cleaned up
  on failure). Admission follows an **activation protocol**: every listener is installed and the
  follow replay is buffered before the record publishes, so a replay emitted synchronously at
  follow time (buffered messages, parked decisions, task snapshot, state) cannot be lost or
  broadcast ahead of `thread/started`. Settings mirror seeds from `status` + `get_settings` at
  attach (and stays fresh via `state` events, §1a-c).
- **`thread/stop {threadId}`** → the host `stop` op. **No receipt is awaited — EOF is the
  contract:** the host's teardown destroys every open socket before the stop handler could reply
  (production ordering; the existing attach client deliberately ignores `stopHost()` rejection),
  so success = the op was written + the socket reached EOF + the roster row turns terminal within
  a bounded poll. The stop pre-latches an *expected-death* flag so the §1f socket-death sequence
  (failed-turn broadcast, `fleetConnectionLost` warning) does NOT fire for a death the client
  asked for. Then the record closes; broadcast `thread/closed {reason:"stopped"}`. On an inProcess
  thread `thread/stop` behaves as `thread/close` does today (dispose our own engine) — one method,
  origin-appropriate meaning, matching the scorecard's gap-4 framing.

#### §1f Release, death, and reads

**`thread/close` on a fleet thread = detach** (unfollow + socket close, host lives on) — the
asymmetry that made `thread/stop` a separate method. On detach, parked decision *views* are dropped
**silently** — no `decision/resolved` broadcast, because the decisions remain live host-side and
announcing a settlement that didn't happen would lie to watchers (fleet-aware branch in the close
teardown).

**Socket death** (host crash, kill, network loss) is a specified sequence, in order: (1) the
in-flight submit waiter (if any) settles → `turn/completed {status:"failed"}` with a
connection-lost error; (2) busy clears; (3) parked decision views drop silently (as above — the
host may be dead or alive; the app server cannot know and must not claim); (4) `isEnded` latches —
subsequent methods answer `-33005`; (5) broadcasts: `warning {code:"fleetConnectionLost"}` +
`thread/status/changed`. Recovery is `thread/close` + a fresh `thread/attach` (if the host still
lives); `thread/reopen` stays `-33006` for fleet — the host owns its engine.

**`thread/read` on a fleet thread is disk-only** — persisted transcript rows under the same
epoch-qualified cursor scheme; the live half of the world travels via subscribe replay, exactly as
inProcess (mixing the live buffer into an absolute-offset cursor would double-count rows once the
turn persists). The uuid stitch survives via §1a-b (uuid-stamped prompts).

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
executed in the **thread's cwd** (record config cwd for inProcess, falling back to the server
process cwd when the config named none; roster cwd for fleet — same machine, guaranteed by the UDS
transport). Output returns to the calling client only; conversation state untouched. **Recorded
deviation from Codex**, whose `thread/shellCommand` streams output into the turn so the model sees
it — ours matches the TUI's display-only `!cmd` semantics (user-confirmed fork). Unsandboxed by
design, like Codex's. Busy is allowed (the TUI permits `!` mid-turn); the command runs concurrently
with the engine. A dead-engine record follows the standard `-33005` gate — the thread reads
consistently dead (clarified during planning).

### §4 `thread/reopen` (gap 10)

Client-driven recovery for a record whose engine is dead (`isEnded()` — the factory-throw wedge or
any future death): rebuild from `record.config` + `resume` of the retained sessionId through the
same `swapEngine` machinery with a tolerate-dead-dispose guard (disposing an already-ended engine
is a no-op, not an error). **`thread/reopen` joins `ENGINE_GONE_EXEMPT`** — the dispatch-level
`-33005` gate would otherwise make the method unreachable exactly when it is legal; the
alive-engine refusal happens in the handler, after the exemption. A record with **no retained
sessionId** (engine died before the first init frame) reopens as a fresh conversation from
`record.config` — documented, and the resulting `thread/rewound {sessionId}` carries the new id.
Post-swap `repushThreadState` runs as for rewind/clear. Emits `thread/rewound {sessionId}` — the
established "engine swapped, resync" signal (epoch bumps, cursors invalidate). Refusals: `-33001`
busy/closing/swapping, `-33006` fleet, and — when the engine is *alive* — `-32602` ("engine is not
dead; nothing to reopen"), so reopen can't be used as a covert restart. Closes scorecard gap 10.

### §5 Wave 0 — SDK 0.3.227 bump

Bump `@anthropic-ai/claude-agent-sdk` to `^0.3.227`, run the drift ritual (SDK-drift script +
scorecard sweep). Adopt `resumeDropsTurn` in the truncating-rewind seam — and the value is already
in hand: the app-server rewind's `uuid` param names the prompt whose turn the truncation discards
(`prevUuid` is the resume anchor), so the rewind factory widens to pass `uuid` as
`resumeDropsTurn` and the CLI validates the fork point — refusals surface as the rewind error they
are. The other four new properties: recorded in the drift notes, no action.

## Wire surface delta

Methods **51 → 58**: `fleet/list`, `thread/attach`, `thread/stop`, `thread/reopen`,
`thread/shellCommand`, `fs/read`, `fs/search` — all **stable** (turn/steer remains the sole
experimental). Notification **count 26, unchanged**; one payload moves: `thread/closed` gains an
optional `reason` field (additive — schema artifact and scorecard row update in the same change).
New error code: **`-33008 ATTACH_FAILED`** (carries the ambiguity match list in `data` when that is
the failure). `-33006` becomes emittable (scorecard rows flip from defined-unemitted). Host wire:
five additive revisions (§1a) — single-owner `rewound` from all swap paths, `prompt.uuid`,
`HostStatus.model`/`thinkingTokens` + setter `state` emissions, `capabilities.agents`,
`decision_settled.answer`. Schema artifacts regenerate;
`methodSchemas` gains seven entries; the drift gate's bijection pass forces seven new scorecard
rows in the same change.

## Testing & acceptance

**The high-fidelity trick:** the host wire's server side is in-repo, so fleet-bridge unit tests spin
a **real `HostServer` over a real UDS with a stubbed engine behind it** — actual NDJSON framing,
replay ordering, first-answer-wins, busy gating — no API key. An engine-faithful fake host harness
(`test/appserver/fakeHost.ts` or similar) becomes the fleet analog of the existing engine fakes.

**Premise probe (run before the plan hardens; number = next free in the corpus at execution):**

- **P106 — mid-turn attach, result delivery, answer forwarding.** One probe, three confirmations:
  attach while a turn is in flight and verify the replay order + seq correlation live; confirm the
  result-type SDK frame arrives over `{kind:"message"}` (production-implied by
  `chatAdapter.ts:107`; this makes it evidence); park a permission on the host, answer over the
  wire from a second client, and capture the exact receipt shapes (`{ok:true, alreadyAnsweredBy}`
  losing race, kind-mismatch, no-parked) plus `decision_settled` attribution.

**Unit surface:** FleetEngineSession over the fake host (submit/settle, foreign-turn derivation,
own-vs-foreign under the start-before-reply race, seq-less replay markers ignored for busy,
interrupt, detach, socket-death sequence incl. silent view drop + `warning` + waiter settlement);
decision forwarding incl. the exact receipt mapping; the `-33006` matrix per method × origin (incl.
`account/read`, `thread/init/read`, `thread/settings/apply`); `thread/resume` live-session guard;
foreign-swap resync (host-side `resume`/`clear`/`rewind` each produce epoch bump + `thread/rewound`);
settings-mirror seed (`status` + `get_settings`) and `state`-event freshness (model/thinking);
`fleet/list` row shape incl. `unresponsive` and terminal rows; fleet `thread/read` disk-only paging
+ uuid stitch; attach ambiguity → `-33008` with match list; fs/read caps + fs/search degradation;
shellCommand cwd resolution both origins + no-cwd fallback; reopen (dead-engine guard, alive-engine
refusal, `ENGINE_GONE_EXEMPT` membership, no-sessionId fresh-reopen, post-reopen repush); origin-
widening exhaustiveness (typecheck). Host-side units for the four §1a revisions (swap announces,
prompt uuid plumb, status fields + setter emissions, agents catalog).

**Keyed live acceptance (one scenario, M2-style):** spawn a real detached ccx session → `fleet/list`
shows it → `thread/attach` → drive a turn through the app server → park a permission and answer it
from a second WS client → interrupt a turn → **foreign-swap leg:** a second host client issues
`resume` or `clear` directly on the host socket; assert `thread/rewound` + epoch bump on the app
server wire → fleet `thread/read` pages the transcript → `fs/search` + `fs/read` on the repo →
`thread/shellCommand` → `thread/close` (detach; host survives, verified by re-attach) →
`thread/stop` (roster finalizes). Plus a reopen leg on an inProcess thread. Console smoke: new
fleet panel (list/attach/stop) and workspace panel (search/read/shell) driven in a browser with
zero JS errors.

**Docs/gates:** scorecard rows for the seven methods; origin-scope column made real (gap 4 closes,
gap 2 closes — `host/ops.ts` becomes imported under `appserver/`, gap 10 closes); coverage.md
refresh; drift gate (presence + staleness + bijection) green per task.

## Delegated unknowns (empirical residue)

P106's receipt shapes and replay-order confirmation, live `stop` receipt behavior vs. socket-close
race, and whether `get_settings` over the wire returns everything the mirror seed needs — all
answered by the probe/implementation contact, none architectural.

## Decision Log

- **D-M3-1 — Full bridge, not core bridge** (user, 2026-08-11): every method with a host-op backing
  gets a fleet arm; `-33006` only where the wire lacks an op. *Rejected:* core-bridge-first — would
  retreat ~20 scorecard "both" rows to inProcess and force a second fleet milestone.
- **D-M3-2 — shellCommand returns output to the caller; conversation untouched** (user,
  2026-08-11): matches the TUI's display-only `!cmd`. *Rejected:* Codex-faithful stream-into-turn —
  mutates conversation state as a side effect, needs idle/busy branching, and has no fleet path
  (steer is wire-absent), so fleet threads would refuse it anyway.
- **D-M3-3 — attach is its own method; resume keeps shipped semantics + gains the live-session
  guard.** Codex merges attach into `thread/resume`; ours has shipped spawn-from-transcript meaning,
  and resuming a live fleet session's id would fork a second engine over one conversation.
  *Rejected:* overloading resume — silently changes a shipped method's contract; origin-gating
  resume — unimplementable (no record to gate on).
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
- **D-M3-10 — fix the wire, don't bridge around it** (review fold-in, 2026-08-11): four additive
  host-wire revisions (§1a) instead of bridge-side workarounds. *Rejected:* silent-foreign-swap
  tolerance, uuid-less fleet transcripts, a permanently stale model mirror, a three-catalog
  capabilities read — each encodes a lie the in-repo wire could cheaply stop telling.
- **D-M3-11 — fleet turn ids derive from the host seq; `mintTurnId` never runs for fleet threads**
  (review fold-in): closes the start-before-reply own-vs-foreign race deterministically.
  *Rejected:* hold-foreign-minting-while-prompt-in-flight — a lock where a naming scheme suffices.
- **D-M3-12 — fleet `thread/read` is disk-only** (review fold-in): symmetric with inProcess (live
  half via subscribe replay). *Rejected:* disk + live-buffer merge — double-counts rows under an
  absolute-offset cursor once the turn persists.

## Surprises & Discoveries

- **The repo has two unrelated "daemons", and the M2-era docs pointed at the wrong one.** The ccx
  fleet is per-session processes + per-session sockets (`src/fleet/` + `src/host/`); `src/daemon/`
  is the retiring `cc-harness` supervisor. "Attach to the fleet" therefore means dialing a
  session's own socket as another follower — there is no central daemon to integrate with.
- **The host wire is far richer than the fleet-adoption framing assumed** (34 ops incl. rewind,
  tasks, MCP, the flag layer) — which is what made the full bridge (D-M3-1) cheap: the feared
  two-accumulator drift dissolves because the host owns the accumulator and the bridge forwards.
- **`resumeDropsTurn` is a rewind validator, not an attach primitive** — the 0.3.227 loose end
  reclassified from "maybe fleet-relevant" to a Wave-0 hardening of the existing rewind seam.
- **The independent spec review's structural finding:** the host wire is a transparent backing for
  *forwarding* handlers but not for *orchestrating* ones (rewind/clear swaps, compact-as-turn,
  own-turn minting) — those needed explicit fleet branches with event-driven semantics (§1d), and
  three of its "bridge can't know" holes were really "the wire doesn't say yet" holes (§1a).
- **P106's core premise was pre-answered by shipped code** — `chatAdapter.submit` already captures
  the result frame in production `ccx attach` use; the probe demoted from open question to
  evidence-capture (receipt shapes, replay order).
- *(during execution — append here)*
- **Drift ritual (Task 1, SDK bump landed):** the 0.3.220 → 0.3.227 delta is five added declared
  properties and nothing else — `awsPairs`, `crossSessionInbound`, `dialogExpiry`,
  `forceLoginGatewayUrl` (all nested in the CLI settings/auth schemas, hence invisible to
  `drift-check.mjs`, whose `Options` scan is top-level only) and `resumeDropsTurn` (the sole top-level
  `Options` addition, and the only one adopted — the rewind-seam guard); zero changes to `Query`
  methods, the `SDKMessage` union, or exported names, with the drift gate green (installed IS npm HEAD,
  no appserver-scorecard drift).

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-08-11 — initial version (brainstorm: full bridge and shellCommand-as-RPC confirmed by the
  user; controlled track confirmed). Research ground: two mapping reports (harness fleet
  architecture; Codex v2 fleet/workspace surface), SDK 0.3.227 delta check.
- 2026-08-11 — independent (Fable) spec review folded in: 13 Important + 9 Minor findings, all
  accepted except P106-as-open-premise (demoted to confirmation — shipped `chatAdapter` already
  proves result delivery). Structural additions: §1a (four additive host-wire revisions), §1c
  refusal corrections (`thread/settings/apply`/`account/read`/`thread/init/read` in; `thread/resume`
  out, replaced by the live-session guard), §1d (explicit fleet branches for rewind/clear/compact),
  §1f (socket-death sequence, silent view drop, disk-only fleet reads), D-M3-10/11/12; attach
  target resolution corrected to real CLI parity (simultaneous filter, ambiguity error); `fleet/list`
  row sourced from a roster+projection join; 34-op wire count corrected; foreign-swap resync and
  fleet-read legs added to unit + acceptance coverage.
- 2026-08-11 — planning
  (`docs/superpowers/plans/2026-08-11-agent-appserver-m3-fleet-workspace.md`, Tasks 1–17): one
  clarification folded back — `thread/shellCommand` on a dead-engine record follows the standard
  `-33005` gate (§3); no other divergence.
- 2026-08-11 — Codex adversarial plan review folded in (gpt-5.6-sol; 7 high + 1 medium, all
  verified against code and accepted): single-owner `rewound` moves INTO `swapEngine` (rewind's
  own emission removed — it calls swapEngine, so the original §1a-a would double-announce);
  §1a gains (e) `decision_settled.answer`; the fleet event layer becomes the SOLE turn-lifecycle
  owner with foreign-turn itemization (§1b); the settle broadcast is the existing
  `decision/resolved`, not a new name; MCP gate names corrected to the registered keys; reopen
  joins the gate at registration time; attach gains the concurrency reservation + activation
  protocol; stop's contract is EOF-not-receipt with an expected-death latch; `resumeDropsTurn`'s
  value identified as the rewind `uuid` param itself; `tasks_changed` bridging made explicit.
