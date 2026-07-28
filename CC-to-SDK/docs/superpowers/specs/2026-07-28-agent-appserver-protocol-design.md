# Agent App-Server Protocol — design (rev 3)

**Date:** 2026-07-28 · **Status:** DESIGN (pre-plan) · **Aimed coverage: 100% of the harness's
reachable capability surface** (defined precisely in §10).

The goal: a JSON-RPC control plane for `cc-harness` — the protocol a **web UI** (and any other rich
client) speaks to observe and drive the CC clone, playing the same architectural role
`codex app-server` plays for Codex: *the backend engine stays untouched; every client becomes a
peer of one hub*. This is the transport the 2026-06-17 observability spec explicitly deferred
("❌ the control-plane transport itself") and the natural capstone of the Goal-B control-plane
fidelity work.

Evidence base: a full audit of `codex-rs/app-server-protocol` + `app-server` (v2: 28 protocol
modules, ~120 requests, ~70 notifications, 11 server→client requests) and a full audit of our own
four existing control planes (library API, host/attach op protocol, daemon protocol, codex-compat
`cc-codex-appserver`). Both audits 2026-07-28.

---

## 1. Positioning — native protocol, Codex-shaped

**Decision: design a native protocol modeled on Codex's proven architecture, not a 100% Codex
wire-compat extension.**

- `cc-codex-appserver` stays what it is: a *compat adapter* for Codex-protocol clients (Director,
  claude-plugin-codex). Its translator maps assistant text only — fine for its consumers, wrong as
  a web-UI foundation.
- Our domain model genuinely differs from Codex's: three decision kinds (permission / question /
  plan) instead of two approval types; a permission-**mode ladder** instead of `approvalPolicy`;
  thinking-budget control; a session store with fork/tag/rename; 30 hook events; a fleet of
  detachable hosts. Forcing these through Codex wire shapes loses exactly the fidelity we built.
- What we take from Codex is the **architecture**, not the vocabulary (§3).

The server mounts on the existing engine seams — `ChatSession` (+ `DecisionFeed`/`BgTasks`/
`SessionEvents`/`RewindOps` mixins), `Session.onFrame`, the `PermissionBroker` interface, and the
`sessions/` store wrappers. **No new engine capability is invented — with two deliberate,
named refactors**: the broker's unattended policy becomes an explicit knob instead of the
connection-count heuristic (D3), and the TUI's pure reducers are extracted into a style-free item
mapper (§5). Everything else is a re-projection of what the harness already does (that is what
makes 100% coverage a closure property, not a feature wishlist).

## 2. Placement & process model

- **Module `harness/src/appserver/`**, exported as subpath `cc-harness/appserver`, launched as
  **`ccx serve`** (`--listen ws://127.0.0.1:PORT | unix://PATH | stdio://`). One new CLI verb; no
  new package (the codex-compat adapter needed a package because it ships to npm separately; this
  is core product).
- The server owns a **thread registry**: threads it opened in-process (via `openSession`/
  `resumeSession`) *and* threads it adopted from the fleet (an existing `ccx --bg` host, reached
  over its UDS via `remoteChatSession()` — both satisfy the same `ChatSession` contract, so the
  registry stores one interface). This is the same one-code-path trick `runForegroundImpl` plays.
- **Origin-scoped reachability.** The `ChatSession` contract (+ mixins) is the *intersection* of
  the two origins; §7's inventory exceeds it (`thread/settings/apply`, `thread/reinitialize`,
  `mcpServer/set`, `mcpServer/permissionModeOverride/set` exist only on the lib `Session`, not on
  the 25-op host wire). Rule: **every §7 method declares its origin scope** (`both` | `inProcess`
  only), the scorecard carries the column, and calling an `inProcess`-only method on a
  fleet-origin thread returns **`-33006 unsupportedForOrigin`** — a distinct, machine-readable
  refusal (never `-32601`, never `-33005`). `thread/capabilities/read` reports the thread's
  reachable method set so a web UI can grey out controls instead of probing. Growing the host
  wire to shrink the `inProcess`-only set is legitimate follow-up work, but each such op is a
  named engine change, not something this spec smuggles in.
- The web UI itself is **out of scope** for this spec (it is the first consumer, and its needs
  drive method priority, but the protocol is client-agnostic — same rule as Codex's README being
  written for the VS Code extension without depending on it).

## 3. Patterns adopted from Codex (with our mapping)

| # | Codex pattern | We adopt as |
|---|---|---|
| 1 | JSON-RPC "lite" (no `jsonrpc` field), untagged request/notification/response/error envelopes, `RequestId = string\|number` | identical — and identical to `cc-codex-appserver/src/protocol.ts`, which we promote into shared code |
| 2 | `initialize` (exactly once per connection) → `initialized` notification; `clientInfo` identifies the client; capabilities include `optOutNotificationMethods` (exact-match) | identical |
| 3 | Thread → Turn → Item; `item/started → deltas → item/completed`; no `item/updated` | identical lifecycle; item taxonomy is SDK-native (§5) |
| 4 | Server→client **requests** for approvals + `serverRequest/resolved` broadcast | **deviation** — decisions are notification + method, not reverse-request (§6, decision log D1) |
| 5 | `decline` vs `cancel` (continue turn vs abort turn) | adopted: every decision kind gets an optional `abortTurn` escalation |
| 6 | Notification envelope with `emittedAtMs`; timestamps `*At` unix-seconds / `*AtMs` millis | identical |
| 7 | Cursor pagination (`cursor`/`limit` → `data`/`nextCursor`) on every list method | identical |
| 8 | Experimental gating per method/field + **dual stable/experimental schema generation** | adopted via zod: `.meta({experimental:true})` + two generated schema trees |
| 9 | Serialization scopes (per-thread queue, global config lock, fully-concurrent reads) | adopted: `threadId`-keyed dispatch queue + `global("config")` + `none` |
| 10 | Overload backpressure (`-32001` retry-later), bounded per-connection queues | adopted |
| 11 | Schema as vendored artifact + runtime dump (`generate-ts` / `generate-json-schema`) | `ccx serve --emit-schema DIR`; drift-check joins `scripts/drift-check.mjs` ritual |
| 12 | In-process transport so the local TUI is a client of the same protocol | **deferred non-goal for v1** — the TUI keeps its host socket; converging TUI onto the app-server is a possible C7+ refactor, not this feature |

## 4. Wire basics

- Framing: NDJSON over stdio/UDS; one JSON text frame per WebSocket message. Errors:
  `-32700/-32600/-32601/-32602/-32603`, `-32001` overloaded, plus app codes: `-33001 busy`
  (turn-gated method while a turn is in flight), `-33002 alreadySettled` (decision raced —
  carries `{by}`), `-33003 unauthenticated`, `-33004 threadNotFound`, `-33005 engineGone`
  (adopted fleet host died), `-33006 unsupportedForOrigin` (method exists but this thread's
  origin cannot reach it — see §2).
- Method naming: `<resource>/<verb>` singular (`thread/start`, `decision/respond`, `fleet/list`).
- All v-shapes camelCase; every method's params/response defined in zod (single source), schemas
  generated (§9).

## 5. Domain model

**Thread** = one SDK session (keyed by our registry id `thr_…`, carrying `sessionId` once known).
Fields: `id, sessionId, title, tags, cwd, model, permissionMode, thinking: {level, maxTokens},
status, origin: "inProcess"|"fleet:<name>", createdAt, updatedAt, preview`.
`ThreadStatus = idle | active{waitingOn: ("decision"|"input")[]} | disconnected | closed` —
mirrors Codex's tagged `ThreadStatus` and our host's honest `busy()` vs projected `status()`.

**Turn** = one host turn (`seq` today → `turn_<thread>_<n>`): `id, status: inProgress | completed
| interrupted | failed, error?, startedAt, completedAt, usage?`.

**Item** taxonomy — the structured transcript a web UI renders. Mapped from SDK frames; the
mapping logic is **extracted from the TUI's pure reducers** (`liveTurn.ts`, `render.ts`,
`replay.ts`, `taskList.ts`) into shared, style-free modules (the reducers keep their terminal
renderers; the extraction gives them a structured-item output too — this fixes the known
"translator maps text only" weakness of the codex-compat adapter):

| item type | source frames | deltas |
|---|---|---|
| `userMessage` | user turn input (incl. pasted images, `@`-mentions, `!` bash, `#` memory) | — |
| `agentMessage` | assistant `text` blocks + `stream_event` text deltas | `item/agentMessage/delta` |
| `reasoning` | `thinking` blocks + deltas | `item/reasoning/delta` |
| `toolCall` | `tool_use`/`tool_result` pairs; generic shape `{tool, arguments, status, result?, parentToolUseId?, attribution?}` with a `view` discriminator for rich rendering: `command` (Bash), `fileChange` (Edit/Write/MultiEdit/NotebookEdit — carries unified diff via shared `toolDiffLines`), `fileRead`, `search`, `webSearch`, `webFetch`, `mcp`, `subagentTask` (Task; attribution from the host's per-turn correlation map), `other` | `item/toolCall/argumentsDelta` (from `input_json_delta`), `item/toolCall/statusChanged` |
| `todoList` | TodoWrite tool calls (CC-native; Codex has no item for this — we also mirror it as `turn/todo/updated` for cheap header widgets) | — |
| `planProposal` | ExitPlanMode content (the parked plan text as an item, so transcripts replay it) | — |
| `compaction` | compact boundary frames | — |
| `error` | error/limit frames (`classifyLimitMessage`) | — |

**Item identity.** Item ids are **derived, not minted**, from identifiers the SDK already
stamps — `toolCall` items use the `tool_use_id`; assistant text/thinking items use the **API
message id** (`message.id`, `msg_…`) with `#<blockIndex>` suffixes — `message.id` is the key
present identically on `message_start` stream events, the full assistant frame, and the persisted
transcript (the frame `uuid` is not guaranteed stable between the streaming and final
representations); `userMessage` items use the frame `uuid`.
Because persisted transcripts and live frames carry the *same* identifiers, "live shape ≡
persisted shape" extends to ids: the same item has the same id whether it arrived via
`thread/read` or a subscription replay. Every delta names its target `{threadId, turnId, itemId}`.

Replay rule (straight from the host's replay-first `follow()`): `thread/subscribe` synchronously
replays — `turn/started` only if a turn is in flight, buffered items, parked decisions, task
snapshot, then a final `thread/status/changed`. Cold history comes from `thread/read`
(`getSessionMessages` → the same item mapper `replay` path). **Join stitch rule** (the cold ↔
live boundary): a client joins by calling `thread/subscribe` *first* (buffering incoming events),
then `thread/read`, then draining the buffer — dropping any buffered `item/*` whose `itemId`
already appeared in the read page. Derived ids make this dedup exact; the server does not need a
coordination handshake, and a disconnect is cheap to recover (resubscribe + re-read).

## 6. Decisions (the park model) — deviation D1 from Codex

Codex asks approvals as **server→client requests** — which presumes an approving client is
connected. Our engine's defining feature is the opposite: a detached host **parks** decisions
indefinitely, clients come and go, and the first answer wins. So decisions are modeled as
**state, not RPC**:

- `decision/requested` notification — `{threadId, turnId, decision: PendingDecision}` (kind
  `permission | question | plan`, full payload incl. attribution, `expiresAt?`).
- `decision/respond` method — `{threadId, toolUseId, answer}`. `answer` is a kind-validated
  union that maps 1:1 onto the host wire's `KIND_ANSWERS` + structured-answer schema
  (`host/ops.ts`): permission → `allow_once | allow_always | deny`; question →
  `question_answer{answers: Record<string,string>, response?: string} | deny`; plan →
  `plan_approve{acceptEdits: boolean} | plan_reject{feedback?: string} | deny`. (On the host
  wire `deny` rides the legacy flat `decision` field for every kind; the adapter maps.) Each
  variant takes optional `abortTurn: true` (Codex's `cancel` semantics — deny **and**
  interrupt). There is **no client-supplied `by`**: the server stamps attribution as
  `clientInfo.name#connId` from the connection's `initialize` identity when forwarding to the
  host op (whose `by` is required), so attribution is never free-text.
- `decision/resolved` notification — `{threadId, toolUseId, by, answer}` broadcast to all
  subscribers (our `decision_settled` ≡ Codex's `serverRequest/resolved`, unified). A losing
  responder gets `-33002 alreadySettled {by}` — informational, not an error dialog.
- Parked decisions are replayed on subscribe (§5), so a browser that opens *after* the park sees it.

Broker policy becomes **explicit per thread** (`thread/start` param `unattended: "park" |
"deny"`, **default `park`** — parking is the engine's defining behavior), replacing the host's
connection-count heuristic — a browser tab asleep is not a disconnection, so counting sockets is
no longer a sane proxy for "someone is watching". Fleet-adopted threads keep their spawn-time
policy in v1: `ccx --bg` hosts are detached and therefore already park forever (the
connection-count deny only ever applied to non-detached hosts), so adoption changes nothing;
rewiring an adopted host's policy would need a new host op and is deliberately out (§2 rule).

## 7. Client→server method inventory (the 100% matrix)

Each method lists its backing seam — every row is a re-projection of something that exists.
*(X)* = ships experimental-gated.

**Handshake/meta** — `initialize`, `initialized` (notif), `server/status` (uptime, listeners,
thread count; backs `collect()` snapshot).

**Thread lifecycle** — backing: `openSession`/`resumeSession`/`sessions/*`, host `resume`, fleet:
- `thread/start` — full `HarnessConfig` surface (model, permissionMode, cwd, settings sources,
  agents, mcpServers, hooks config, thinking, sandbox…) — the 63-field knob work is the payload.
- `thread/resume` (store id), `thread/fork` (`forkSession`), `thread/attach` (adopt a fleet host
  by roster name), `thread/list` (cursor; filters cwd/tag/status; merges store sessions + live
  registry + fleet roster, **deduplicated on `sessionId`, live-wins** — a live thread is also in
  the store), `thread/read` (persisted transcript → items; **cursor-paginated** like every
  long-payload read, default page ≈200 items newest-first — the TUI's own replay cap),
  `thread/name/set` (`renameSession`), `thread/tag/set` (`tagSession`), `thread/delete`
  (`deleteSession`), `thread/subscribe` / `thread/unsubscribe` (follow/unfollow + replay-first),
  `thread/close` (dispose in-process engine; fleet host keeps running), `thread/stop` (end a
  fleet host — host `stop`).
- `thread/compact/start` (host `compact`), `thread/reinitialize` (ControlFrame `reinitialize`;
  **inProcess-only**), `thread/directory/add` *(X, probe-gated — the 0.3.220 `register_repo_root`
  control request, §13; inProcess-only)*.
- Rewind: `thread/rewind/anchors`, `thread/rewind/dryRun`, `thread/rewind` `{uuid, prevUuid,
  scope: both|conversation|code}` — host ops verbatim; busy-gated (`-33001`).

**Turn lifecycle** — backing: host `prompt`/`interrupt`/`background`, `Session.stream`:
- `turn/start` — `{threadId, input: userMessage content[], settingsOverride?}` → `{turn}` with
  the seq-correlated id; busy-gated. Slash-catalog commands submit here as prompts (3-way dispatch
  stays client-side, as in the TUI).
- `turn/interrupt` `{cancelQueued?: boolean}` — plain interrupt by default; `cancelQueued: true`
  is **Stop-means-stop-everything**: it flushes the app-server's own `turn/queue` and interrupts
  the engine. Halting the SDK while the server queue starts the next turn is exactly the failure
  the SDK docstring warns about. **The SDK-side half is unreachable at 0.3.220** — `Query.interrupt()`
  is zero-arg and no public method carries `cancel_queued` (see *Surprises & Discoveries*), so the
  receipt reports only the server-side set (`cancelledQueued[]`); `cancelled[]`/`still_queued[]`
  land when the SDK surfaces the option.
- `turn/background` (Ctrl+B → `backgroundAll`), `turn/queue` *(X)* — server-side input queue
  mirroring the TUI's client-side queue; drains FIFO on idle.
- `turn/steer` *(X)* — **probe-gated**: requires proving the unused SDK `streamInput` mid-turn
  injection headlessly. If the probe fails, the method ships `-32601` until it can work (declared
  ≠ reachable; we do not fake steer via interrupt+resubmit).

**Decisions** — `decision/list` (≡ host `pending`), `decision/respond` (§6).

**Runtime controls** — backing: host set-ops / ControlFrame / `Query` setters:
`thread/model/set` (`model: string | null` — null resets to session default, §13),
`thread/permissionMode/set` (full ladder incl. off-ladder `bypassPermissions`/
`dontAsk`; server re-runs the `resolveAutoModel` self-heal), `thread/thinking/set` (level or raw
tokens, `thinkLevels.ts` shared), `thread/settings/apply` (`applyFlagSettings`;
**inProcess-only**).

**Introspection** — backing: capabilities + wrapped Query getters:
`thread/capabilities/read` (models + commands + agents + mcpServers — the 105-command catalog for
web slash-autocomplete), `thread/contextUsage/read`, `thread/usage/read` (+ plan-utilization
fields from the C5-T6 work), `thread/init/read` (`initializationResult`), `account/read`
(`accountInfo`; auth *management* is a non-goal — token/env is the auth model, there is no
headless login flow to drive; documented gap, counts in the denominator as N/A).

**MCP** — `mcpServer/status/list`, `mcpServer/reconnect`, `mcpServer/toggle`,
`mcpServer/set` (runtime `setMcpServers` topology swap; **inProcess-only**),
`mcpServer/permissionModeOverride/set` (**inProcess-only**).

**Background tasks** — `task/list`, `task/stop`; lifecycle arrives as notifications.

**Fleet** — backing: roster + `spawnDetached` + daemon supervisor learnings:
`fleet/list` (≡ `ccx agents`), `fleet/spawn` (≡ `ccx run --bg`; returns roster entry; adoptable
via `thread/attach`), `fleet/stop`, `fleet/remove`, `fleet/gc`.

**Workspace (web-UI enablement)** *(X, milestone M3)* — `fs/read` (bounded, cwd-jailed),
`fs/search` (promote `fileComplete.ts` fuzzy logic) — the minimum for `@`-mention pickers and
diff viewing in a browser; full Codex-style `fs/*`+watch is explicitly out (the web UI reads, it
does not manage files).

**Shell** *(X)* — `thread/shellCommand` (the `!` escape; `bash.ts` seam; runs outside the
permission gate exactly like the TUI's). Its command + output are emitted as a `toolCall` item
(view `command`, attributed to the invoking client) so every subscriber's transcript stays
complete — a hub with multiple watchers must not have invisible side effects.

Sessions-store note: `listSessions`/`getSessionMessages`/`getSessionInfo`/`forkSession`/
`renameSession`/`tagSession`/`deleteSession` — all 7 wrappers are covered above; the 3 unused
Query methods (`readFile`, `reloadPlugins`, `reloadSkills`) get one probe each — alive → a gated
method (`fs/read` backing, `plugin/reload`, `skill/reload`); dead → recorded N/A. `seedReadState`
is internal plumbing, N/A by design.

## 8. Server→client notification inventory

Thread: `thread/started`, `thread/status/changed`, `thread/settings/changed` (model / mode /
thinking — one notification, write-back-sourced so *any* client sees another client's change:
the dashboard-live-state precedent), `thread/capabilities/changed` (the SDK's mid-session
command-list push — replace, don't merge; §13), `thread/name/updated`, `thread/deleted`,
`thread/closed`,
`thread/tokenUsage/updated` (per-turn result usage + context %), `thread/limits/updated`
(limit/overage classification — sparse merge like Codex rate limits).
Turn: `turn/started` `{turnId}`, `turn/completed` `{turnId, status, error?, truncated?}`,
`turn/todo/updated`.
Item: `item/started`, `item/completed`, deltas per §5 table.
Decision: `decision/requested`, `decision/resolved` (§6).
Tasks: `task/changed` (snapshot-replace, never merge — the `tasks_changed` rule), `task/event`
(raw lifecycle frame).
Fleet: `fleet/changed` (roster diff, from mtime-watching the roster dir).
Meta: `warning`, `deprecationNotice`.

## 9. Schema & drift discipline

zod is the single source of truth (`appserver/src/schema/*.ts`) → generated artifacts vendored in
repo: `schema/json/{stable,experimental}/` (draft-7 — the CLI-ajv gotcha from Wave 4) and
`schema/ts/` (`.d.ts` via `zod-to-ts` or inferred types re-export). `ccx serve --emit-schema DIR`
dumps at runtime, pinned to the build. A generation round-trip test + a `scripts/drift-check.mjs`
entry keep wire ↔ schema ↔ docs in sync. Every notification wrapped in `{…, emittedAtMs}`.

## 10. What "100% coverage" means (the scorecard)

Denominator: the union of (a) all **25** host ops (`host/ops.ts` union — 22 pre-C5 plus the
rewind trio), (b) the 11 ControlFrame verbs, (c) the 7 session store wrappers, (d) every
TUI-reachable capability in `docs/parity/tui-ux.md` §control-plane, (e) the fleet CLI verbs,
(f) the 27 SDK `Query` methods (the 22 used + the 5 unused: probed and either exposed or
recorded N/A-dead). **The denominator is generated, not hand-counted** — the very "22 vs 25"
drift this paragraph originally contained is the failure mode: `scripts/drift-check.mjs` gains
an appserver pass that walks the `hostOp` union, the `ControlFrame` union, the `sessions/`
wrapper exports, and the `Query` method surface in `sdk.d.ts`, and **fails when the scorecard's
row set diverges** from that walk (the Wave-4 discipline: a claim whose ground truth is a code
artifact is encoded as a check against that artifact, not as prose). Each row names its seam and
its **origin scope** (§2); a row is **covered** when the method ships with a unit test + the
item/notification mapping it needs. Target: every row covered or explicitly N/A-with-evidence —
no silent gaps. A new `docs/parity/appserver.md` scorecard tracks this, and `coverage.md`
domain 10 absorbs the result.
The daemon's 26 ops are **not** in the denominator as ops (the daemon predates the host protocol;
its unique capabilities — proactive loops, warm pool, supervisor spawn — enter via `fleet/*` and
`thread/start` params; a daemon-retirement decision is separate and out of scope).

## 11. Transport & security

- Default bind `ws://127.0.0.1:0` (ephemeral port, printed + written to
  `~/.claude/ccx/run/appserver.json`); UDS and stdio for same-box embedding.
- **Token auth for WS**: server mints a bearer token at startup (or `--token-file`); the
  **primary carrier is `authorization` in `initialize`** (or a `Sec-WebSocket-Protocol` bearer),
  with `?token=` a documented fallback only — query strings leak into proxy/access logs, and the
  spec explicitly contemplates non-localhost binds. UDS/stdio inherit the OS boundary (0o700 —
  today's model, unchanged). Any `Origin` not explicitly allowed → 403 (Codex's rule; web UI
  origins registered via `--allow-origin`).
- Decision attribution is server-stamped `clientInfo.name#connId` (§6) — never free-text.
- **Outbound backpressure** (the slow-consumer case `-32001` doesn't cover — a backgrounded
  browser tab not draining deltas): bounded per-connection send queue; on overflow the server
  **disconnects that subscriber** rather than buffering unboundedly or stalling the fan-out.
  Replay-first subscribe (§5) makes this cheap by design — a dropped client resubscribes and is
  made whole — which is a concrete payoff of D1 worth naming.
- Non-localhost binds refuse to start without both token and explicit `--listen` — remote
  exposure is a deliberate act.

## 12. Milestones

- **M1 — core loop** (the web UI can chat): protocol scaffold (shared with codex-compat's
  peer/protocol), `initialize`, thread start/resume/list/subscribe, turn start/interrupt, the
  item mapper extraction (the largest single work item — it un-couples `liveTurn`/`render`/
  `replay` from `RenderLine`), decisions end-to-end, WS transport + token. Live acceptance: a
  scripted WS client runs spawn→subscribe→turn→park→respond→completed against a real session.
- **M2 — controls + introspection**: settings setters, capabilities/usage/context, MCP, tasks,
  rewind, compact, queue. Acceptance: protocol-driven replication of the TUI acceptance script.
- **M3 — fleet + workspace**: fleet verbs, `thread/attach` adoption, `fs/read`/`fs/search`,
  shellCommand; probes for `streamInput`/`readFile`/`reloadPlugins`/`reloadSkills`; scorecard
  `docs/parity/appserver.md` lands at 100%-or-N/A.
- Each milestone: unit + gated live tests, `coverage.md` refresh, memory update (the standing
  ritual).

## 13. SDK 0.3.211 → 0.3.220 delta (rev 2 addendum)

The harness is lockfile-pinned to 0.3.211; npm latest is 0.3.220. A declared-surface diff of the
two tarballs (2026-07-28) found changes that bear directly on this protocol — the bump itself is
separate work (drift-check ritual + live suite), but the protocol must be designed for the 0.3.220
shapes so it isn't born stale:

- **`interrupt_cancel_queued_v1`** — interrupt now takes `cancel_queued: true`, and the SDK's own
  docstring names our exact consumer: *"a Stop-means-stop-everything client (a remote UI's Stop
  button) sets this true so one round-trip halts the session."* → `turn/interrupt` gains
  `cancelQueued?: boolean`, feature-detected via the system/init `capabilities` list; the receipt's
  `cancelled[]`/`still_queued[]` surface as the `turn/completed` payload for interrupted turns.
- **Permission-ask enrichment** — asks can now carry `suppress_always_allow_rule` (host MUST NOT
  render a persistent "always allow" affordance) and `matched_ask_rule` (ask forced by a
  user-configured `permissions.ask` rule; treat as human-intent, exempt from host auto-approval;
  render-unsafe → sanitize). Both ride `PendingDecision` verbatim; the web dialog honors them.
  `decision_reason` may carry ANSI escapes — the server sanitizes before emitting.
- **`DirectoryAdded` hook + `register_repo_root` control request** (HOOK_EVENTS 30 → 31) → new
  method `thread/directory/add` *(X, probe-gated)*; strict-subdirectory + no-re-register rules per
  the SDK docs.
- **`aborted: true` on interrupt-truncated assistant messages** → the item mapper stamps
  `aborted` on the affected `agentMessage`/`reasoning` items instead of guessing from turn status.
- **`supportedCommands()` now tracks the mid-session push** (0.3.211 returned the stale init
  list) → `thread/capabilities/read` is re-fetch-safe on 0.3.220; the command-list-changed push
  still becomes a `thread/capabilities/changed` notification.
- **Rewind result gains `skippedLinks`** (link-safety refusals, real rewind only — never on
  dryRun) → include in `thread/rewind` response; C5's rewind surface should adopt it at bump time.
- **`setModel(null|'default')` resets to session default** → `thread/model/set` models `model:
  string | null`.
- **Task/subagent telemetry** — task outputs add `modelsUsed[]`, `liveSubscription`; stream frames
  add `heartbeat`/`subagent_type`/`subagent_retry` → richer `task/event` payloads, pass-through.
  The Task tool's `mode` param is now **deprecated/ignored** (subagents inherit the parent
  session's permission mode) — audit swarm/task callers at bump time.
- **New model tools `SendFeedback`, `ProposeSkills`** → render as `toolCall` view `other`; no
  protocol change.
- **Fast mode** (`fast_mode_disabled_reason`, `FastModeDisabledReason`), **session-scoped
  `effortLevel: 'max'`**, **`workflowSizeGuideline`** setting, `anthropicGoogleCloud` provider,
  `canonicalModel`/`provider` on usage rows → settings/usage passthrough fields; fold into the
  63-field knob model at bump time (drift-check will flag them).
- **Cross-session messaging identity** — `fromSession`, `verifiedPeerPid` (kernel-verified
  SO_PEERCRED, explicitly *provenance not authentication*), `subkind: 'scheduled-trigger'` —
  relevant to future fleet-messaging surfaces, not v1.

Sequencing: the SDK bump (0.3.220 + drift-check + live re-verification) lands **before or with
M1**, since `cancelQueued` and the ask-enrichment fields change M1 wire shapes.

## 14. Decision log

- **D1** Decisions are notification+method (park-first), not server→client requests — Codex's
  reverse-request model presumes a connected approver; our detach-first engine cannot. We keep
  Codex's resolution-broadcast idea as `decision/resolved`. (§6)
- **D2** Native protocol, codex-compat adapter untouched. (§1)
- **D3** `unattended: park|deny` per-thread policy replaces connection-count deny — socket count
  is not a liveness signal once browsers exist. (§6)
- **D4** TUI does *not* migrate onto the app-server in v1 (Codex's in-process-transport endgame
  is noted as a possible C7+ refactor; forcing it now couples two stable surfaces for zero user
  value). (§3.12)
- **D5** `turn/steer` is probe-gated, never emulated — the A1 lesson applied forward. (§7)
- **D6** Auth *management* (login flows) is N/A: the SDK's auth is env/token-based with no
  headless login to drive; `account/read` is the whole surface. (§7)
- **D7** Daemon ops enter the denominator by capability, not by op — avoids enshrining a legacy
  surface as the coverage target. (§10)
- **D8** Protocol shapes target SDK 0.3.220 (rev 2); the bump precedes/accompanies M1 so the wire
  is not born stale. (§13)
- **D9** (rev 3) Methods are origin-scoped; `inProcess`-only methods refuse fleet-origin threads
  with `-33006 unsupportedForOrigin`, and `thread/capabilities/read` advertises the reachable
  set. Growing the host wire to close the gap is named follow-up work, never implicit. (§2)
- **D10** (rev 3) Item ids are derived from SDK identifiers (`tool_use_id`, frame `uuid` +
  block suffix), which makes the cold-history ↔ live-replay stitch an exact client-side dedup
  with no handshake. (§5)
- **D11** (rev 3) The coverage denominator is generated by a drift-check pass over the code
  artifacts it counts; the scorecard fails CI when its row set diverges. (§10)

## Surprises & Discoveries

- **M1 T1 (2026-07-28): `cancel_queued` is NOT reachable from the public SDK surface.** At
  0.3.220 `Query.interrupt()` is still zero-arg — `interrupt(): Promise<SDKControlInterruptResponse
  | undefined>` (`sdk.d.ts:2293`, verified twice). The `cancel_queued?: boolean` field exists only
  on the wire-level `SDKControlInterruptRequest` behind the `interrupt_cancel_queued_v1`
  capability; no public method carries it. Consequence for §7/§13: `turn/interrupt{cancelQueued:
  true}` can only flush the **app-server's own** queued prompts — the SDK's internal input queue
  cannot be flushed at 0.3.220. The scorecard records this as an upstream gap, not a coverage miss.

- **M1 T8 (2026-07-29): an interrupted turn RESOLVES, it does not reject.** `Session.submit()`
  (`src/session/session.ts`) resolves normally when a turn is interrupted — the SDK result's
  `error_during_execution` subtype is discarded by `readLoop` before the caller sees it. Any
  consumer that infers "interrupted" from a rejected submit promise is wrong: interruption must be
  tracked as *server-side state* (an `interruptRequested` flag scoped to the turn), exactly the way
  parked decisions are state rather than a request/response. The rejection path still exists for
  genuine engine failures.

- **M1 T13 (2026-07-29): under `permissionMode: "default"` the SDK does not consult `canUseTool` for
  a trivial bash command.** The first keyed acceptance run asked the model to `echo appserver-live-ok`
  and the whole turn — reasoning, `Bash` tool call, result, assistant message, `turn/completed` — ran
  through with **no `decision/requested` at all**. The same flow with a file write parks immediately
  (`Write`, `view: "fileChange"`). So "default mode asks for everything" is false headlessly: what
  summons the broker is the tool's own risk classification, not the mode alone. A live test that needs
  a park must use a write, which is the shape `test/live/daemon-permissions.e2e.test.ts` already uses.
  Second-order lesson: the acceptance must also pass `settingSources: []` — the harness loads user +
  project + local settings by default, so a developer's own `permissions.allow` rules and `defaultMode`
  silently decide whether the acceptance parks at all.

## Outcomes & Retrospective (M1, 2026-07-29)

**Achieved against the original purpose.** The spec set out to give this harness the role
`codex app-server` plays for Codex: a control plane a web UI can drive without touching the engine.
M1 delivers the core loop end to end — a browser-shaped client connects over WebSocket, starts or
resumes a thread, subscribes and is replayed what it missed, runs a turn and watches it as a
structured item stream, answers a parked permission decision, and reads the persisted history back
with ids that stitch to the live stream. It is proven, not asserted: a keyed live test drives
`initialize → thread/start → thread/subscribe → turn/start → decision/requested → decision/respond →
decision/resolved → turn/completed → thread/read`, against a real session, in about 15 seconds.
Coverage is auditable rather than claimed — a drift pass walks 70 seam tokens out of the real source
and fails the build when the scorecard falls behind, which is D11 working as intended.

**What the design got right.** D1 (decisions as *state*, not a server→client request) survived
contact with reality and paid for itself repeatedly: parks outlive a disconnect, any client can
answer, and the answer is broadcast. Extracting the item mapper as a pure sibling module rather than
re-pointing the TUI's reducers kept a live C5 branch out of the blast radius. Origin scoping was
specified before it was needed, so M3's fleet adoption has a defined refusal (`-33006`) instead of a
retrofit.

**Where the process caught what review alone would not.** Every task passed a scoped review, and
most still needed a fix round; the two whole-branch reviews then found six defects that no per-task
reviewer could have seen, three of them Critical. The pattern is worth naming: **the fakes hid the
bugs**. A fake session whose `dispose()` resolves instantly cannot expose a teardown that deadlocks
against its own parked decision; a fake that sets `sessionId` eagerly cannot expose that the real
getter stays undefined until the first turn, so `thread/read` returned an empty page forever. Both
were invisible to 1153 green unit tests and were caught only by reasoning about the *engine's* real
semantics. The lesson for M2: when a fake stands in for the engine, make it model the engine's
awkward timing, not its convenient shape.

**The live run was the highest-yield hour.** The first keyed acceptance failed by *completing
successfully* — a trivial `echo` never asks for permission under `default` mode, so there was
nothing to answer. That flushed out two facts now recorded above: what summons the broker is the
tool's risk classification rather than the mode, and a live test that loads the developer's own
settings is testing the developer's machine.

**Gaps shipped knowingly.** Ten, each named in the next section rather than discovered later by
whoever writes the web UI. The one that will be felt first is `threadView`'s five-of-thirteen fields
and the flattened `ThreadStatus`, since a UI wants `active{waitingOn}` to distinguish "thinking"
from "waiting on you".

## Carried into M2 (named, not silently dropped)

M1 shipped after two independent whole-branch reviews. These are the gaps they found that were
deliberately deferred rather than fixed — each is a *known* debt, not an oversight:

1. **`thread/started` is never broadcast.** `thread/start`/`thread/resume` reply with the thread view
   and notify nobody. With fan-out scoped to `record.subscribers`, a brand-new thread has no
   recipients, so this needs a list-level (connection-scoped) fan-out that M1 does not have.
2. **`thread/list` and `decision/list` return `{data}` with no `nextCursor`**, against §3's "cursor
   pagination on every list method". `thread/read` implements it correctly.
3. **`threadView` returns 5 of §5's 13 Thread fields**, and `ThreadStatus` is flattened to bare
   `idle`/`active` — a thread blocked on a park is indistinguishable from one that is thinking,
   losing `active{waitingOn}`.
4. **`thread/list` is registry-only** — the spec's merge of session store + fleet roster (dedup'd on
   `sessionId`, live-wins) is not wired.
5. **`-32001 overloaded`, `-33005 engineGone`, `-33006 unsupportedForOrigin` are defined and never
   emitted** — they belong to the fleet-origin work (M3) and to backpressure policy.
6. **No `userMessage` item on the live path** — a subscriber never sees its own prompt in the stream,
   only in a later `thread/read`.
7. **`AppServer.shutdown()` bypasses `record.chain`**, so a queued `thread/close` can run concurrently
   with it; benign today because `dispose()` memoizes and `denyAll()` is idempotent.
8. **`ws` `maxPayload` is left at the library default (100 MiB)** while the protocol's own inbound cap
   is 256 KiB one layer up, so a pre-`initialize` client can make the server buffer large frames.
9. **The `ccx serve` run-file is not removed on shutdown**, so a stale file can name a dead port.
10. **`thread/read`'s `limit` has no upper bound** — a large enough page can exceed the outbound cap
    and disconnect the requesting client.

## Revision Notes

- **Planning (M1, 2026-07-28):** item identity for assistant text/thinking refined from "frame
  `uuid`" to **`message.id#blockIndex`** — planning found `message.id` is the only key stable
  across stream partials, the final assistant frame, and the persisted transcript (§5 updated).
- **Planning (M1):** the §12 "item mapper extraction" is scoped for M1 as a **sibling pure
  module** (`appserver/items/`) mirroring `liveTurn.ts`'s ingest contract; re-pointing the TUI
  reducers onto it (the full un-coupling from `RenderLine`) is deferred to M2 — C5 is actively
  changing `src/tui/` and M1 must not touch it.
- M1 plan: `docs/superpowers/plans/2026-07-28-agent-appserver-m1-core-loop.md` (M2/M3 get their
  own plans).
- **M1 shipped (2026-07-29):** plan `docs/superpowers/plans/2026-07-28-agent-appserver-m1-core-loop.md`;
  item ids refined to `message.id#index` (planning); TUI reducer adoption deferred to M2. Live
  acceptance (§12's spawn→subscribe→turn→park→respond→completed) ran against a real WS connection
  and a real session (`harness/test/live/appserver-m1.test.ts`); seam-coverage scorecard at
  `docs/parity/appserver.md`.

Rev 3 incorporates the 2026-07-28 external review: three P1s (origin-scoped reachability, item
identity/stitch, generated denominator), §6 answer shapes corrected to the real `host/ops.ts`
schema (`plan_approve{acceptEdits}`, `question_answer{answers, response?}`, deny-on-flat-field),
client-supplied `by` dropped, §13 additions folded into §7/§8, Stop-button queue interplay,
unattended default + adoption semantics, and the P3 line items (token carrier, `thread/read`
pagination, `thread/list` dedup, shellCommand-as-item, outbound backpressure, honest closure
claim).
