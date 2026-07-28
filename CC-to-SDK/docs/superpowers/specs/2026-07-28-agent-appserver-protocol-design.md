# Agent App-Server Protocol — design (rev 1)

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
`sessions/` store wrappers. **No new engine capability is invented; the protocol is a re-projection
of what the harness already does** (that is what makes 100% coverage a closure property, not a
feature wishlist).

## 2. Placement & process model

- **Module `harness/src/appserver/`**, exported as subpath `cc-harness/appserver`, launched as
  **`ccx serve`** (`--listen ws://127.0.0.1:PORT | unix://PATH | stdio://`). One new CLI verb; no
  new package (the codex-compat adapter needed a package because it ships to npm separately; this
  is core product).
- The server owns a **thread registry**: threads it opened in-process (via `openSession`/
  `resumeSession`) *and* threads it adopted from the fleet (an existing `ccx --bg` host, reached
  over its UDS via `remoteChatSession()` — both satisfy the same `ChatSession` contract, so the
  registry stores one interface). This is the same one-code-path trick `runForegroundImpl` plays.
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
  (adopted fleet host died).
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

Replay rule (straight from the host's replay-first `follow()`): `thread/subscribe` synchronously
replays — `turn/started` only if a turn is in flight, buffered items, parked decisions, task
snapshot, then a final `thread/status/changed`. Cold history comes from `thread/read`
(`getSessionMessages` → the same item mapper `replay` path), so live shape ≡ persisted shape.

## 6. Decisions (the park model) — deviation D1 from Codex

Codex asks approvals as **server→client requests** — which presumes an approving client is
connected. Our engine's defining feature is the opposite: a detached host **parks** decisions
indefinitely, clients come and go, and the first answer wins. So decisions are modeled as
**state, not RPC**:

- `decision/requested` notification — `{threadId, turnId, decision: PendingDecision}` (kind
  `permission | question | plan`, full payload incl. attribution, `expiresAt?`).
- `decision/respond` method — `{threadId, toolUseId, answer, by}` where `answer` is the structured
  union already defined by `KIND_ANSWERS` (permission: `allow_once | allow_always | deny`;
  question: `question_answer{answers} | deny`; plan: `plan_approve{mode?} | plan_reject{feedback}
  | deny`), each with optional `abortTurn: true` (Codex's `cancel` semantics — deny **and**
  interrupt).
- `decision/resolved` notification — `{threadId, toolUseId, by, answer}` broadcast to all
  subscribers (our `decision_settled` ≡ Codex's `serverRequest/resolved`, unified). A losing
  responder gets `-33002 alreadySettled {by}` — informational, not an error dialog.
- Parked decisions are replayed on subscribe (§5), so a browser that opens *after* the park sees it.

Broker policy becomes **explicit per thread** (`thread/start` param `unattended: "park" |
"deny"`), replacing the host's connection-count heuristic — a browser tab asleep is not a
disconnection, so counting sockets is no longer a sane proxy for "someone is watching".

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
  registry + fleet roster), `thread/read` (persisted transcript → items, `includeItems`),
  `thread/name/set` (`renameSession`), `thread/tag/set` (`tagSession`), `thread/delete`
  (`deleteSession`), `thread/subscribe` / `thread/unsubscribe` (follow/unfollow + replay-first),
  `thread/close` (dispose in-process engine; fleet host keeps running), `thread/stop` (end a
  fleet host — host `stop`).
- `thread/compact/start` (host `compact`), `thread/reinitialize` (ControlFrame `reinitialize`).
- Rewind: `thread/rewind/anchors`, `thread/rewind/dryRun`, `thread/rewind` `{uuid, prevUuid,
  scope: both|conversation|code}` — host ops verbatim; busy-gated (`-33001`).

**Turn lifecycle** — backing: host `prompt`/`interrupt`/`background`, `Session.stream`:
- `turn/start` — `{threadId, input: userMessage content[], settingsOverride?}` → `{turn}` with
  the seq-correlated id; busy-gated. Slash-catalog commands submit here as prompts (3-way dispatch
  stays client-side, as in the TUI).
- `turn/interrupt`, `turn/background` (Ctrl+B → `backgroundAll`), `turn/queue` *(X)* — server-side
  input queue mirroring the TUI's client-side queue; drains FIFO on idle.
- `turn/steer` *(X)* — **probe-gated**: requires proving the unused SDK `streamInput` mid-turn
  injection headlessly. If the probe fails, the method ships `-32601` until it can work (declared
  ≠ reachable; we do not fake steer via interrupt+resubmit).

**Decisions** — `decision/list` (≡ host `pending`), `decision/respond` (§6).

**Runtime controls** — backing: host set-ops / ControlFrame / `Query` setters:
`thread/model/set`, `thread/permissionMode/set` (full ladder incl. off-ladder `bypassPermissions`/
`dontAsk`; server re-runs the `resolveAutoModel` self-heal), `thread/thinking/set` (level or raw
tokens, `thinkLevels.ts` shared), `thread/settings/apply` (`applyFlagSettings`).

**Introspection** — backing: capabilities + wrapped Query getters:
`thread/capabilities/read` (models + commands + agents + mcpServers — the 105-command catalog for
web slash-autocomplete), `thread/contextUsage/read`, `thread/usage/read` (+ plan-utilization
fields from the C5-T6 work), `thread/init/read` (`initializationResult`), `account/read`
(`accountInfo`; auth *management* is a non-goal — token/env is the auth model, there is no
headless login flow to drive; documented gap, counts in the denominator as N/A).

**MCP** — `mcpServer/status/list`, `mcpServer/reconnect`, `mcpServer/toggle`,
`mcpServer/set` (runtime `setMcpServers` topology swap), `mcpServer/permissionModeOverride/set`.

**Background tasks** — `task/list`, `task/stop`; lifecycle arrives as notifications.

**Fleet** — backing: roster + `spawnDetached` + daemon supervisor learnings:
`fleet/list` (≡ `ccx agents`), `fleet/spawn` (≡ `ccx run --bg`; returns roster entry; adoptable
via `thread/attach`), `fleet/stop`, `fleet/remove`, `fleet/gc`.

**Workspace (web-UI enablement)** *(X, milestone M3)* — `fs/read` (bounded, cwd-jailed),
`fs/search` (promote `fileComplete.ts` fuzzy logic) — the minimum for `@`-mention pickers and
diff viewing in a browser; full Codex-style `fs/*`+watch is explicitly out (the web UI reads, it
does not manage files).

**Shell** *(X)* — `thread/shellCommand` (the `!` escape; `bash.ts` seam; runs outside the
permission gate exactly like the TUI's).

Sessions-store note: `listSessions`/`getSessionMessages`/`getSessionInfo`/`forkSession`/
`renameSession`/`tagSession`/`deleteSession` — all 7 wrappers are covered above; the 3 unused
Query methods (`readFile`, `reloadPlugins`, `reloadSkills`) get one probe each — alive → a gated
method (`fs/read` backing, `plugin/reload`, `skill/reload`); dead → recorded N/A. `seedReadState`
is internal plumbing, N/A by design.

## 8. Server→client notification inventory

Thread: `thread/started`, `thread/status/changed`, `thread/settings/changed` (model / mode /
thinking — one notification, write-back-sourced so *any* client sees another client's change:
the dashboard-live-state precedent), `thread/name/updated`, `thread/deleted`, `thread/closed`,
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

Denominator: the union of (a) all 22 host ops, (b) the 11 ControlFrame verbs, (c) the 7 session
store wrappers, (d) every TUI-reachable capability in `docs/parity/tui-ux.md` §control-plane,
(e) the fleet CLI verbs, (f) the 27 SDK `Query` methods (the 22 used + the 5 unused: probed and
either exposed or recorded N/A-dead). Each row in the matrix (§7) names its seam; a row is
**covered** when the method ships with a unit test + the item/notification mapping it needs.
Target: every row covered or explicitly N/A-with-evidence — no silent gaps. A new
`docs/parity/appserver.md` scorecard tracks this, and `coverage.md` domain 10 absorbs the result.
The daemon's 26 ops are **not** in the denominator as ops (the daemon predates the host protocol;
its unique capabilities — proactive loops, warm pool, supervisor spawn — enter via `fleet/*` and
`thread/start` params; a daemon-retirement decision is separate and out of scope).

## 11. Transport & security

- Default bind `ws://127.0.0.1:0` (ephemeral port, printed + written to
  `~/.claude/ccx/run/appserver.json`); UDS and stdio for same-box embedding.
- **Token auth for WS**: server mints a bearer token at startup (or `--token-file`); clients pass
  `?token=` at upgrade or `authorization` in `initialize`. UDS/stdio inherit the OS boundary
  (0o700 — today's model, unchanged). Any `Origin` not explicitly allowed → 403 (Codex's rule;
  web UI origins registered via `--allow-origin`).
- `by` attribution on `decision/respond` becomes `clientInfo.name#connId` — server-stamped, not
  free-text, once identity exists.
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

## 13. Decision log

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
