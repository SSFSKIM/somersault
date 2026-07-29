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

**In:** all 53 `planned(M2)` scorecard rows; all 13 "Carried into M2" gaps from the parent spec; the
five live probes (`streamInput`, `readFile`, `reloadPlugins`, `reloadSkills`, `register_repo_root`)
run *now*, shipping what proves alive; the full §9 schema discipline (typed zod for every method
including M1's ten, generated draft-7 JSON + TS artifacts, `--emit-schema`, round-trip drift gate);
the `cc-harness/appserver` subpath export; a disposable single-file HTML console as foreign consumer.

**Out (M3):** `thread/attach`, `fleet/*`, `thread/stop` (fleet); `fs/read`, `fs/search` (workspace —
even if the `readFile` probe proves alive, only the *knowledge* ships in M2); `thread/shellCommand`;
`-33006 unsupportedForOrigin` still cannot fire (no fleet-origin threads exist until M3) and stays
defined-unemitted. Also out: auth management (token/env is the auth model — parent spec), daemon
retirement, any real GUI product.

## Structure — five waves, debt first

Each wave lands green (unit + typecheck + drift) and extends the live acceptance; the console grows
one panel per wave. Rationale (Decision Log D-M2-1): M1's defects clustered at shared mechanisms,
not handlers — waves put each shared mechanism at a boundary where it is designed once and
inherited, instead of improvised per handler.

### Wave 0 — spine (the 13 carried gaps + shared mechanisms)

The mechanisms every later wave builds on, plus the named debt:

- **Server-scoped fan-out** (`fanout.ts`): `initialize` gains `watchThreads?: boolean`. Watchers
  receive thread-existence events: `thread/started` (gap 1 — today it has no possible audience:
  per-thread subscribers cannot exist before the thread does), `thread/deleted`, `thread/closed`,
  and a slim `thread/status/changed`. Orthogonal to `record.subscribers`; a GUI sidebar lives on
  this without subscribing to every thread.
- **`threadView` completes** to the parent spec §5's 13 Thread fields (gap 3), and status stops
  flattening: `{ state: "idle" | "active", waitingOn?: "decision" }` — a thread blocked on a park is
  distinguishable from one that is thinking.
- **Cursor convention everywhere** (gap 2): `thread/list` and `decision/list` return
  `{data, nextCursor?}` like `thread/read` already does. `thread/read`'s `limit` gets an upper
  bound (gap 10): **`limit ≤ 500`** (clamped, not rejected) — half the M1 buffer-cap heuristic per
  item budget, keeping a max page well under the 32 MiB outbound cap.
- **`thread/read` cursor→row mapping** (gap 12): page over transcript rows via
  `sessions/reader.ts`'s existing `limit`/`offset` instead of reparsing the whole file per page.
  Rows and items are not 1:1 (phantom rows filtered, tool rows completing earlier items, nested
  rows dropped), so the cursor encodes a *row* offset plus enough context to finish straddling
  items deterministically.
- **Error codes:** mint **`-33007 shuttingDown`** (gap 13); `-32001 overloaded` returns to meaning
  backpressure only. **`-33005 engineGone` starts firing** (gap 5, the emittable half): every
  handler that calls into the session maps the lib's "not running" failure (`assertRunning`
  throw — a dead read-loop is real on inProcess threads, probe 38) to `-33005` instead of a bare
  `-32603`. `-33006 unsupportedForOrigin` stays defined-unemitted until M3.
- **Shutdown hygiene:** `shutdown()` routes through each record's chain (gap 7); the `ccx serve`
  run-file is removed on shutdown (gap 9); `ws` `maxPayload` drops to the protocol's own 256 KiB
  inbound cap (gap 8).
- **Live `userMessage` item** (gap 6): `turn/start` emits an `item/completed` userMessage (id =
  frame uuid rule from D10) into the stream and buffer, so subscribers see the prompt live, not
  only in a later `thread/read`.
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
frames. **One frame-router per thread** (installed at thread creation, *replacing* the
single-purpose planUpgrade watcher rather than stacking beside it) routes `onFrame` traffic to:
settings mirror (→ `thread/settings/changed {model, permissionMode, thinkingTokens, source:
"client" | "engine"}` — one shape, all three knobs), `thread/tokenUsage/updated` (per-turn usage +
context %), `thread/limits/updated` (sparse merge), `thread/capabilities/changed` (the SDK's
mid-session command push — replace, never merge), `turn/todo/updated`, `task/changed`
(snapshot-replace, never merge) + `task/event`, and the plan-upgrade arming it absorbs.

### Wave 2 — lifecycle + session library

**Methods:** `thread/list` (store-merge leg: live registry + session store, dedup on `sessionId`,
live-wins — gap 4), `thread/fork` (`forkSession` → a new thread born in this server),
`thread/name/set` (`renameSession`), `thread/tag/set` (`tagSession`), `thread/delete`
(`deleteSession`), `thread/compact/start` (session compact seam; outcome arrives as a notification
at the turn boundary, not inline), `thread/reinitialize` (ControlFrame `reinitialize`;
inProcess-only; fresh init payload → also refreshes the capabilities mirror).

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
thread enqueues → `{queued: true, position}` (without the flag: `-33001` as today). Drain on
`settleTurn`: FIFO, one at a time, through the normal `turnStart` path (same minting, same
broadcasts). `turn/interrupt {cancelQueued: true}` flushes the queue *first*, then interrupts;
receipt lists `cancelledQueued[]`. Teardown rule (M1's latch lesson applied in advance):
`thread/close` and shutdown fail queued turns with `turn/completed {status: "cancelled"}` — never
silently dropped, never started after close.

**Probes** — one file each, promote-or-discard criteria fixed before running:

| # | Probe | Alive → | Dead → |
|---|-------|---------|--------|
| 1 | `streamInput` mid-turn injection | `turn/steer` *(X)* ships | method answers `-32601`; row N/A-dead. Never faked via interrupt+resubmit |
| 2 | `readFile` | knowledge recorded as M3 `fs/read` backing; **no M2 method** | row N/A-dead |
| 3 | `reloadPlugins` | `plugin/reload` (inProcess-only, thin) | row N/A-dead |
| 4 | `reloadSkills` | `skill/reload` (inProcess-only, thin) | row N/A-dead |
| 5 | `register_repo_root` control request | `thread/directory/add` *(X)* | row N/A-dead |

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
   while busy returns `{queued}` and drains after → `thread/compact/start` reports an outcome →
   `thread/fork` yields a distinct thread whose `thread/read` shares item ids with the parent →
   `thread/close`. Each observation is an assertion, not a log line.
3. **Scorecard:** every non-fleet row reads shipped or N/A-with-evidence; the five probe rows cite
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
