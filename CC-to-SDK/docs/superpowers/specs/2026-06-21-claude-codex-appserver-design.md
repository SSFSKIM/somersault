# Claude-backed Codex App-Server (`cc-codex-appserver`) — Design Spec

**Date:** 2026-06-21
**Status:** design (awaiting user review → implementation plan)
**Feature:** a drop-in replacement for `codex app-server` that speaks the Codex v2 JSON-RPC
protocol over stdio but is backed by the **Claude Agent SDK** via the `cc-harness` `Session`
engine. The consumer is the **Director** (`~/Documents/GitHub/agent-harness`), which spawns one
app-server subprocess per worker turn.

---

## 1. Goal & context

Replace the `codex app-server` subprocess the Director spawns with a Claude-backed server, so the
Director's workers run on Claude instead of Codex **without changing the Director's transport, its
handshake, or its turn loop**. "Drop-in wire-compatible" is scoped precisely: **byte-for-byte exact
for the methods the Director actually exercises, clean no-ops/errors for everything else.**

The contract is known authoritatively from the consumer's own source — `director/worker/app_server.py`
(the client), `director/worker/_mock_app_server.py` (a 157-line working reference server its tests
pass against), and `tests/test_director_app_server.py` (asserts the exact shapes). A live trace is an
optional final cross-check, **not** a prerequisite.

### Governing discipline (A1 / live-probe-first)
The SDK→Codex field mapping in §6 is grounded by a **probe run first** (`CC-to-SDK/probes/`) that dumps
the real SDK turn-message shapes (`assistant` text blocks, `result.result`, `result.usage`,
error subtypes). Declared ≠ reachable; the translator is written against probe evidence, not assumption.

---

## 2. The consumer contract (authoritative — from source)

**Protocol:** Codex **v2** JSON-RPC "lite" (the `"jsonrpc"` field is omitted on the wire).
**Framing:** newline-delimited JSON (one JSON object per line).
**Transport:** stdio. The Director spawns the server with
`subprocess.Popen(cmd, stdin=PIPE, stdout=PIPE, stderr=DEVNULL, bufsize=0)` (app_server.py:214).
**stderr is discarded by the client → the server may log freely to stderr.**

**Launch command:** `codex_command` defaults to `"codex app-server"`, overridable via `--codex` /
`.harness.json`. Real runs append `-c key=value` overrides (e.g.
`-c approvals_reviewer=auto_review -c sandbox_workspace_write.network_access=true`, autonomy.py:48-49).
**The server must tolerate (and may inspect, but otherwise ignore) the `app-server` subcommand arg and
trailing `-c key=value` args.**

**Three wire shapes** (app_server.py:7-15):
- response to a client request — has `id` + `result`/`error`, **no** `method`.
- notification — has `method`, **no** `id`.
- server-initiated request — has `method` **and** `id` → the client replies `{id, result}`.

### 2.1 Client→server requests the server MUST handle
| method | params (client sends) | result the server MUST return |
|---|---|---|
| `initialize` (req) | `{clientInfo:{name,title,version}, capabilities:{experimentalApi:true}}` | `{userAgent, platformOs, capabilities:{outcomeOnTurnCompleted:true}}` (body otherwise free; client captures `capabilities` — see §7) |
| `initialized` (notif) | `{}` | — (no reply) |
| `thread/start` (req) | `{cwd, approvalPolicy, sandbox, model?, dynamicTools?}` | **`{thread:{id}}`** (client reads `result["thread"]["id"]`, app_server.py:357) |
| `turn/start` (req) | `{threadId, input:[{type:"text",text}], cwd, approvalPolicy, sandboxPolicy?}` | **`{turn:{id, status:"inProgress"}}`** (client reads `result["turn"]["id"]`, :421) |

`dynamicTools` = `[{name, description, inputSchema}]` — advertised by the client, **executed
server-side** (§6); the server never round-trips them.

### 2.2 Server→client requests the server MAY emit (client replies `{id, result}`)
Only **approvals** remain after dropping `item/tool/call` (§6). Emitted only in the non-`auto`
posture (§5):
- `item/commandExecution/requestApproval` → params `{command, cwd, itemId, threadId, turnId, availableDecisions:["accept","acceptForSession","decline"], reason?}`; client replies `{id, result:{decision}}`.
- `item/fileChange/requestApproval` → params `{changes, reason?, itemId, threadId, turnId}`; client replies `{id, result:{decision}}`.
- (`tool/requestUserInput`, `mcpServer/elicitation/request` are part of the client's seam but are not
  emitted by this server; left unimplemented.)

`decision ∈ accept | acceptForSession | decline` (approval.py:54-57). `changes` is **opaque to the
Director** (queued raw, approval.py:42-43) — the server produces a Codex-shaped `changes` payload from
the SDK Edit/Write tool input.

### 2.3 Notifications the server emits that the client ACTS ON
- `item/completed` with `item.type=="agentMessage"`, full `item.text`, `item.phase ∈ {commentary, final_answer}`.
  **A final `item/completed` agentMessage with `phase:"final_answer"` + full text is MANDATORY** — it is
  the Director's primary signal (`final_message`, app_server.py:404-411). Fallback: last non-empty
  agentMessage of any phase; else `None`.
- `turn/completed` | `turn/failed` | `turn/cancelled` → `params.turn.{id,status}`; **ends the turn loop.**
  The client derives status from the **method name** (:414); the inner `turn.status` field is cosmetic (F7).
  **`turn/completed` additionally carries `params.outcome`** when report_outcome fired (§6).
- `thread/tokenUsage/updated` → `params.tokenUsage = {total:{totalTokens, inputTokens, outputTokens}, …}`;
  client reads `.total` (absolute, cumulative). Tolerant/telemetry-only; never gates a turn.
- rate-limit payload under any of `rate_limits|rateLimits|rate_limit|rateLimit` on any notification
  (stored raw; optional to emit).

Other notifications the mock emits for fidelity (`thread/started`, `turn/started`,
`serverRequest/resolved`) are passed to the client's `on_event` but are **not** load-bearing.

### 2.4 Lifecycle / cancellation
There is **no `turn/interrupt` RPC.** Cancellation is the Director closing the pipes + terminating the
subprocess (app_server.py:220-238). The server only needs to **dispose cleanly on stdin-EOF / SIGTERM.**

---

## 3. Architecture

A new **peer package** `CC-to-SDK/app-server/` (npm `cc-harness-appserver`, bin **`cc-codex-appserver`**),
depending on `cc-harness` via `file:../harness` — structurally a sibling of `tui/`: a second front-end
over the one engine (Codex JSON-RPC instead of Ink).

```
harness/        engine (protocol-agnostic; cc-harness)
   ▲      ▲
   │      │
 tui/   app-server/     ← siblings; neither imports the other; both depend down on harness/
```

**Invariant (review-enforced):** data flows **engine → translator → peer**. Nothing in `app-server/`
is imported by `harness/`, and `translator` never reaches into the peer's transport (it returns wire
objects; the peer writes them).

### 3.1 Module decomposition (`app-server/src/`, one job each)
- **`bin.ts`** — entrypoint. Parse-and-ignore argv (`app-server`, trailing `-c k=v`; best-effort read
  `approvals_reviewer` / `sandbox_workspace_write.network_access` for posture). Wire stdin/stdout to the
  peer; dispose the Session + exit on stdin-EOF / SIGTERM. stderr = logging.
- **`peer.ts`** — bidirectional JSON-RPC stdio peer: one continuous read loop, line framing, dispatch by
  shape (request→handler; response→resolve a pending outgoing request). Outgoing-request id counter +
  `Map<id, resolver>` for approvals. Serialized writes (one JSON line at a time).
- **`handlers.ts`** — `initialize`, `initialized`, `thread/start`, `turn/start`.
- **`registry.ts`** — `threadId → { session, turnSeq, usageTotal, outcomeHolder }`; mints `thr_<n>` / `turn_<n>`.
- **`translator.ts`** — SDK message stream → Codex notification objects (§6). Pure: `(sdkMessage, ctx) → wireObjects[]`.
- **`approvals.ts`** — a `PermissionBroker` (harness public type) that emits approval requests and awaits the decision (§5).
- **`tools.ts`** — build the report_outcome in-process MCP tool + the Linear MCP (§6).
- **`posture.ts`** — `approvalPolicy` + `sandbox` + `-c` flags → `permissionMode` + broker on/off (§5).
- **`protocol.ts`** — wire envelope + param/result types.

### 3.2 Engine seam (no new public exports needed)
The peer drives the **public** `openSession(config)`. Verified against `cc-harness`:
`HarnessConfig` already carries `mcpServers` (types.ts:69), `permissionBroker` (wired as SDK
`canUseTool` by `resolveOptions`, types.ts:34 / resolveOptions.ts:56), `permissionMode`,
`allowedTools`/`disallowedTools`, `cwd`, `model`. `Session.submit(prompt, onMessage)` streams every
non-result SDK message to `onMessage` and resolves with `{result}` (the final text) — exactly the
translator's input.

---

## 4. Domain mapping
- **thread** = one `Session` created at `thread/start`:
  `openSession({ cwd, model, mcpServers, permissionMode, permissionBroker?, allowedTools })`. The server
  responds `{thread:{id:"thr_<n>"}}` then emits `thread/started`.
- **turn** = one `session.submit(text)`. `turn/start` → mint `turn_<n>` → respond
  `{turn:{id, status:"inProgress"}}` **immediately** → emit `turn/started` → stream (§6) → terminal.
- **multi-turn:** the same `Session` (and thread registry entry) services multiple `turn/start`s; usage
  accumulates across them (§6, F8).

---

## 5. Approvals & posture
`posture.ts` maps the Director's signals → SDK permission behavior:

| Director posture | SDK mapping | Approval round-trip? |
|---|---|---|
| `approvals_reviewer=auto_review` present (the **default**), or `approvalPolicy:"never"` | **`permissionMode:"auto"`** (SDK AI classifier self-governs — the direct analog of Codex auto_review) | **No** — broker not consulted in `auto` |
| `approvalPolicy:"on-request"/"untrusted"` **without** auto_review | `permissionMode:"default"` + `approvals.ts` broker | **Yes** |

`auto` is model-gated (Opus 4.6+/Sonnet 4.6); `resolveOptions` forces an auto-capable model when
`permissionMode==="auto"` is explicit (default opus-4-8 already qualifies).

**Broker round-trip (fallback posture):** on `broker.request(req)` → by `req.toolName`:
`Bash` → `item/commandExecution/requestApproval` `{command, cwd, itemId, threadId, turnId, availableDecisions:["accept","acceptForSession","decline"]}`;
`Edit`/`Write`/`MultiEdit` → `item/fileChange/requestApproval` `{changes, reason?, itemId, threadId, turnId}`
(`changes` shaped from the SDK tool input). Await the `{decision}` reply; map
`accept`→`allow_once`, `acceptForSession`→`allow_always`, `decline`/anything-else→`deny`.
**No deadlock:** the broker awaits on the event loop while the single peer read-loop keeps consuming
stdin and resolves the pending request by `id`.

> The `auto` path is primary (the Director's real posture); the broker path is fidelity for the
> `auto_review=false` fallback and is sequenced after the happy path in the plan.

---

## 6. Turn translation + dynamicTools (the heart)

### 6.1 SDK stream → Codex notifications
Probe-pinned (§1). Baseline mapping driven by `Session.submit(text, onMessage)`:

| SDK message | Codex emit |
|---|---|
| `system/init` | capture session_id (no wire emit) |
| `assistant` text block (intermediate) | `item/completed` `{item:{type:"agentMessage", text, phase:"commentary"}, itemId, threadId, turnId}` |
| `assistant` `tool_use` (native Bash/Edit/Read) | optional `item/started`/`item/completed` (observability; Director ignores) |
| **`result`** (submit resolves, success) | **`item/completed` `{item:{type:"agentMessage", text:<result>, phase:"final_answer"}}`** → `thread/tokenUsage/updated` → **`turn/completed` `{turn:{id,status:"completed"}, outcome?}`** |
| `result` with `is_error` / `error_*` subtype | `turn/failed` `{turn:{id,status:"failed"}}` |

The mandatory `final_answer` comes from `mm.result`. To avoid a duplicate, the intermediate-commentary
emit suppresses the last assistant text if it equals the result.

### 6.2 Usage (F8 — cross-turn cumulative)
`registry.usageTotal` accumulates **across all turns in the thread**. Each `thread/tokenUsage/updated`
emits the cumulative `{tokenUsage:{total:{totalTokens, inputTokens, outputTokens}}}`. The probe decides
whether `result.usage` is per-turn (sum) or already-cumulative (take latest); the registry adapts so
multi-turn tickets never under-count.

### 6.3 dynamicTools, executed server-side (no `item/tool/call`)
The server reads `thread/start.dynamicTools` (to know what was advertised) but owns execution:
- **`linear_graphql` → Linear MCP**, injected via `config.mcpServers`. **Recommended:** an in-process
  SDK MCP server (`createSdkMcpServer`) authed by **`LINEAR_API_KEY`**, porting the Director's
  `authority` guardrail to TS (reads pass; only allowlisted forward-only mutations go out; destructive
  refused pre-POST). **Alternative:** the official remote Linear MCP (OAuth — harder under the
  deny-by-default worker env). The Director keeps advertising `linear_graphql`; the agent uses the MCP
  instead, so the client's `tool_executor` never fires.
- **`report_outcome` → in-process MCP tool**, schema mirrored from the advertised spec (status enum
  `done|blocked|needs_human`, `reason`, `spawned_ticket_ids[]`, `pr_url`, `pr_branch`,
  `evidence{checks_state, unresolved_threads, acceptance_verified}` — tools.py:42-77). The handler
  records the args into the turn's `outcomeHolder` and returns success ("outcome recorded"). At `result`,
  the recorded payload rides **`turn/completed.params.outcome`** (sibling of `turn`).

**Presence rule:** `outcome` present on `turn/completed` → terminal turn; absent → continuation
(Director reads `final_message`, D-45). Maps 1:1 onto the Director's `sink.get("outcome") present →
terminal` check (run.py:370).

---

## 7. Capability auto-negotiation (F4 — termination safety)
`turn/completed.outcome` is an **additive extension** to Codex's `turn/completed` (stock Codex has no
`outcome` field). A manual `outcome_channel` flag is termination-critical: pointing the Director at the
new channel while the server doesn't emit `outcome` makes every terminal turn look like a continuation →
loops to `max_turns`. So the server **advertises the capability in the `initialize` result**:

```
{ userAgent, platformOs, capabilities: { outcomeOnTurnCompleted: true } }
```

The Director (which currently discards the init result, app_server.py:341) captures `capabilities` and
**auto-selects** the channel. The manual `director.worker.outcome_channel:"tool"|"turn_completed"`
(default `"tool"`) remains as explicit override. Stock clients ignore unknown result fields → wire-safe.

---

## 8. Env / auth (integration requirement)
The server (Node) + the SDK-spawned `claude` CLI inherit the Director's **deny-by-default worker env**
(policy.py, T11). `resolveOptions` spreads `process.env` into the SDK subprocess env, so the server's
own env must carry: `PATH`, `HOME`, the **Claude auth** (`CLAUDE_CODE_OAUTH_TOKEN` *or*
`ANTHROPIC_API_KEY`; OAuth preferred — bills Pro/Max), and `LINEAR_API_KEY`. Extending the worker env
allowlist is part of the companion change (§10).

---

## 9. Out of scope (stubbed; logged to stderr)
`thread/resume`, `thread/fork`, `model/list`, `config/*`, `turn/interrupt`, MCP elicitation, realtime,
account, review, skills → JSON-RPC method-not-found or benign `{result:null}`. The Director never calls
these.

---

## 10. Companion change — Director (`agent-harness`, separate repo, flagged)
Pinned here so it is a mechanical match against a frozen contract. Owned by the user. **3 edits + 1
capability capture**, all under the new channel (orchestrator.py / merger.py untouched — the `outcome`
dict is the seam):
1. `initialize`: capture the result's `capabilities` (app_server.py:341) → auto-select the channel.
2. `run_turn`: on `turn/completed`, capture `mparams.get("outcome")` into the returned dict (app_server.py:412-416).
3. `drive`: feed the decider from `result.get("outcome")` not `sink.get("outcome")` (run.py:370).
4. drop the `make_report_outcome_executor` sink wiring (run.py:282,293).
Plus: point `--codex` at `node …/app-server/dist/bin.js`; extend the worker env allowlist (§8).
Flag: `director.worker.outcome_channel:"tool"|"turn_completed"` (default `"tool"`; capability
auto-negotiation overrides).

---

## 11. Testing strategy (live-probe-first)
1. **Probe** (`CC-to-SDK/probes/`): dump real SDK turn-message shapes → grounds §6 (assistant text,
   `result.result`, `result.usage` per-turn-vs-cumulative, error subtypes).
2. **Unit** (DI fake `QueryFn`): synthetic SDK streams → assert exact wire output — mandatory
   `final_answer`, `turn/completed.outcome`, cumulative usage, approval round-trip, error → `turn/failed`.
3. **Cross-repo contract test (decisive):** spawn the built `bin` and drive it with the Director's own
   wire sequence (a TS port of the 4 client methods, or pytest invoking our binary) → assert `thread_id`,
   `status:"completed"`, `final_message`, `outcome`, capability negotiation. Proves drop-in fit against
   the *real* consumer.
4. **Gated live test** (OAuth-keyed): one real turn end-to-end through the SDK.
5. Optional: replay a captured `appserver-trace.jsonl` as a golden regression.

---

## 12. Decisions taken (flagged, reversible)
- **Linear MCP flavor:** in-process SDK MCP + `LINEAR_API_KEY` + ported `authority` guardrail (vs remote
  OAuth MCP). [§6.3] — *awaiting explicit confirmation; default taken.*
- **Posture mapping:** `auto_review`→`permissionMode:"auto"` (vs bypassPermissions). [§5]
- **Outcome carrier:** `turn/completed.params.outcome` + `initialize` capability negotiation. [§6/§7]
- **Package shape:** peer package `app-server/` (vs in-harness module / daemon extension). [§3]

## 13. Open questions
- Confirm §6.3 Linear MCP flavor (in-process vs remote).
- Probe result: is SDK `result.usage` per-turn or cumulative? (decides §6.2 sum-vs-latest).
- Any Director-advertised dynamicTools beyond `linear_graphql` + `report_outcome`? (the server handles
  unknown advertised tools as inert — they simply aren't surfaced to the agent).
