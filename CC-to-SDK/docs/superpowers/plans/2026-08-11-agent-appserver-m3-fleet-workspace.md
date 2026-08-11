# Agent app-server M3 — fleet adoption + workspace + shell + reopen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development
> (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The whole M3 spec ([`docs/superpowers/specs/2026-08-11-agent-appserver-m3-design.md`](../specs/2026-08-11-agent-appserver-m3-design.md)):
attach the app server to the running ccx fleet as a follower of each session's own host socket
(full bridge, `-33006` activation, four additive host-wire revisions), plus `fs/read`/`fs/search`,
`thread/shellCommand`, `thread/reopen` (scorecard gap 10), and the SDK 0.3.227 bump. Methods
51 → 58; notification count unchanged.

**Architecture:** A second `EngineSession` implementation (`fleetEngine.ts`) over the in-repo host
wire — the registry, router, turns spine, and dispatch are untouched for inProcess threads. Fleet
records differ by construction: turn ids derive from the host seq (never `mintTurnId`), decisions
are *views* forwarded to the host park (never settled locally), flag accumulators and
`swapEngine`/`repushThreadState` never run, and three orchestrating handlers (`rewind`/`clear`/
`compact`) branch to forward host ops instead of orchestrating locally. Read spec §1a–§1f before
any fleet task — the spec is the contract; this plan is the build order.

**Tech Stack:** TypeScript (ESM, NodeNext), zod v4, vitest, `ws`, `node:net` UDS. **No new
dependency.**

## Global Constraints

- Work on branch `m3-appserver` (worktree `.claude/worktrees/m3-appserver`). Commit per task.
  **Never `git stash`. Never push. One implementer at a time — absolute.** `git add` only files
  your task names.
- All commands run from `CC-to-SDK/harness` unless stated. Suite: `npx vitest run`. Typecheck:
  `npm run typecheck`. Drift gate (from `CC-to-SDK/`): `node scripts/drift-check.mjs` — **must be
  green at every task's commit**; any task that registers a wire method updates its
  `docs/parity/appserver.md` row in the same commit (presence + staleness + bijection all gate).
- Live/keyed steps (probe, acceptance) are **controller-run** with `set -a; . ../.env; set +a` —
  never commit or print the key/token. Unit tests must not require a key.
- Fleet-thread invariants (spec §1b–§1d, enforce in review): no `mintTurnId`, no
  `flagPerms`/`flagOutputStyle`/`flagEffort` writes, no `swapEngine`, no `repushThreadState`, no
  local decision settlement. Refusal precedence: origin gate (`-33006`) BEFORE absent-member
  `-32601`.
- Notifications only via `Peer.notify` fanout helpers; schemas in `appserver/schema/*` with zod v4;
  artifacts regenerate via the existing `schema/emit.ts` path (defaulted-params required-stripping
  stays). New error codes: `-33008 ATTACH_FAILED` (this plan), `-33006` becomes emittable.
- Commit messages: `feat(as3): …` / `fix(as3): …` / `docs(as3): …`. No Co-Authored-By.

## File Structure (whole plan)

- **Host wire (Task 2):** modify `src/host/ops.ts`, `src/host/server.ts`, `src/host/host.ts`,
  `src/host/wire.ts` (only if a type needs widening), `src/client/remote.ts` (additive uuid);
  test `test/unit/host-wire-m3.test.ts` (or grow the existing host test file — follow its name).
- **Appserver core (Tasks 3, 6–11, 14):** create `src/appserver/fleetEngine.ts`,
  `src/appserver/fleet.ts`, `src/appserver/workspace.ts`, `src/appserver/schema/fleet.ts`,
  `src/appserver/schema/workspace.ts`; modify `src/appserver/registry.ts`,
  `src/appserver/server.ts`, `src/appserver/turns.ts`, `src/appserver/rewind.ts`,
  `src/appserver/settings.ts`, `src/appserver/settingsOps.ts`, `src/appserver/mcp.ts`, the
  decisions module (whichever file holds `makeDecisions`/`decision/respond` — read `server.ts`
  first), `src/appserver/schema/index.ts`, `src/appserver/index.ts` (barrel),
  `src/appserver/rpc.ts` (−33008).
- **Test substrate (Task 5):** create `test/helpers/fakeHost.ts`.
- **Probe (Task 4):** create `probes/probes/106-fleet-attach-live.ts` (repo root `probes/`
  workspace; renumber to next free if the corpus moved — check `ls probes/probes | sort -n | tail`).
- **Workspace/console/acceptance (Tasks 12–17):** modify `tools/appserver-console.html`; create
  `test/live/appserver-m3-acceptance.test.ts`; modify `docs/parity/appserver.md` (rows per task,
  totals in Task 17), `docs/parity/coverage.md` (Task 17).

---

### Task 1: SDK 0.3.227 bump + drift ritual + `resumeDropsTurn`

**Files:**
- Modify: `package.json` (`"@anthropic-ai/claude-agent-sdk": "^0.3.227"`), `package-lock.json`
  (via `npm install`), `src/session/index.ts` (rewind seam), spec `## Surprises & Discoveries`
  (drift notes)
- Test: extend `test/unit/session-factories.test.ts` (or the file that covers `rewindSession` —
  find it with `grep -rl rewindSession test/unit`)

**Interfaces:**
- `rewindSession(id, messageId, opts)` currently builds `{resume: id, resumeAt: messageId, forkSession?}`
  (`src/session/index.ts:32-35`). It gains an optional `droppedTurnUuid?: string` opt that maps to
  the SDK's `resumeDropsTurn` (0.3.227: with `resumeAt`, declares the prompt uuid of the turn the
  truncating resume discards; the CLI refuses at fork time if trailing entries belong to another
  turn — refusal arrives as `error_during_execution` whose message starts
  `Resume rejected by --resume-drops-turn:`).
- Callers: `grep -rn "rewindSession\|resumeAtFactory" src/ | grep -v test`. The app-server rewind
  path (`server.ts`'s `resumeAtFactory` default and `rewind.ts`) passes the dropped turn's prompt
  uuid **where it already holds one** (the rewind target's `uuid` param IS the anchor being cut
  back to; the dropped-turn uuid is the anchor *after* it when the caller knows it — if no caller
  has it cheaply, plumb the opt but leave call sites unchanged and record that in the spec's
  Surprises; do NOT invent a transcript scan).

- [ ] **Step 1:** `npm install @anthropic-ai/claude-agent-sdk@^0.3.227` — then `npx vitest run`
  + `npm run typecheck` to catch any declared-surface break (expected: none; delta is five
  optional props).
- [ ] **Step 2:** Run the SDK-drift ritual: `node ../scripts/drift-check.mjs` (from `CC-to-SDK`:
  `node scripts/drift-check.mjs`) and whatever `package.json` script wraps the SDK-surface diff
  (`grep '"drift' package.json`). Record the five-property delta in the spec's Surprises (one
  line: `awsPairs`, `crossSessionInbound`, `dialogExpiry`, `forceLoginGatewayUrl`,
  `resumeDropsTurn` — only the last is adopted).
- [ ] **Step 3: Failing test** — `rewindSession("sid","uuid",{droppedTurnUuid:"drop-1"})` invokes
  the query factory with options containing `resumeDropsTurn:"drop-1"`; without the opt, the key is
  ABSENT (not undefined-valued — assert `"resumeDropsTurn" in opts === false`).
- [ ] **Step 4:** FAIL → implement → PASS + suite + typecheck.
- [ ] **Step 5: Commit** — `feat(as3): SDK 0.3.227 + resumeDropsTurn rewind opt (Wave 0)`.

---

### Task 2: Host-wire revisions §1a (a–d)

The four additive host revisions. Read spec §1a verbatim first. **All additive: no existing
frame/reply shape changes, only new optional fields and new emissions.**

**Files:**
- Modify: `src/host/host.ts`, `src/host/ops.ts`, `src/host/server.ts`, `src/client/remote.ts`
- Test: `test/unit/host-wire-m3.test.ts` (new; use the existing host test file's harness pattern —
  find it: `grep -rl "HostServer" test/ | head`)

**Interfaces:**
- **(a) swap announces:** `SessionHost.swapEngine` (`host.ts:392-427`) emits the existing `rewound`
  event after installing the replacement: resume path → `{kind:"rewound", sessionId}` (the resumed
  id), clear path → `{kind:"rewound", cleared:true}` (sessionId omitted — a fresh conversation has
  none until init; `wire.ts:13-39` already types both fields optional). `rewind()`'s own emission
  (`host.ts:705`) is untouched — do not double-emit on the rewind path (rewind does not go through
  `swapEngine`; verify by reading, note in test).
- **(b) prompt uuid:** `hostOp`'s `prompt` member (`ops.ts:42`) gains `uuid: z.string().min(1).optional()`;
  `server.ts`'s prompt dispatch (`:166-172`) passes it through; `SessionHost`'s run path hands it to
  `Session.submit`'s existing `{uuid}` opt (trace `runTask` from `host.ts:290`). `RemoteChatSession.prompt`
  (`remote.ts`) gains an optional trailing `uuid?: string` (additive; TUI callers unchanged).
- **(c) status fields:** `HostStatus` (`ops.ts:4`) gains `model?: string` and
  `thinkingTokens?: number`; `SessionHost` fills them from its own mirrors where it fills
  `permissionMode`; `set_model`/`set_thinking` handlers (`host.ts:353,360`) emit a `state` event
  after applying (same emission helper `status`/`state` already uses — find the existing
  `{kind:"state"}` push site and reuse it).
- **(d) capabilities:** the host `capabilities` op result gains the `agents` catalog — widen
  `HostSession.capabilities` (`host.ts:54`) to return all four catalogs the engine's
  `capabilities()` provides (`appserver/registry.ts:51` names the four; the underlying
  `Session.capabilities` already returns them — the host was dropping one; verify and forward
  verbatim).

- [ ] **Step 1: Failing tests** (drive a real `HostServer` over a UDS with a stubbed session, the
  existing host-test pattern): (a) `resume` op → a `{kind:"rewound", sessionId}` event reaches a
  follower; `clear` op → `{kind:"rewound", cleared:true}` with NO sessionId key; (b) `prompt` op
  with `uuid:"u-1"` → the stub session's `submit` receives `{uuid:"u-1"}`; without uuid → opts
  carry no uuid key; (c) `status` reply carries `model` from the stub; `set_model` op → a follower
  receives a `state` event whose status carries the new model; (d) `capabilities` reply contains
  the stub's `agents` catalog verbatim.
- [ ] **Step 2:** FAIL → implement → PASS + whole suite (the TUI's own host tests must stay green —
  additive means additive) + typecheck.
- [ ] **Step 3: Sabotage-verify** (a): comment out the swapEngine `rewound` emission — the resume
  test FAILS with a missing-event timeout; restore. Report observed output.
- [ ] **Step 4: Commit** — `feat(as3): host wire — swap announces, prompt uuid, status model/thinking + setter state, agents catalog (§1a)`.

---

### Task 3: Origin widening + refusal machinery

**Files:**
- Modify: `src/appserver/registry.ts`, `src/appserver/server.ts`, `src/appserver/rpc.ts`,
  `src/appserver/settings.ts`, `src/appserver/mcp.ts`, `src/appserver/reloads.ts`,
  `src/appserver/lifecycle.ts`, `src/appserver/turns.ts` (queue-flag gate), plus wherever
  `account/read`/`thread/init/read` dispatch (`grep -rn '"account/read"\|"thread/init/read"' src/appserver`)
- Test: `test/unit/appserver/origin-gate.test.ts` (new)

**Interfaces:**
- `registry.ts`: `export type ThreadOrigin = "inProcess" | "fleet";` — chase every compile error;
  each site gets an explicit branch or a deliberate both-origins pass (comment why only where
  non-obvious).
- `rpc.ts`: `-33008 ATTACH_FAILED` joins the code table (message `"attach failed"`; `data` may
  carry `{matches}` — Task 7).
- **The origin gate:** one helper in `registry.ts` —
  ```typescript
  const FLEET_UNSUPPORTED = new Set(["turn/steer", "thread/settings/apply", "mcp/servers/set",
    "mcp/permissionOverride/set", "plugin/reload", "skill/reload", "thread/reinitialize",
    "account/read", "thread/init/read", "thread/reopen"]);
  export function originRefusal(record: ThreadRecord, method: string): RpcError | null
  ```
  consulted in dispatch **before** the absent-member `-32601` mapping and before handler entry
  (find the single dispatch seam in `server.ts` where the method table routes thread-scoped
  calls — the `-33005` gate at `server.ts:517` is the model). Message:
  `"unsupported for fleet-origin threads"`. `turn/start {queue:true}` refuses inside the turns
  handler (the method itself stays allowed): fleet + queue flag → `-33006`.
  NOTE: exact method-name strings MUST match `methodSchemas` keys — copy them from
  `schema/index.ts`, do not retype from memory; the origin-gate test cross-checks membership
  against `methodSchemas`.
- **`thread/resume` live-session guard** (`server.ts:162-166` → `startThread`): before spawning,
  scan fleet records (`registry`) for a record whose `sessionId` matches, and roster rows
  (`collectFleet` from `src/fleet/index.ts` — LIVE rows only) for the same. Match → `-32602`
  `"sessionId belongs to a running fleet session; use thread/attach"`.
- `threadView` gains `cwd` (inProcess: `record.config.cwd` if set, else `process.cwd()`; fleet:
  roster cwd — Task 7 fills it) and optional `short`/`name` (fleet only). Update the view builder
  (`server.ts:90` region) + its snapshot/type.

- [ ] **Step 1: Failing tests** — a fake fleet-origin record (hand-built: `origin:"fleet"`, fake
  session): each `FLEET_UNSUPPORTED` method answers `-33006` (drive through the real dispatch, not
  the helper — wire-level `handleMessage`); the same methods on an inProcess record do NOT hit the
  gate (spot-check three); a fleet record whose engine lacks `compact` still answers `-32601` for
  `thread/compact/start` (precedence only inverts for gated methods); `turn/start {queue:true}` on
  fleet → `-33006`, without flag → proceeds to the busy gate; `thread/resume` with a sessionId
  matching an attached fleet record → `-32602` with the guard message; the gate's method set ⊆
  `Object.keys(methodSchemas)` (typo tripwire).
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck (the union widening will touch many
  files — keep each branch minimal).
- [ ] **Step 3: Sabotage-verify** the precedence: reorder dispatch so the absent-member check runs
  first — the steer/-33006 test FAILS reporting `-32601`; restore. Report observed output.
- [ ] **Step 4: Commit** — `feat(as3): ThreadOrigin widens, -33006 origin gate + precedence, -33008, resume live-session guard, threadView.cwd`.

---

### Task 4: P106 — live fleet probe (spike; controller-run, keyed)

**Files:**
- Create: `probes/probes/106-fleet-attach-live.ts` (from repo `probes/` workspace; run
  `npx tsx probes/106-fleet-attach-live.ts`)

**The questions (spec §Testing, P106):** (1) replay order on mid-turn attach matches
`host.ts:513-546`'s documented order; (2) the result-type SDK frame arrives via `{kind:"message"}`
(production-implied; make it evidence); (3) exact `answer` receipt shapes: lost race
(`{ok:true, alreadyAnsweredBy}`), kind-mismatch, no-parked; (4) `decision_settled` attribution
(`by`); (5) `stop` op receipt vs socket-close ordering.

**Steps (spike — build → run → record, no TDD):**
- [ ] **Step 1:** Write the probe: spawn a detached session via the CLI's own spawn seam
  (`spawnDetached` from `src/cli/spawn.ts` — import from `cc-harness` source via tsx path alias the
  other 60/70-series probes use; copy their import pattern), targeting a scratch cwd, prompt it
  with a multi-step Bash task (sequential `sleep 2` — the probe-103b lesson: real wall-clock, not
  a long prompt). Dial the socket raw (`node:net` + NDJSON — copy probe 62's framing). Mid-turn:
  connect a second raw client, `follow`, record the replay frame order verbatim. Then: prompt a
  turn that triggers a permission park (e.g. a Write outside the sandbox profile — copy the park
  recipe from probe 63), answer from BOTH clients (second answer records the lost-race receipt),
  answer with a wrong-kind outcome (records kind-mismatch), answer a bogus toolUseID (records
  no-parked). Finally `stop` and record receipt + close order.
- [ ] **Step 2:** Controller runs it keyed. Record verdicts as a `## P106 verdicts` block appended
  to the spec's Surprises: replay order, result-frame presence, the three receipt shapes verbatim
  (JSON), settled-by attribution, stop/close order.
- [ ] **Step 3:** Kill the spawned session (its own `stop` — never `tmux kill-server`-class
  cleanup); verify roster row terminal.
- [ ] **Step 4: Commit** — `feat(as3): P106 fleet attach probe + recorded verdicts`.

---

### Task 5: `fakeHost` test harness

**Files:**
- Create: `test/helpers/fakeHost.ts`
- Test: `test/unit/appserver/fake-host.test.ts` (harness self-test)

**Interfaces (Produces — every fleet task consumes this):**
```typescript
export interface FakeHostControls {
  socketPath: string;                       // real UDS in a tmpdir
  row: RosterRow;                           // roster row pointing at this host (short "fh1")
  emitMessage(m: unknown): void;            // push {kind:"message", data:m} to followers
  emitTask(t: unknown): void;
  beginTurn(seq: number): void;             // {kind:"turn",phase:"start",seq} + busy latch
  endTurn(seq: number, error?: string): void;
  park(entry: PendingDecisionLike): void;   // {kind:"decision"} + host-side registry
  settle(toolUseID: string, by: string): void; // {kind:"decision_settled",...}
  setStatus(patch: Partial<HostStatus>): void; // {kind:"state", status}
  emitRewound(p: {sessionId?: string; cleared?: true}): void;
  promptCalls: Array<{ text: string; uuid?: string }>;
  ops: string[];                            // every op name received, in order
  close(): Promise<void>;                   // socket teardown (simulates host death)
}
export async function startFakeHost(opts?: { busy?: boolean; status?: Partial<HostStatus> }): Promise<FakeHostControls>
```
- Implementation: run the REAL `HostServer` (`src/host/server.ts`) with a hand-written
  `HostHandlers` stub (NOT a real `SessionHost`) that: replies `{ok:true, accepted:true, seq}` to
  `prompt` (or `{ok:false, error:"busy"}` when busy), implements `answer` with first-answer-wins +
  the three receipt shapes from P106's recorded verdicts, `follow` with the replay order from
  `host.ts:513-546` (turn-start-if-busy → buffered `replay:true` messages → parked decisions →
  tasks → state), and records every op. Follow-replay fidelity is the harness's whole value — copy
  the order from `host.ts`, cite it in a comment.

- [ ] **Step 1: Failing self-test** — start; raw-dial; `follow` while `busy:true` yields exactly
  the documented order; `prompt` records `{text, uuid}`; `close()` ends the socket (client sees
  `close`).
- [ ] **Step 2:** FAIL → implement → PASS + suite.
- [ ] **Step 3: Commit** — `feat(as3): fakeHost harness — real HostServer over stub handlers`.

---

### Task 6: `FleetEngineSession` core

**Files:**
- Create: `src/appserver/fleetEngine.ts`
- Modify: `src/appserver/registry.ts` (only if a record field is needed — prefer none)
- Test: `test/unit/appserver/fleet-engine.test.ts`

**Interfaces (Produces):**
```typescript
export interface FleetEngineEvents {                 // consumed by Task 7's fleet layer
  onTurn(cb: (e: { phase: "start" | "end"; seq: number; error?: string }) => void): () => void;
  onDecision(cb: (e: unknown) => void): () => void;
  onDecisionSettled(cb: (e: { toolUseID: string; by: string; decision: string }) => void): () => void;
  onState(cb: (s: HostStatusLike) => void): () => void;
  onRewound(cb: (e: { sessionId?: string; cleared?: true }) => void): () => void;
  onSocketDeath(cb: () => void): () => void;
}
export interface FleetEngineSession extends EngineSession, FleetEngineEvents {
  readonly kind: "fleet";
  answer(toolUseID: string, outcome: unknown): Promise<AnswerReceipt>;  // Task 8
  sendOp<T>(op: Record<string, unknown>): Promise<T>;                   // typed escape for forwarded ops
}
export async function connectFleetEngine(socketPath: string): Promise<FleetEngineSession>
```
- `submit(prompt, onMessage, opts)`: send `{op:"prompt", text, uuid: opts?.uuid}` → reply
  `{ok, accepted, seq}`; `{ok:false, error:"busy"}` → throw a busy-shaped error the turns spine
  maps to `-33001`. Settle on the seq-matched `{kind:"turn", phase:"end", seq}` using an
  ends-before-waiter ledger (the `chatAdapter.ts:18-25,60-63` pattern — an end may arrive before
  the prompt reply resolves the seq). During the window, `{kind:"message"}` frames flow to
  `onMessage`; capture the result-type SDK frame (`data.type === "result"`) as the returned
  `result`; a turn-end with `error` → `{result, error: {message}}` (the spine's `TurnFailure`
  shape — read `turns.ts`' onFailure to match).
- **Seq-less turn frames are replay markers**: ignore for busy/settle (spec §1b bold rule).
- `interrupt()` → `{op:"interrupt"}`. `dispose()` → send `unfollow`, destroy socket — NEVER the
  `stop` op. `isEnded()` → socket-close latch (also flips on `close()` from Task 5's harness).
  `onFrame(cb)` → `{kind:"message"}`/`{kind:"task"}` only (host-synth frames go to the typed
  events above, never the router).
- Optional members present (forwarding, spec §1b table): `stopTask`, `backgroundAll`,
  `listBackgroundTasks`, `mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`, `compact`,
  `usage`, `getContextUsage`, `capabilities`, `setModel`, `setPermissionMode`,
  `setMaxThinkingTokens`, `getSettings` — each a `sendOp` one-liner mapping the host reply's
  payload; error replies (`{ok:false, error}`) throw with the host's message. **Absent** (do not
  declare): `steer`, `setMcpServers`, `setMcpPermissionModeOverride`, `reloadPlugins`,
  `reloadSkills`, `reinitialize`, `applyFlagSettings`, `rewind`.

- [ ] **Step 1: Failing tests** (all over `startFakeHost()`): submit resolves on matching end with
  the captured result frame; end-before-reply race (fake emits end synchronously before the reply
  is read) still settles; busy refusal throws the `-33001`-mappable shape; seq-less start (replay
  marker) does NOT open a waiter and a later real turn works; messages reach `onMessage` only
  within the window; onFrame sees message+task frames but NOT decision/state frames; interrupt
  sends the op; dispose sends `unfollow` and never `stop` (assert on `ops`); socket `close()`
  latches `isEnded` and fires `onSocketDeath`; forwarded member `usage()` maps the fake's reply.
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck.
- [ ] **Step 3: Sabotage-verify** the ledger: make settle require reply-before-end ordering — the
  race test FAILS (hangs → timeout); restore. Report output.
- [ ] **Step 4: Commit** — `feat(as3): FleetEngineSession — submit/settle over seq ledger, typed host events, forwarded members`.

---

### Task 7: `thread/attach` + `fleet/list`

**Files:**
- Create: `src/appserver/fleet.ts`, `src/appserver/schema/fleet.ts`
- Modify: `src/appserver/server.ts` (handler table + fleet record registration),
  `src/appserver/registry.ts` (record gains `short?`/`name?`; fleet ctor path),
  `src/appserver/schema/index.ts`, `docs/parity/appserver.md` (two new rows)
- Test: `test/unit/appserver/fleet-adoption.test.ts`

**Interfaces:**
- Schemas:
```typescript
import { z } from "zod/v4";
export const fleetListParams = z.object({});
export const threadAttachParams = z.object({ target: z.string().min(1) });
```
- **`fleet/list`** → `{ data: FleetRow[] }` where `FleetRow = {short, name, kind, state, pid, cwd,
  sessionId?, startedAt, endedAt?, unresponsive?, threadId?}` — a **roster + projection join**:
  read roster rows (`src/fleet/roster.ts` readers) and fold live state via the same seams
  `collectFleet`/`projectRow` use (`src/fleet/index.ts:24-39`, `project.ts:23-37`); `threadId`
  from scanning registry records with matching `short`. Un-chained, server-scoped (no threadId
  param).
- **`thread/attach {target}`** (spec §1e, exact): resolve against roster rows with the CLI's
  simultaneous filter (`src/cli/lifecycle.ts:15-27`): `short === t || sessionId === t || name === t`.
  Zero matches → `-33008` `"no fleet session matches <t>"`; multiple → `-33008` with
  `data.matches = [{short, name}]`; terminal row → `-33008` `"session already ended"`. Already
  attached (a registry record with this short) → return that record's `threadView` (idempotent —
  no new record, no notification). Else: `connectFleetEngine(hostSocketPath(row.pid))` (path from
  `src/fleet/paths.ts:31-33`) — dial failure → `-33008` with the socket error; seed transcript
  from disk (`getSessionMessages(row.sessionId)`, `src/sessions/` — skip when no sessionId yet)
  into the record's read substrate the same way `thread/resume` seeds history (read `startThread`
  and mirror); register record `{origin:"fleet", short, name, cwd: row.cwd, sessionId: row.sessionId}`;
  wire the fleet event layer:
  - `onTurn` start → derive `turnId = "t" + seq + "@e" + record.epoch`, set busy, broadcast
    `turn/started`; end → settle + `turn/completed` (status from `error` presence; interrupts
    arrive as host-side turn ends — no local status synthesis).
  - `onState` → mirror updates (permissionMode/model/thinkingTokens/sessionId) +
    `thread/status/changed` + `thread/settings/changed` when a mirrored knob moved.
  - `onRewound` → `record.epoch += 1`, reconcile `record.sessionId`, broadcast `thread/rewound`.
  - `onSocketDeath` → Task 9's sequence (stub for now: latch only; Task 9 completes it).
  - subscribe replay for late wire-clients keeps working through the normal record substrate.
  Reply: `threadView` (with `cwd`/`short`/`name`); broadcast `thread/started`.
  Settings mirror seed: `status` op + `getSettings` at attach (model/permissionMode/
  thinkingTokens from HostStatus — §1a-c).
- Scorecard: add `fleet/list` + `thread/attach` rows (`shipped(M3)`, origin `fleet-only` n/a —
  they're server-scoped/adoption methods; follow the existing row grammar).

- [ ] **Step 1: Failing tests** (fakeHost + a temp roster dir — point the roster path resolver at
  a tmpdir via its env/injection seam; find it in `src/fleet/paths.ts`): fleet/list joins roster +
  live state and marks `threadId` after an attach; attach resolves by short, by name, by
  sessionId; ambiguity (two rows, one's name === other's short) → `-33008` with both matches in
  data; terminal row → `-33008`; dead socket → `-33008`; an `unresponsive` row (live pid, no
  socket) appears in fleet/list with the flag and its attach fails `-33008`; happy path → record registered with
  origin/cwd/short, `thread/started` observed, mirror seeded from fake status (model present);
  idempotent re-attach returns the same threadId with no second notification; foreign turn (fake
  `beginTurn(7)` unprompted) → `turn/started` with `t7@e0`; fake `emitRewound({sessionId:"s2"})` →
  epoch bump + `thread/rewound` + cursor invalidation (mint a read cursor pre-rewound, expect
  `-32602` after).
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck + **drift gate green** (from
  `CC-to-SDK`: `node scripts/drift-check.mjs`).
- [ ] **Step 3: Sabotage-verify** attach idempotency: make re-attach register a second record —
  the idempotency test FAILS (two thread ids); restore. Report output.
- [ ] **Step 4: Commit** — `feat(as3): thread/attach + fleet/list — adoption core over FleetEngineSession`.

---

### Task 8: Decision forwarding (views over the host park)

**Files:**
- Modify: `src/appserver/fleetEngine.ts` (the `answer` member), `src/appserver/fleet.ts` (the
  `onDecision`/`onDecisionSettled` wiring), the decision module (`grep -rn "decision/respond" src/appserver`
  — the handler + teardown live there), `src/appserver/server.ts` if the respond path branches there
- Test: `test/unit/appserver/fleet-decisions.test.ts`

**Interfaces:**
- `FleetEngineSession.answer(toolUseID, outcome): Promise<AnswerReceipt>` sends
  `{op:"answer", toolUseID, answer: outcome}` (structured answer form, `ops.ts:19-33`); receipt
  type mirrors P106's recorded shapes:
  `{ok:true} | {ok:true, alreadyAnsweredBy:string} | {ok:false, error:string}`.
- `onDecision` → park a **view** entry in the record's decision substrate with the host's
  `toolUseID` as the decision id and the host entry's kind/payload mapped to the wire's decision
  shape (read the local park's entry builder and mirror its fields; the vocabularies are 1:1 —
  spec §1b). Broadcast the same `decision/requested`-family notification the local park uses.
- `decision/respond` on a fleet thread: forward via `answer`; map receipts exactly (spec §1b):
  `{ok:true, alreadyAnsweredBy}` → `-33002` with `data.by`; `{ok:false}` "no parked request" → the
  local path's not-found error (read what the local handler answers for an unknown id and match
  it); kind-mismatch `{ok:false, error}` → `-32602` with the host message. Plain `{ok:true}` →
  the local success reply shape. **Never settle the local view from the respond path** — removal
  happens only when `decision_settled` arrives (single source of truth; the winning respond will
  observe its own settle event).
- `onDecisionSettled` → drop the view + broadcast `decision/settled` with `by` from the host.

- [ ] **Step 1: Failing tests** (fakeHost): fake `park(entry)` → `decision/requested` on the wire
  with the host toolUseID as id; respond → fake receives the `answer` op with the structured
  outcome AND the local view is still parked until fake `settle(...)` fires (assert
  decision-list non-empty between); settle → `decision/settled {by:"fh-user"}` + view gone; lost
  race (fake replies `alreadyAnsweredBy:"other"`) → `-33002` with `data.by === "other"`; no-parked
  reply → the not-found error code the local path uses (assert equality with a local-thread
  unknown-id respond); wrong-kind → `-32602` carrying the fake's message.
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck.
- [ ] **Step 3: Sabotage-verify** the single-source rule: settle the view inside the respond
  success path — the "still parked until settle" test FAILS; restore. Report output.
- [ ] **Step 4: Commit** — `feat(as3): fleet decisions — forwarded views, exact receipt mapping, settle-driven removal`.

---

### Task 9: `thread/stop`, close-as-detach, socket death

**Files:**
- Modify: `src/appserver/fleet.ts`, `src/appserver/server.ts` (stop handler + close branch),
  `src/appserver/schema/fleet.ts` (+stop params), `src/appserver/schema/index.ts`, the close
  teardown site (`grep -n "closeRecord\|thread/close" src/appserver/server.ts`),
  `docs/parity/appserver.md` (stop row flips from planned(M3); thread/closed row notes `reason`)
- Test: `test/unit/appserver/fleet-lifecycle.test.ts`

**Interfaces:**
- Schema: `export const threadStopParams = z.object({ threadId: z.string().min(1) });`
- **`thread/stop`**: fleet → send `{op:"stop"}` (await receipt), then close the record;
  broadcast `thread/closed {threadId, reason:"stopped"}`. inProcess → exactly `thread/close`'s
  behavior (share the close path; reason `"stopped"`). `thread/closed` payload gains OPTIONAL
  `reason` (schema artifact updates here; count unchanged).
- **`thread/close` fleet branch = detach**: `dispose()` (unfollow + socket close — Task 6 already
  guarantees never-`stop`), and the teardown **skips** the local decision-settlement broadcast for
  fleet records: views drop silently, no `decision/resolved`-family notification (spec §1f — the
  decisions remain live host-side). Everything else (subscriber notify, record removal) shared.
- **Socket death sequence** (completes Task 7's stub, spec §1f order): on `onSocketDeath` —
  (1) settle any in-flight submit waiter → the spine broadcasts `turn/completed {status:"failed"}`
  with a connection-lost error (make the fleet engine reject the pending submit with that error;
  verify how `turns.ts` onFailure renders it); (2) clear busy; (3) drop decision views silently;
  (4) `isEnded` latched (already); (5) broadcast `warning {code:"fleetConnectionLost"}` +
  `thread/status/changed`. Record stays (a zombie answering `-33005`) until `thread/close`.

- [ ] **Step 1: Failing tests** (fakeHost): stop sends the op and broadcasts
  `thread/closed {reason:"stopped"}`; close on fleet sends `unfollow` but NEVER `stop` (ops
  assert) and emits NO decision-settlement notification while a view is parked (watch the wire);
  the same close on an inProcess record still settles its local parks (regression guard — assert
  the existing behavior); socket death mid-turn: fake `close()` during an open submit →
  `turn/completed {status:"failed"}` then `warning {code:"fleetConnectionLost"}` then
  `thread/status/changed`, busy false, views gone silently, subsequent `thread/status` answers
  `-33005`, `thread/close` still works.
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck + drift gate.
- [ ] **Step 3: Sabotage-verify** the silent-drop: route fleet detach through the normal
  settle-broadcast teardown — the no-notification test FAILS; restore. Report output.
- [ ] **Step 4: Commit** — `feat(as3): thread/stop + detach-close + specified socket-death sequence`.

---

### Task 10: Forwarded control + settings surface

**Files:**
- Modify: `src/appserver/settings.ts`, `src/appserver/settingsOps.ts`, `src/appserver/mcp.ts`,
  `src/appserver/tasks.ts`, `src/appserver/fleetEngine.ts` (flag-op senders), `docs/parity/appserver.md`
  (origin-scope column: the forwarded rows now truly read `both`)
- Test: `test/unit/appserver/fleet-bridge.test.ts`

**Interfaces:**
- The forwarded optional members (Task 6) light up the existing handlers for fleet threads with
  **zero handler changes** where the member signature already matches — verify per method by test,
  not by reading alone. Handler changes only where inProcess assumptions leak:
  - `settingsOps.ts`: fleet branch calls dedicated fleet senders — `sendOp({op:"add_dir", path})`
    etc. for the eight flag ops (`ops.ts:74-85` shapes verbatim) and `sendOp({op:"get_settings"})`
    for `thread/settings/read`; NO accumulator writes (`flagPerms` etc. untouched — assert).
    Dedup guards (`directoryAdd`'s membership test) are **skipped** for fleet (the host owns
    truth; a fleet re-add forwards and the host decides).
  - `settings.ts`: the three mirrored setters forward via the optional members (already present);
    mirror updates ride the `state` event (Task 7), NOT the setter reply — do not write the mirror
    in the fleet setter path (single source; §1a-c makes the event arrive). `thread/settings/apply`
    is already `-33006`-gated (Task 3).
  - `mcp.ts` trio + `tasks.ts` trio: expected zero-change (members match) — the test proves it.
  - `thread/compact/start` fleet: forwards the bare `compact` op; NO busy claim, NO turn events
    (spec §1d deviation, recorded in the scorecard row).
- Scorecard: flip the origin-scope/status annotations for every row this task makes real on fleet
  (the forwarded set) — one sweep, one commit.

- [ ] **Step 1: Failing tests** (fakeHost, wire-level): `thread/directory/add` on fleet sends
  `add_dir` with the path AND leaves `record.flagPerms` empty (spy) AND a repeat add still
  forwards (no dedup short-circuit); `thread/settings/read` maps `get_settings`' reply;
  `thread/model/set` (or the mirrored setter's method name — copy from `methodSchemas`) forwards
  `set_model` and does NOT write the mirror until the fake emits `state` (then
  `thread/settings/changed` fires once); `mcpServer/status/list`, `task/list`, `thread/usage/read`
  (exact names from `methodSchemas`) round-trip the fake's payloads; `thread/compact/start` on
  fleet forwards `compact`, thread never goes busy, no `turn/started` (wire watch), and the reply
  is the op receipt.
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck + drift gate.
- [ ] **Step 3: Commit** — `feat(as3): full fleet bridge — flag-op forwarding, event-driven mirror, compact deviation`.

---

### Task 11: Rewind/clear fleet branches + fleet `thread/read`

**Files:**
- Modify: `src/appserver/rewind.ts` (fleet branches in rewind trio + clear), the read module
  (`grep -rn '"thread/read"' src/appserver` — `subscribe.ts` per M2), `src/appserver/fleet.ts`
- Test: `test/unit/appserver/fleet-rewind-read.test.ts`

**Interfaces:**
- `thread/rewind/anchors` fleet → `sendOp({op:"rewind_anchors"})` maps the host reply (same
  anchors shape — `host.ts:442-500` builds both sides from the same rows code).
  `thread/rewind/dryRun` fleet → `sendOp({op:"rewind_dryrun", uuid})`. `thread/rewind` fleet →
  gates (busy via `threadBusyReason`, parked-decision check) still apply LOCALLY (same UX), then
  `sendOp({op:"rewind", uuid, prevUuid, scope})` — **no `swapInFlight`, no local swap, no
  `repushThreadState`**; the reply is the host's receipt; epoch bump + `thread/rewound` arrive via
  the `rewound` event (Task 7 wiring — assert not-doubled: exactly one broadcast per host event).
- `thread/clear` fleet → `sendOp({op:"clear"})`; same event-driven resync (`cleared:true` →
  sessionId clears until the next `state`).
- **Fleet `thread/read` is disk-only** (spec §1f): the pager reads `getSessionMessages(record.sessionId)`
  rows under the SAME epoch-qualified cursor scheme; no live-buffer merge (subscribe replay owns
  the live half). If the M2 pager already reads only persisted rows, the change is: fleet records
  source rows from the fleet session's transcript path — verify what the pager reads today and
  branch only what differs. No sessionId yet → empty page (the M1 rule).

- [ ] **Step 1: Failing tests** (fakeHost): rewind forwards `{op:"rewind"}` with all three fields
  and performs NO local dispose (fake session ops list has no unfollow; `record.session` object
  identity unchanged); after fake `emitRewound({sessionId:"s3"})` exactly ONE `thread/rewound`
  broadcast (count), epoch +1, pre-swap read cursor now `-32602`; clear forwards `{op:"clear"}`;
  busy fleet rewind still refuses `-33001` BEFORE any op is sent (ops list empty); fleet
  thread/read pages seeded disk rows (attach-seeded transcript from Task 7); after the fake emits
  a mid-turn live message, a fresh page's content is STILL exactly the disk fixture (live rows
  travel only via subscribe — assert page equality, not just non-inclusion).
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck + drift gate.
- [ ] **Step 3: Sabotage-verify** no-local-swap: make the fleet rewind branch call the inProcess
  swap path — the object-identity test FAILS; restore. Report output.
- [ ] **Step 4: Commit** — `feat(as3): fleet rewind/clear forward host ops; event-driven resync; disk-only fleet reads`.

---

### Task 12: `fs/read` + `fs/search` (`workspace.ts`)

**Files:**
- Create: `src/appserver/workspace.ts`, `src/appserver/schema/workspace.ts`
- Modify: `src/appserver/server.ts` (handler table — server-scoped methods, no thread lookup),
  `src/appserver/schema/index.ts`, `docs/parity/appserver.md` (two rows)
- Test: `test/unit/appserver/workspace.test.ts`

**Interfaces:**
- Schemas:
```typescript
import { z } from "zod/v4";
export const fsReadParams = z.object({ path: z.string().min(1) });
export const fsSearchParams = z.object({
  query: z.string(),
  roots: z.array(z.string().min(1)).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
```
- **`fs/read {path}`** → `{dataBase64, size}` (spec §2 exact): `path.isAbsolute` else `-32602`;
  `fs.stat` — missing/unreadable → `-32602` with the fs error message; `size > 4 * 1024 * 1024` →
  `-32602` `"file exceeds the 4 MiB read cap (<size> bytes)"`; else `readFile` → base64.
  Un-chained, server-scoped, trusted-client (no sandbox — Codex parity, spec §2).
- **`fs/search {query, roots?, limit?}`** → `{matches: [{root, path, score}]}`: empty/whitespace
  query → `{matches: []}` immediately; roots default `[serverCwd]`; per root,
  `collectEntries(root, fs.promises.readdir-adapter, {root})` (`src/tui/fileComplete.ts:57-75` —
  match its adapter signature exactly) → `rankCandidates(files, query, limit ?? 50)` → map with
  the root; merge roots, re-sort by score desc then path asc, cap at limit. ANY fs error per root
  degrades that root to zero matches (never an RPC error — Codex parity); overall result stays ok.
- Both methods register in `methodSchemas`; scorecard rows cite probe 104 (why not `Query.readFile`).

- [ ] **Step 1: Failing tests** (tmpdir fixtures): read round-trips bytes (binary fixture —
  `Buffer.compare` after base64 decode); relative path → `-32602`; missing → `-32602`; a 5 MiB
  fixture → `-32602` naming the cap; search finds a nested file by fuzzy query with root-relative
  path; empty query → `[]`; unreadable root (chmod 000 dir — restore in finally; skip on win32)
  degrades to `[]`; limit caps; two roots merge sorted.
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck + drift gate.
- [ ] **Step 3: Commit** — `feat(as3): fs/read + fs/search — server-scoped workspace pair`.

---

### Task 13: `thread/shellCommand`

**Files:**
- Modify: `src/appserver/workspace.ts` (the handler lives with the workspace cluster),
  `src/appserver/schema/workspace.ts`, `src/appserver/schema/index.ts`, `docs/parity/appserver.md`
- Test: `test/unit/appserver/shell-command.test.ts`

**Interfaces:**
- Schema: `export const shellCommandParams = z.object({ threadId: z.string().min(1), command: z.string().min(1) });`
- Handler (spec §3 exact): resolve the record (`-33004` unknown); cwd = fleet → record's roster
  cwd; inProcess → `record.config.cwd` string if set, else `process.cwd()`. Then
  `runBash(command, cwd)` (`src/tui/bash.ts:18-30` — `{code, output, timedOut?}`, 30 s, 4 MiB,
  never rejects) → reply the result verbatim. **Un-chained** (busy allowed — the TUI's mid-turn
  `!` exemption), works on BOTH origins (not origin-gated). A dead-engine record follows the
  standard `-33005` gate — the thread should read consistently dead (spec §3, clarified during
  planning; noted in the scorecard row).
- Schema description carries the spec's deviation note verbatim:
  `"unsandboxed; output returns to the calling client only — the model never sees it (deviation from Codex's stream-into-turn)"`.

- [ ] **Step 1: Failing tests** — echo round-trip (`{code:0}`, output contains the marker); nonzero
  exit code surfaces; cwd resolution: a fleet-origin fake record with roster cwd A and an
  inProcess record with config cwd B each see their own `pwd` output; busy thread still executes
  (no `-33001`); unknown thread `-33004`.
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck + drift gate.
- [ ] **Step 3: Commit** — `feat(as3): thread/shellCommand — display-only RPC exec in the thread cwd`.

---

### Task 14: `thread/reopen`

**Files:**
- Modify: `src/appserver/rewind.ts` (reopen shares the swap machinery), `src/appserver/schema/rewind.ts`,
  `src/appserver/server.ts` (handler table + `ENGINE_GONE_EXEMPT`), `src/appserver/schema/index.ts`,
  `docs/parity/appserver.md` (row + gap-10 closure note)
- Test: `test/unit/appserver/reopen.test.ts`

**Interfaces:**
- Schema: `export const reopenParams = z.object({ threadId: z.string().min(1) });`
- Handler (spec §4 exact, ordered): (1) fleet → `-33006` (Task 3's set already contains it —
  verify, don't re-add). (2) **`ENGINE_GONE_EXEMPT` membership** — add `"thread/reopen"` to the
  exemption set at the dispatch `-33005` gate (`server.ts:517,538` region) or the method is
  unreachable exactly when legal. (3) chain-scoped; `threadBusyReason` non-null → `-33001`.
  (4) engine ALIVE (`!session.isEnded?.()`) → `-32602` `"engine is not dead; nothing to reopen"`.
  (5) swap: reuse `swapEngine` with a tolerate-dead-dispose guard (wrap the dispose await —
  an already-ended engine's dispose failure/hang must not wedge; if `swapEngine`'s current shape
  disposes unconditionally, add the guard THERE, flagged, since rewind/clear also benefit).
  Factory: `record.sessionId` present → `deps.sessionFactory`-equivalent resume
  (`openSession({...record.config, resume: sessionId})` — the `thread/resume` primitive); absent →
  fresh `openSession(record.config)` (spec: fresh-reopen documented). (6) post-swap
  `repushThreadState`; broadcast `thread/rewound {threadId, sessionId}` (the new/retained id);
  reply `{ok:true, sessionId}`.
- Factory throws AGAIN → the gap-10 wedge reproduces but now REPEATABLY recoverable: `finally`
  clears `swapInFlight`, record still answers `-33005`, and a second `thread/reopen` may retry —
  test this.

- [ ] **Step 1: Failing tests** — dead-engine record (fake with `isEnded:()=>true`): reopen swaps
  (factory called with resume of retained sessionId), `thread/rewound` broadcast, epoch bumped,
  repush ran (spy), reply carries sessionId; alive engine → `-32602` and factory NOT called; busy →
  `-33001`; fleet → `-33006`; no-sessionId record → factory called WITHOUT resume key; dispatch
  reachability: a dead-engine record answers `-33005` for `thread/status` but reopen gets THROUGH
  (the exemption test — drive via wire dispatch); factory-throw-on-reopen → error reply, `swapInFlight`
  false after, second reopen with a working factory succeeds.
- [ ] **Step 2:** FAIL → implement → PASS + suite + typecheck + drift gate.
- [ ] **Step 3: Sabotage-verify** the exemption: remove `"thread/reopen"` from `ENGINE_GONE_EXEMPT`
  — the reachability test FAILS with `-33005`; restore. Report output.
- [ ] **Step 4: Commit** — `feat(as3): thread/reopen — gap-10 recovery via tolerant swap, ENGINE_GONE_EXEMPT`.

---

### Task 15: Schema artifacts + barrel + scorecard totals sweep

**Files:**
- Modify: `src/appserver/index.ts` (barrel: new public types — `FleetEngineSession`? NO — export
  only what M2 exposed plus `methodSchemas` growth; check the barrel's doc for its surface rule),
  `schema/json/stable/appserver.json` + `schema/json/experimental/appserver.json` (regenerate),
  `docs/parity/appserver.md` (totals block: 58 methods / 26 notifications; per-row sweep for
  anything Tasks 7–14 missed)
- Test: the existing schema round-trip/ajv gate (`grep -rl "emit-schema\|appserver.json" test/`)

- [ ] **Step 1:** Regenerate artifacts via the M2b path (`node dist/... --emit-schema` or the
  script `grep '"schema' package.json` names); ajv gate green; seven new methods all present in
  STABLE; `thread/closed` schema carries optional `reason`.
- [ ] **Step 2:** Scorecard totals + origin-scope recount (spec: gap 2 closes — note `host/ops.ts`
  now imported under `appserver/` via the fleet senders; gap 4 closes; gap 10 closes); drift gate
  green; suite + typecheck green.
- [ ] **Step 3: Commit** — `feat(as3): schema artifacts 58 methods, scorecard totals, gaps 2/4/10 closed`.

---

### Task 16: Console panels (fleet + workspace)

**Files:**
- Modify: `tools/appserver-console.html`
- Test: none (browser smoke in Task 17)

- [ ] **Step 1:** Panel 6 — fleet: a `fleet/list` refresh button + row table (short/name/state/
  pid/threadId), per-row Attach (→ `thread/attach {target: short}`) and Stop buttons; attached
  rows link to the existing thread panel selection. Panel 7 — workspace: fs/search input +
  results list (click → `fs/read` → hex/text preview with the base64 decoded, size-capped
  display), and a shell strip (thread-scoped: command input → `thread/shellCommand` → output
  `<pre>`). Follow the existing panels' vanilla-JS structure and the `-33008`/`-33006` error
  rendering the console already uses for other codes.
- [ ] **Step 2:** Typecheck/suite untouched (HTML only) — visual check deferred to Task 17's
  smoke.
- [ ] **Step 3: Commit** — `feat(as3): console panels 6–7 — fleet adoption + workspace`.

---

### Task 17: M3 final verification — the spec's acceptance, verbatim

**Files:**
- Create: `test/live/appserver-m3-acceptance.test.ts`
- Modify: spec (`## Outcomes` stays pending — the CONTROLLER writes close-out), `docs/parity/coverage.md`

**Controller-run, keyed.** The spec's acceptance scenario as sequential `it`s over ONE server
(M2 acceptance file is the template — same env gating, same sequential-state pattern):

- [ ] **Step 1:** Write the scenario (spec §Testing verbatim): spawn a real detached ccx session
  (the CLI spawn seam, scratch cwd) → `fleet/list` shows it → `thread/attach` → drive a turn
  through the app server (assert `turn/started`/`turn/completed` + result content) → park a
  permission; answer from a SECOND WS client; assert `decision/settled` with attribution → start
  + interrupt a turn → **foreign-swap leg:** a raw host-socket client issues `clear` (or `resume`)
  directly; assert `thread/rewound` + epoch-invalidated cursor on the app-server wire → fleet
  `thread/read` pages the transcript → `fs/search` finds a repo file; `fs/read` round-trips it →
  `thread/shellCommand` echoes in the session's cwd → `thread/close` (detach) → re-`thread/attach`
  (host survived) → `thread/stop` → `fleet/list` shows terminal. Separate `it`: inProcess reopen
  leg — start a thread with a factory you can kill (or drive the real engine and dispose via test
  seam — the M2 acceptance's engine-handle pattern), `thread/reopen`, assert `thread/rewound` +
  a follow-up turn works.
- [ ] **Step 2:** Controller runs keyed: `set -a; . ../.env; set +a; npx vitest run test/live/appserver-m3-acceptance.test.ts`.
  ALL green, or each failure investigated to root cause (engine-refusals become recorded findings
  like M2's bypass finding — fix the test only when the premise was wrong, fix the code when ours
  was).
- [ ] **Step 3:** Browser console smoke (playwright-cli or the chrome tools): serve
  `tools/appserver-console.html` over `python3 -m http.server 8901` + `ccx serve --allow-origin
  http://127.0.0.1:8901`; drive panels 6–7 live (attach a spawned session, run a shell command,
  search+read a file); **zero JS errors** in the console log.
- [ ] **Step 4:** Full suite + typecheck + `npm run build` + pack gate (`grep '"verify:pack' package.json`)
  + drift gate — all green. `docs/parity/coverage.md` app-server domain % refreshed.
- [ ] **Step 5: Commit** — `test(as3): M3 acceptance — fleet live scenario, reopen leg, console smoke, coverage refresh`.

---

## Execution notes for the controller

- **Task order is the dependency order** — 5 before 6 before 7; 8 before 9 (death drops decision
  views); 3 before any fleet task (origin gate); 2 before 5 (the fakeHost stubs the REVISED wire).
  Task 4 (probe) can run any time after 2, before 5's receipt shapes are locked — its verdicts
  feed the fakeHost's `answer` fidelity and Task 8's mapping.
- Per-task: opus implementer (one at a time, never parallel writers), independent opus reviewer
  with repro authority, fix wave, re-review to CLEAN. Reviewer checks the fleet invariants
  (Global Constraints) explicitly each task.
- Controller runs all keyed steps (Task 4, Task 17) and the browser smoke.
- The spec's living tail is append-only during execution: verdicts → Surprises; adjudications →
  Decision Log; scope changes → Revision Notes (and the parent M2 spec is NOT touched by M3).
- Close-out (after Task 17): external codex review over the whole branch, fix wave for verified
  findings, memory + scorecard final sweep — per the standing workflow, outside this plan.
