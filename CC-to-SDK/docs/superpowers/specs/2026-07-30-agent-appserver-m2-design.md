# Agent app-server M2 — full-controllable inProcess surface

> Child of [`2026-07-28-agent-appserver-protocol-design.md`](2026-07-28-agent-appserver-protocol-design.md)
> (the protocol spec; its §7 method inventory, §8 notification inventory, and §9 schema discipline are
> the wire-level source of truth — this spec scopes and mechanizes the M2 milestone over the shipped M1
> core loop). Scorecard: [`docs/parity/appserver.md`](../../parity/appserver.md).

## Purpose

After M1 a web client can *chat* — connect, start/resume threads, stream a turn, answer decisions,
read history. It cannot *drive*: no setting can be changed, nothing can be discovered or measured,
no rewind, no MCP or task management, no session-library operation. M2 closes that gap: **every
capability the SDK engine exposes on an inProcess thread becomes reachable over the wire**, so a GUI
holds the full control plane the TUI holds today. Fleet adoption, workspace (`fs/*`), and
`thread/shellCommand` remain M3 by design — they are fleet/workspace surfaces, not SDK-engine control.

Success, stated as the scorecard: after M2, every row in `docs/parity/appserver.md` whose origin
scope is not fleet-bound reads `shipped(M2)`/`shipped(M1)` or `N/A-with-evidence` (probe-dead or
by-design). The denominator stays generated (drift-check's appserver pass), never hand-counted.

## Scope

**In:** all 53 `planned(M2)` scorecard rows; all 13 "Carried into M2" gaps from the parent spec; six
live probes (`streamInput`, `readFile`, `reloadPlugins`, `reloadSkills`, `register_repo_root`, and
the userMessage-uuid probe from Wave 0) run *now*, shipping what proves alive; the full §9 schema discipline (typed zod for every method
including M1's ten, generated draft-7 JSON + TS artifacts, `--emit-schema`, round-trip drift gate);
the `cc-harness/appserver` subpath export; a disposable single-file HTML console as foreign consumer.

**Out (M3):** `thread/attach`, `fleet/*`, `thread/stop` (fleet); `fs/read`, `fs/search` (workspace —
even if the `readFile` probe proves alive, only the *knowledge* ships in M2); `thread/shellCommand`;
`-33006 unsupportedForOrigin` still cannot fire (no fleet-origin threads exist until M3) and stays
defined-unemitted. Also out: auth management (token/env is the auth model — parent spec), daemon
retirement, any real GUI product, and the M1-deferred "re-point the TUI reducers onto
`appserver/items/`" un-coupling — named here so it isn't silently dropped, but M2 is server-side
work and stays out of `src/tui/` (deferred to M3, recorded in the parent's Revision Notes).

## Structure — five waves, debt first

Each wave lands green (unit + typecheck + drift) and extends the live acceptance; the console grows
one panel per wave. Rationale (Decision Log D-M2-1): M1's defects clustered at shared mechanisms,
not handlers — waves put each shared mechanism at a boundary where it is designed once and
inherited, instead of improvised per handler.

### Wave 0 — spine (the 13 carried gaps + shared mechanisms)

The mechanisms every later wave builds on, plus the named debt:

- **`initialize` grows both connection-scoped knobs at once:** `watchThreads?: boolean` (below)
  and the parent's adopted-pattern-2 **`optOutNotificationMethods?: string[]`** — M2 multiplies
  the notification surface, so the opt-out ships in the same breath. The `warning` meta
  notification starts firing at its first real triggers (a clamped `thread/read` limit, an
  unknown config field on `thread/start`); `deprecationNotice` stays defined-unemitted until
  something is actually deprecated (recorded N/A-with-evidence).
- **Server-scoped fan-out** (`fanout.ts`): `initialize` gains `watchThreads?: boolean`. Watchers
  receive thread-existence events: `thread/started` (gap 1 — today it has no possible audience:
  per-thread subscribers cannot exist before the thread does), `thread/deleted`, `thread/closed`,
  and a slim `thread/status/changed`. Orthogonal to `record.subscribers`; a GUI sidebar lives on
  this without subscribing to every thread.
- **`threadView` completes** to the parent spec §5's 13 Thread fields (gap 3), and status stops
  flattening: `{ state: "idle" | "active", waitingOn?: "decision" }` — a thread blocked on a park is
  distinguishable from one that is thinking. This deviates from parent §5's richer shape
  (`waitingOn` array, `disconnected` state) deliberately — scalar until a second waiter kind
  exists, `disconnected` is fleet-only — and is **flagged as a parent revision**, not a silent
  drift.
- **Cursor convention everywhere** (gap 2): `thread/list` and `decision/list` return
  `{data, nextCursor?}` like `thread/read` already does. `thread/read`'s `limit` gets an upper
  bound (gap 10): **`limit ≤ 500`** (clamped, not rejected) — half the M1 buffer-cap heuristic per
  item budget, keeping a max page well under the 32 MiB outbound cap.
- **`thread/read` cursor→row mapping** (gap 12): page over transcript rows via
  `sessions/reader.ts`'s existing `limit`/`offset` instead of reparsing the whole file per page.
  Rows and items are not 1:1 (phantom rows filtered, tool rows completing earlier items, nested
  rows dropped), so the cursor encodes an **absolute row offset from file start** (stable under
  an append-only transcript — unlike M1's offset-from-end replay convention, which shifts under
  appends) plus enough lookahead to complete items whose opening row falls in-page.
- **Error codes:** mint **`-33007 shuttingDown`** (gap 13); `-32001 overloaded` returns to meaning
  backpressure only. **`-33005 engineGone` starts firing** (gap 5, the emittable half): a dead
  read-loop is real on inProcess threads (probe 38), but the lib signals it only via untyped
  `Error` messages — so the **named lib change** is widening `EngineSession` with the `isEnded()`
  the real `Session` already has; handlers check it (before the call, and on failure) and answer
  `-33005` instead of a bare `-32603`. No message-matching. `-33006 unsupportedForOrigin` stays
  defined-unemitted until M3, and `-32001 overloaded` ends M2 **N/A-deferred-with-evidence**: no
  backpressure source exists in M2 (outbound overflow disconnects at `peer.ts`; inbound is
  per-frame-capped, not queued) — a backpressure policy belongs with the fleet/scale work.
- **Shutdown hygiene:** `shutdown()` routes through each record's chain (gap 7); the `ccx serve`
  run-file is removed on shutdown (gap 9); `ws` `maxPayload` drops to the protocol's own 256 KiB
  inbound cap (gap 8).
- **Live `userMessage` item** (gap 6): `turn/start` emits an `item/completed` userMessage into the
  stream so subscribers see the prompt live. **Its id is probe-gated (probe 6)**: D10's "frame
  uuid" is minted by the CLI at persistence time, so the server cannot know it at emit time —
  but `sdk.d.ts`'s `SDKUserMessage` carries an optional caller-supplied `uuid?` whose persistence
  is unprobed. Probe 6: does a caller-supplied `uuid` survive into the transcript? **Alive** →
  named lib seam (`Session.submit` gains an options bag carrying `uuid`), the server mints it,
  live id = persisted id, the D10 stitch holds. **Dead** → gap 6 ships *degraded*: userMessage is
  emitted live-only with id `user_<turnId>`, excluded from the replay buffer, and documented as
  the one item kind where live id ≠ persisted id (clients render one prompt per turn; the stitch
  dedup does not apply to it).
- **Schema plant scaffold:** `appserver/schema/` created; M1's ten method schemas migrate in as the
  pattern-setter (handlers import the schema — the schema *is* the validator). Generation tooling
  itself lands Wave 4.
- Gap 4 (store-merged `thread/list`) lands Wave 2 with the session library; gap 5's codes stay
  defined-unemitted where their trigger is M3; gap 11 (subpath export) lands Wave 4 last.

### Wave 1 — settings + introspection

**Methods:** `thread/model/set` (`string | null`, null = session default), `thread/permissionMode/set`
(full ladder incl. off-ladder `bypassPermissions`/`dontAsk`; re-runs the `resolveAutoModel`
self-heal), `thread/thinking/set` (level via shared `thinkLevels.ts` or raw tokens),
`thread/settings/apply` (`applyFlagSettings`; inProcess-only), `thread/capabilities/read`
(models + commands + agents + mcpServers — `Session.capabilities()`), `thread/contextUsage/read`,
`thread/usage/read`, `thread/init/read` (`initializationResult`), `account/read` (`accountInfo`).

**Mechanism — settings mirror + frame router.** SDK setters are setters-not-getters, so
`ThreadRecord` grows `settings: { model?, permissionMode?, thinkingTokens? }`, seeded from the
start config, written back on successful `thread/*/set`, and corrected by the engine's own status
frames. **One frame-router per thread**, installed at thread creation, routes `onFrame` traffic
to: settings mirror (→ `thread/settings/changed {model, permissionMode, thinkingTokens, source:
"client" | "engine"}` — one shape, all three knobs), `thread/tokenUsage/updated` (per-turn usage +
context %), `thread/limits/updated` (sparse merge), `thread/capabilities/changed` (the SDK's
mid-session command push — replace, never merge), `turn/todo/updated`, `task/changed`
(snapshot-replace, never merge) + `task/event`, and the compaction-boundary route (Wave 2).
The router absorbs **both** existing single-purpose watchers: the unnamed `latchSessionId`
watcher in `server.ts`, and the plan-upgrade concern — which is armed at respond time, not thread
creation, so the router consults `record.planUpgradePending` on status frames instead of a second
watcher ever being installed. **Echo-dedup rule:** the engine-frame leg suppresses its broadcast
when the frame's value equals the mirror (a client set writes the mirror first, so the engine's
echo of that change is silent; a genuinely engine-originated change differs and fires with
`source: "engine"`). Known asymmetry, stated not hidden: permissionMode changes ride status frames
(which is how `applyPlanUpgrade`'s direct `setPermissionMode` call is still mirrored); whether
`model`/`thinkingTokens` have an engine-frame carrier at all is settled empirically in Wave 1 —
if not, the mirror trusts the write-back leg alone for those two.

### Wave 2 — lifecycle + session library

**Methods:** `thread/list` (store-merge leg: live registry + session store, dedup on `sessionId`,
live-wins — gap 4), `thread/fork` (`forkSession` → a new thread born in this server),
`thread/name/set` (`renameSession`), `thread/tag/set` (`tagSession`), `thread/delete`
(`deleteSession`), `thread/compact/start`, `thread/reinitialize` (ControlFrame `reinitialize`;
inProcess-only; fresh init payload → also refreshes the capabilities mirror).

**Compaction is a turn, not a side call.** `Session.compact()` enqueues a genuine engine turn, so
driving it outside the turn machinery would leave `busy` false while the engine is turning —
concurrent `turn/start`s would be admitted and silently queue inside the engine, status would
read `idle` mid-compaction, and Wave 4's drain would start turns against a secretly busy engine.
So `thread/compact/start` **claims the full turn machinery**: busy-gated (`-33001` when busy; not
queueable in M2), sets `busy`, mints a turnId, broadcasts `turn/started`/`turn/completed` like any
turn. The outcome is its own notification, **`thread/compacted {turnId, outcome}`** (the
`parseCompactOutcome` shape), emitted from the frame router's compaction-boundary route.

**CRUD safety:** `rename`/`tag` pass through (safe live). `thread/delete` refuses while the session
is live in this server (`-33001` — close first, then delete); otherwise unrestricted, the same
trust level as the `ccx` CLI. Notifications: `thread/name/updated`, `thread/deleted`.

### Wave 3 — rewind + MCP + tasks

**Rewind:** `thread/rewind/anchors` (user-prompt UUIDs from the transcript — the host op's logic),
`thread/rewind/dryRun`, `thread/rewind` (`Session.rewind(uuid, {dryRun})`; busy-gated `-33001`;
in-place rewind is destructive — dryRun is the GUI's preview path). Result carries `skippedLinks`
(0.3.220).

**MCP:** `mcpServer/status/list`, `mcpServer/reconnect` (process-based only — SDK-type servers
throw; surface as `-32602`-class method error with the SDK's message), `mcpServer/toggle`
(advisory, not a security boundary — documented in the method schema description),
`mcpServer/set` (runtime topology swap; inProcess-only), `mcpServer/permissionModeOverride/set`
(rules-layer only; inProcess-only).

**Tasks:** `task/list` (`listBackgroundTasks`), `task/stop` (`stopTask`), `turn/background`
(`backgroundAll`, optional `toolUseId`). Lifecycle notifications ride the Wave-1 frame router.

### Wave 4 — queue, probes, consumability

**Turn queue** *(X)*: `queue: QueuedTurn[]` on the record. `turn/start {queue: true}` on a busy
thread enqueues → `{queued: true, turn: {id, status: "queued"}, position}` (without the flag:
`-33001` as today). **Ids are minted at enqueue time** — `record.turnSeq` increments when the
turn is *accepted*, not when it starts — so the enqueue reply, the cancel receipts, and the
eventual `turn/started` all carry the same id a client can correlate on. (FIFO drain preserves
seq order: a busy thread admits no non-queued turn, so enqueue order is start order.) Drain on
`settleTurn`: FIFO, one at a time, through the `turnStart` path parameterized by the pre-minted
id — same broadcasts, same buffer reset. `turn/interrupt {cancelQueued: true}` flushes the queue
*first*, then interrupts; receipt lists `cancelledQueued[]` (turn ids).

**Drain-vs-close is pinned as a mechanism, not an invariant** (the M1 teardown-liveness class:
`settleTurn` runs in `submit()`'s continuation *outside* `record.chain`, while `thread/close`
queues its dispose *on* the chain — so "never start after close" cannot be enforced by ordering
alone). Two coupled rules: (1) `thread/close` and `shutdown()` set a **`record.closing` latch
synchronously at request arrival** (the same reasoning as M1's synchronous busy gate) and flush
the queue then and there, broadcasting `turn/completed {status: "cancelled"}` for each; (2) drain
checks the latch before starting the next queued turn — a settle that races a close finds the
latch up and the queue already empty, and starts nothing. Queued turns are never silently
dropped, and no engine call starts after close. `"cancelled"`/`"queued"` are new Turn statuses —
recorded as a flagged parent-spec revision (§5's union), not a silent extension.

**Probes** — one file each, promote-or-discard criteria fixed before running:

| # | Probe | Alive → | Dead → |
|---|-------|---------|--------|
| 1 | `streamInput` mid-turn injection | `turn/steer` *(X)* ships, via a **named lib seam** `Session.steer(text)` (a push *without* a result waiter — `input.push` is only reachable through `enqueueTurn` today, which pairs every push with a waiter; steering through it would desync the FIFO) | method answers `-32601`; row N/A-dead. Never faked via interrupt+resubmit |
| 2 | `readFile` | knowledge recorded as M3 `fs/read` backing; **no M2 method** | row N/A-dead |
| 3 | `reloadPlugins` | `plugin/reload` (inProcess-only, thin) | row N/A-dead |
| 4 | `reloadSkills` | `skill/reload` (inProcess-only, thin) | row N/A-dead |
| 5 | `register_repo_root` control request | `thread/directory/add` *(X)* | row N/A-dead |
| 6 | caller-supplied `SDKUserMessage.uuid` survives to transcript (Wave 0 dependency — runs first) | `submit` options-bag seam; live userMessage id = persisted id | userMessage ships degraded per Wave 0 (live-only, no replay, stitch-exempt) |

**Schema generation + export:** generator emits `schema/json/{stable,experimental}/` (draft-7 —
the Wave-4 CLI-ajv gotcha) + TS re-exports; `ccx serve --emit-schema DIR` dumps the same pinned to
the build; a round-trip test regenerates and diffs vendored artifacts; `drift-check.mjs` gains the
entry. *(X)* methods land in the experimental set. Last: `package.json` exports
`cc-harness/appserver` (`AppServer`, `listenWs`, schema types) — after the wire surface exists,
honoring gap 11's "not until shapes settle".

**Console:** `harness/tools/appserver-console.html` — one file, raw WebSocket + DOM, zero deps,
opened via `file://`. One panel per wave; explicitly disposable (dies when a real GUI starts); no
tests. Its job: a foreign consumer that surfaces protocol awkwardness before a GUI inherits it.

## Testing

- **Unit, engine-faithful fakes (design constraint, not aspiration):** fakes model the engine's
  awkward timing — `sessionId` undefined until the first init frame, `dispose()` awaiting parked
  decisions, frames arriving between turns, setters resolving after a delay. Every guard test is
  proven by reverting its guard (the M1 sabotage rule). The frame router and queue each get a
  dedicated state-machine test file; teardown-liveness tests (close/shutdown with queued turns,
  parked decisions, armed plan upgrades) are written before review, per the standing pattern.
- **Schema round-trip** test + drift-check appserver entry extended to fail on a shipped method
  with no schema file.
- **Live (keyed, controller-run):** extends `test/live/appserver-m1.test.ts`'s pattern with
  `settingSources: []`.

## Acceptance (behavior-phrased)

1. `pnpm -C harness test` green; `node scripts/drift-check.mjs --json` exits 0 with the appserver
   pass listing zero missing rows and zero schema-less methods.
2. **Live control-plane script** (`test/live/appserver-m2.test.ts`, keyed): one WS client against a
   real session performs — `initialize{watchThreads:true}` → `thread/start` → observe
   `thread/started` → `thread/model/set` → observe `thread/settings/changed` with
   `source:"client"` → `thread/thinking/set` → `thread/capabilities/read` returns non-empty models
   + commands → turn with a file write → decision park shows `status.waitingOn === "decision"` →
   respond → `thread/usage/read` + `thread/contextUsage/read` return numbers → `thread/rewind/dryRun`
   against the turn's anchor succeeds → `mcpServer/status/list` returns → `turn/start{queue:true}`
   while busy returns `{queued: true, turn}` whose id later appears in `turn/started` when it
   drains → `thread/compact/start` completes and `thread/compacted` carries an outcome →
   `thread/fork` yields a distinct thread whose `thread/read` shares item ids with the parent →
   `thread/close`. Each observation is an assertion, not a log line.
3. **Scorecard:** every non-fleet row reads shipped or N/A-with-evidence; the six probe rows cite
   their probe file by name.
4. **Console smoke (manual, controller):** every panel of `appserver-console.html` performs its
   wave's operations against a live `ccx serve`.
5. A second WS client connected to the same thread observes the first client's `thread/model/set`
   as `thread/settings/changed` — the write-back fan-out proven, not assumed.

## Decision Log

- **D-M2-1 — debt-first waves over flat backlog / console-first** (2026-07-30): M1's defects
  clustered at shared mechanisms, so each mechanism (fan-out, cursors, mirror/router, queue) gets a
  wave boundary: designed once, inherited everywhere. *Rejected:* flat dependency-ordered backlog
  (no intermediate acceptance, review boundaries blur); console-first ordering (scatters
  state-machine work; UI convenience is not an architecture). The console's incremental growth is
  kept from the rejected option.
- **D-M2-2 — full inProcess surface, fleet/workspace/shell stay M3** (2026-07-30): the milestone's
  claim is "full control plane over the SDK engine", so all five probe-gated *Query*/control
  seams are probed now rather than at M3; `fs/*` and shell are workspace surfaces, deferred.
  *Rejected:* spec-§12-as-written (leaves Query methods unprobed — claim unearned); controls-only
  trim (defers queue/CRUD, scorecard stays scattered).
- **D-M2-3 — acceptance = scripted live client + disposable HTML console** (2026-07-30): the M1
  postmortem showed self-written doubles mirror the author's assumptions; a zero-dep foreign
  consumer surfaces consumability defects a script cannot. *Rejected:* script-only (no foreign
  consumer); real GUI in M2 (scope explosion, taste questions enter the milestone).
- **D-M2-4 — full §9 schema discipline now** (2026-07-30): M2 quintuples the wire surface; typing
  ~50 methods as built is incremental, retrofitting them later is a milestone of its own.
  *Rejected:* typed-schemas-only (consumers get no artifacts); defer-all (pass-through validation
  debt across 50 methods).
- **D-M2-5 — `watchThreads` initialize flag over a `server/watch` method or broadcast-to-all**
  (2026-07-30): one fewer round-trip and a GUI always wants it; broadcast-to-all leaks thread
  existence to clients that never asked; per-thread subscribers structurally cannot receive
  `thread/started`.
- **D-M2-6 — one frame-router per thread, absorbing the planUpgrade watcher** (2026-07-30):
  stacked single-purpose `onFrame` watchers each re-parse frames and race each other; one router
  with named routes is testable as a state machine. *Rejected:* per-concern watchers (M1's shape —
  fine for one concern, wrong for seven).
- **D-M2-7 — `thread/delete` refuses on live, otherwise CLI-trust** (2026-07-30): the server must
  not delete a session out from under its own live engine; beyond that the wire holds the same
  trust as `ccx` itself — inventing a permission model for the local token-holder is speculative.

## Surprises & Discoveries

*(running log; seeded empty)*

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-07-30 — initial version (brainstorm: full-inProcess scope, script+console acceptance, full
  §9, debt-first waves — all four confirmed by the user).
- 2026-07-30 — independent (Fable) spec review folded in, 4 Important + 6 Minor accepted: probe 6
  replaces the unsatisfiable userMessage-uuid rule; queue ids mint at enqueue + `closing` latch
  pins the drain-vs-close race; compact claims the turn machinery + `thread/compacted`; router
  absorbs `latchSessionId` and consults `planUpgradePending` (not a second watcher) + echo-dedup
  rule; `engineGone` via an `isEnded()` interface widening; `optOutNotificationMethods` +
  `warning` triggers + `overloaded` N/A-deferred; status-shape and Turn-status deviations flagged
  as parent revisions; steer's lib seam named; read cursor pinned to absolute row offset.
