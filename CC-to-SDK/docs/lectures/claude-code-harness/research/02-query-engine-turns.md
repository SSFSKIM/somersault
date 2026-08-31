# Claude Code 2.1.251 — the agentic loop: query engine and turn pipeline

> Research note for the internals lecture. Source of truth: `/Users/new/claude-code-bundle/2.1.251/cli.pretty.js`
> (881,404 lines, the whole app beautified). Every `cli.pretty.js:NNNN` citation below points at code that was
> actually read. Symbols are minified **per chunk**; the query engine lives almost entirely in one enormous chunk,
> `chunk-fy12d89p.js`, spanning **cli.pretty.js:411873–520034**, so minified names are stable *within* that range
> and meaningless outside it. Claims not backed by a read line are marked **INFERRED**.

## Executive summary

1. The engine is a single async generator, `Kx` at **486327**, wrapping the real loop `DAt` at **486427** (~1120 lines).
   `DAt` is a `while(!0)` over **turns**; each iteration is one `messages → API → tool_use → tool_result → messages` cycle.
2. Loop state is one object `Pe` (`{messages, toolUseContext, compactTracking, turnCount, maxOutputTokensRecoveryCount, transition, …}`).
   Every continuation rewrites `Pe` and labels itself with `transition.reason` — an 8-value enum that is the engine's real state machine.
3. Inside each turn there is a *second*, inner `while(Ol)` loop (**486706**) that re-dispatches the same turn against a
   different model: refusal fallback, consent fallback, availability chain advance. It never advances `turnCount`.
4. Tools do **not** wait for the assistant message to finish. `zEt` (**484532**) races the SSE stream against
   `streamingToolExecutor.waitForDrainable()`, emitting `tool_drain_tick`; `ORe` (**484328**) starts a tool the instant
   its `content_block_stop` lands. Concurrency is governed only by `isConcurrencySafe`, with **no cap** on that path.
5. Streaming yields **one complete assistant message per content block** (`content_block_stop` → `yield`, **499122**),
   then retro-patches usage/`stop_reason` onto all of them at `message_delta` (**499166**).
6. There are 19 terminal reasons (`Zw`, **306736**) and 8 continuation reasons. `{reason:"completed"}` is only one of them.
7. Interruption emits exactly two synthetic strings, `[Request interrupted by user]` and
   `[Request interrupted by user for tool use]` (**413362**), plus per-tool synthetic `tool_result`s.
8. Retry is entirely harness-owned (`maxRetries: 0` on every SDK client, **498036**); `kQ` at **445990** does 10 attempts
   (300 under `CLAUDE_CODE_RETRY_WATCHDOG`) with 500 ms × 2ⁿ backoff capped at 32 s, +25 % additive jitter, `Retry-After` as a floor.
9. `ultrathink` no longer maps to a thinking-token budget. It is a *system-reminder attachment* (**518738**); thinking budget
   comes from `effort` (`low|medium|high|xhigh|max`) or adaptive thinking.
10. The same generator serves interactive REPL, `-p`, `--output-format stream-json` and the SDK transport; the mode-specific
    part is only the translator that maps internal event types onto wire messages (**355860–356180**).

---

## 1. The main conversation loop

### 1.1 Entry points

| Function | Line | Role |
|---|---|---|
| `Kx(e)` | **486327** | public entry; wraps the loop, emits `command_lifecycle` for absorbed queue commands, fires `tengu_turn_end` |
| `Djn` | **486464** | "queryWithObserverTap" — drives `DAt` manually so an observer can `capture()` every event and `flushSegment()` on `stream_request_start` |
| `DAt` | **486427** | the actual turn loop |
| `tT` | **488095** | forked/background agent driver (`maxTurns` default `w4n = 50`, **487954**) |
| Task/subagent runner | **465014** | `Kx(...)` with `querySource: "agent:…"` |
| SDK / headless driver | **355907** | `Kx(...)` with `querySource: "sdk"`; class `hu.submitMessage` |
| hook agent | **493720** | `querySource: "hook_agent"` |

`Kx` itself is thin (**486327–486463**):

```js
async function* Kx(e) {
  let t = [], r = performance.now(), o = [], u;
  try { u = yield* yW() ? Djn(e, t, o) : DAt(e, t, o); }
  finally { /* subagent_exit precompute */ }
  yield* ZCt(...);                                   // goal-tracking events
  let d = rbt(u.reason) ? "cancelled" : "completed";
  for (let _ of t) yield { type: "command_lifecycle", uuid: _, state: d };
  for (let _ of o) yield { type: "command_lifecycle", uuid: _, state: "completed" };
  ...
  return cAt({ terminal: u, ... }), u;               // tengu_turn_end
}
```

`t` collects uuids of **queued user commands absorbed mid-turn**; `o` collects **poll-event** uuids. Both get a
lifecycle event at the very end — so a message you typed while Claude was working is reported `started` when absorbed
and `completed`/`cancelled` when the whole turn resolves.

### 1.2 Turn-loop state

`Pe` is initialised at **486438**:

```js
Pe = { messages: e.messages, toolUseContext, maxOutputTokensOverride, compactTracking: void 0,
       stopHookActive: false, stopHookBlockingCount: 0, maxOutputTokensRecoveryCount: 0,
       hasAttemptedReactiveCompact: false, thinkingOnlyNudged: false, turnCount: 1,
       pendingToolUseSummary: void 0, transition: void 0 }
```

`transition.reason` — the continuation vocabulary (all read in region 486427–487550):

| `transition.reason` | Set at | Why the loop repeats |
|---|---|---|
| `next_turn` | 487547 | normal: tool results were produced, feed them back |
| `malformed_tool_use_retry` | 487307 | `stop_reason === "tool_use"` but zero `tool_use` blocks parsed |
| `max_output_tokens_recovery` | 487286 | assistant hit `max_output_tokens`; nudge and continue |
| `truncated_response_recovery` | 487294 | stream cut mid-response in a non-interactive session |
| `thinking_only_retry` | 487314 | `end_turn`/`stop_sequence` with no visible text at all |
| `stop_hook_blocking` | 487341 | a Stop hook returned a blocking error |
| `reactive_compact_retry` | 487268 | prompt-too-long → compaction succeeded → retry |
| `precomputed_compact_swap` | 487268 | same, but a pre-computed compaction was swapped in |

Retry-nudge texts, all defined together at **413389**:

| Symbol | Verbatim |
|---|---|
| `$lt` | `The previous response failed to produce a valid tool call. Please retry the tool call now.` |
| `Tin` | `Your tool call was malformed and could not be parsed. Please retry.` |
| `Ult` | `[Your previous response had no visible output. Please continue and produce a user-visible response.]` |
| `Blt` | `The PermissionDenied hook indicated you may retry this tool call.` |

Inline nudges (built at their use sites, `isMeta: true, turnCompanion: true`):

- **487284** — `Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`
- **487293** — `Your response above was cut off mid-stream. Resume directly from where it stops — no apology, no recap. If none of it survived, answer the request from the start.`

`CAt = 3` (**486305**) caps both output-token and truncation recovery. `Ijn` (**486313**) decides whether a
`max_tokens`-truncated *thinking-only* response can be resumed in place (gate `tengu_thinking_block_resumption`)
rather than nudged.

### 1.3 Lifecycle of one turn, in order

Everything below is one iteration of `while(!0)` starting at **486493**.

**Phase 0 — pre-turn absorption (once, before the loop, 486443–486492).**
Skill-listing / memory-prefetch attachments are awaited and yielded; then two folds of the message queue:
`poll_events` at turn start (**486450**, via `PAt` at **486476**), and a "passive fold" of `BW`-class commands
(**486484**). Both call `messageQueue.registerFoldInFlight` / `consume(cmds, { reason: "absorbed_mid_turn" })`.

**Phase 1 — background/abort gate.** `shouldStopBeforeNextApiCall?.()` → `{reason:"background_requested"}` (**486509**).

**Phase 2 — `yield { type: "stream_request_start" }`** (**486511**) and a `queryTracking` frame
`{ chainId, depth }` — depth increments per nested query, so subagents inherit a chain id.

**Phase 3 — message preparation.**
`Cn = [...Rl(Jn)]` flattens; `E8n` applies content replacement; `NAt(systemPrompt, systemContext)` renders the system
blocks; `pe.autocompact(...)` runs (**486524**) and may return `{kind:"compacted"|"failed"|"rapid_refill_breaker_tripped"}`.
Then `nAt` (**485973**) and `mEt` (**483865**) inject `session_context` / `date` change notices.

**Phase 4 — model resolution.** `Wr()` = `uAt({refusalOverride, fableConsentOverride, liveSwitchOverride, chainModel, primaryModel})`
(**486019**) — a strict precedence chain. `dAt` (**486022**) detects a *live* model switch (user ran `/model` mid-turn)
and emits `tengu_live_model_switch`. Fable-consent dialog handling runs at **486602–486680**.

**Phase 5 — the inner dispatch loop, `while(Ol)`** (**486706**). This is where the API call happens. One pass = one
HTTP request. `Ol = true` re-dispatches without advancing `turnCount`. The API call is:

```js
for await (let vr of zEt(pe.callModel({
    messages: HAt(i_.messages, me),      // 497275: prepends the userContext <system-reminder>
    systemPrompt: Er, thinkingConfig: KOe(ct),  // 88541
    tools: ct.options.tools, signal: ct.abortController.signal,
    options: { model: qr, fallbackModel: ut[Ve+1], refusalFallbackModel, …, taskBudget }
}), () => rr.streamingToolExecutor))                                    // 486781
```

`pe.callModel` is `XN` (**497986**) → `HIt` (**498319**), the request builder + streaming loop.

**Phase 6 — event fan-out** (486786–487068). Handled inline, in this order: `tool_drain_tick`,
`server_fallback`, `refusal_no_fallback`, `fallback_request`, `streaming_fallback_began`, then generic
`assistant` / `stream_event`. On each `assistant` message:

```js
Ar.push(Vs);                                     // 487057 assistantMessages
let Ca = Vs.message.content.filter(k => k.type === "tool_use");
if (Ca.length > 0) Ds.push(...Ca), rr.needsFollowUp = !0;   // 487060 toolUseBlocks
for (let kc of Ca) rr.streamingToolExecutor.addTool(kc, Vs); // 487062  ← starts tools NOW
yield* ss();                                     // 487068 drain finished tool results
```

`rr` is the per-turn accumulator built by `rAt` (**486004**):

```js
{ assistantMessages: [], toolResults: [], toolUseBlocks: [],
  needsFollowUp: false, toolRequestedEndTurn: false,
  shouldPreventContinuation: false, toolWasDeferred: false,
  streamingToolExecutor: createStreamingToolExecutor(),
  reset({clearAssistantMessages}), rebuildStreamingToolExecutor() }
```

**Phase 7 — no-tool exits** (`!rr.needsFollowUp`, **487227–487343**). In order: prompt-too-long / image-error
recovery; `max_output_tokens` recovery; truncated-response recovery; malformed-tool-use retry; thinking-only nudge;
`isApiErrorMessage` → `{reason:"api_error"}`; Stop-hook fan-out (`XCt`) with `maxTurns` and
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8` (**487339**); finally `{reason:"completed"}`.

**Phase 8 — tool drain** (**487379**). `for await (let kn of rr.streamingToolExecutor.getRemainingResults())` —
yields each tool's messages, and `kn.newContext` threads permission-layer mutations forward into `hi`.

**Phase 9 — post-tool.** `PostToolBatch` hooks (**487437**); `refreshTools` / `refreshMcpClients` re-read
(**487479**, telemetry `tengu_mcp_tools_refreshed_mid_turn`); mid-turn absorption of queued commands and poll events
via `Jee` (**487503**); `max_turns` check.

**Phase 10 — recur.** `Pe = { messages: [...Cn, ...Ar, ...fo], turnCount: Wk, transition: {reason:"next_turn"} }` (**487547**).

### 1.4 Performance marks (a free map of the pipeline)

`Mc(name)` (**484578**) records a `performance.mark` when `CLAUDE_CODE_PROFILE_STARTUP` is set or a 5 % sample hits
(`nHn = 0.05`, **484028**). The ordered marks are the loop's own table of contents:

`query_user_input_received` → `query_fn_entry` → `query_autocompact_start` / `_end` → `query_setup_start` / `_end` →
`query_api_loop_start` → `query_tool_schema_build_start` / `_end` → `query_message_normalization_start` →
`query_api_streaming_start` / `_end` → `query_tool_execution_start` / `_end` → `query_recursive_call` → `query_profile_end`.

Slow-mark thresholds (`lHn`, **484592**): >1000 ms = `VERY SLOW`, >100 ms = `SLOW`, with special 50 ms budgets for
`git_status`, `tool_schema`, `client_creation`.

### 1.5 Terminal reasons

`Zw` at **306736** is the canonical union — 15 engine reasons plus 4 driver-level ones:

```js
bQ = ["blocking_limit","rapid_refill_breaker","prompt_too_long","image_error","model_error",
      "api_error","malformed_tool_use_exhausted","aborted_streaming","aborted_tools",
      "stop_hook_prevented","hook_stopped","tool_deferred","max_turns","background_requested","completed"]
yQ = ["budget_exhausted","structured_output_retry_exhausted","tool_deferred_unavailable","turn_setup_failed"]
Zw = [...bQ, ...yQ]
```

Classifiers (**306739–306774**):

| Fn | Meaning |
|---|---|
| `E6(r)` | is an abort (`aborted_streaming`, `aborted_tools`) |
| `nbt(r)` | is an *error* outcome — true for the first 7 of `bQ` plus all 4 of `yQ`; false for aborts, hook stops, `max_turns`, `background_requested`, `completed` |
| `rbt(r)` | `E6 \|\| nbt` — drives whether absorbed commands report `cancelled` |
| `itr(t)` | telemetry label: `api_error_<errorKind>` for api errors, else the reason |

`cAt` (**486032**) fires `tengu_turn_end { terminal_reason, error_kind, is_error, turn_count, is_subagent, goal_active, duration_ms, query_source, query_source_category }`.

---

## 2. Tool scheduling

### 2.1 The streaming tool executor (`ORe`, cli.pretty.js:484328–484531)

This is the only scheduler the main loop uses. State per tool:

```js
{ id, block, assistantMessage, status, isConcurrencySafe, pendingProgress: [], pendingBridgeEvents: [], results: [], abortController?, promise?, contextLayers? }
```

`status ∈ { "queued", "executing", "completed", "yielded" }`.

**Admission** — `addTool(block, assistantMessage)` (**484364**):

1. Unknown tool name → immediately synthesised as a *completed* entry with
   `<tool_use_error>Error: No such tool available: ${name}${suggestion}</tool_use_error>`, `is_error: true`,
   and `isConcurrencySafe: true` (**484369**).
2. Otherwise `inputSchema.safeParse(block.input)`; concurrency-safety is
   `parse.success ? Boolean(tool.isConcurrencySafe(parsed.data)) : false` (**484374**) — **a parse failure makes the
   tool unsafe**, and any throw inside `isConcurrencySafe` also degrades to unsafe.
3. Push with `status: "queued"`, then `processQueue()`.

**Admission policy** — `canExecuteTool` / `processQueue` (**484383–484393**):

```js
canExecuteTool(isSafe) {
  let executing = this.tools.filter(t => t.status === "executing");
  return executing.length === 0 || (isSafe && executing.every(t => t.isConcurrencySafe));
}
async processQueue() {
  for (let e of this.tools) {
    if (e.status !== "queued") continue;
    if (this.canExecuteTool(e.isConcurrencySafe)) await this.executeTool(e);
    else if (!e.isConcurrencySafe) break;
  }
}
```

Consequences worth stating precisely:

- **There is no maximum concurrency on this path.** If the model emits 30 concurrency-safe `tool_use` blocks, all 30 run at once.
- A concurrency-unsafe tool is a **barrier in both directions**: nothing starts while it executes, and it does not start
  until everything executing has finished.
- The scan `break`s at the first *unsafe* queued tool, so relative ordering across an unsafe boundary is preserved,
  but safe tools after that barrier are simply not considered until it clears.
- `executeTool` re-runs `processQueue()` in its `.finally` (**484480**), so the queue drains as slots free.

**Execution** — `executeTool` (**484438**):
- Pre-flight `getAbortReason(tool, false)` → if aborted, synthesise the error result and stop.
- Creates a **per-tool child AbortController** `w_(parentController)` (**484446**) whose abort propagates *upward*:
  if the child aborts and neither the parent nor the executor is discarded, the parent is aborted too. That is how a
  single tool's fatal abort tears down the turn.
- Runs `a9(block, assistantMessage, canUseTool, {...ctx, abortController: child, sameTurnToolUses}, now)` (**480870**).
- `sameTurnToolUses` = `buildSameTurnToolUses(e)` (**484422**): the `tool_use` blocks of every tool **admitted before this
  one**, regrouped by assistant message. Auto-mode permission decisions see their siblings.
- `contextLayers` returned by an **unsafe** tool are folded into the executor's own `toolUseContext` via `Gue`
  (**484476**, `Gue` at **88558**) — a permission/model/thinking layer stack. Safe tools' layers are applied per-batch
  in the alternate path only.

**Draining** — `getCompletedResults()` (**484483**), a *sync* generator called after every stream event (`ss()` at **486591**):

```
for each tool in admission order:
  flush pendingBridgeEvents
  flush pendingProgress          → { message: progress, newContext }
  if status === "yielded"  continue
  if status === "completed" → mark "yielded", yield each result, then
                              yield { type:"set_in_progress_tool_use_ids", op:{action:"remove", ids:[id]} }
  else if status === "executing" && !isConcurrencySafe → break
```

So `tool_result` messages are emitted in **completion order within a safe batch**, not strictly in `tool_use` order;
ordering is only guaranteed across unsafe boundaries. `getRemainingResults()` (**484503**) is the async closer: loop
`processQueue` → drain → if nothing drained and something is executing, `Promise.race([...toolPromises, progressAvailable])`.

**Cancellation / discard** — `discardAndAbortInFlight(reason)` (**484346**) returns
`{ aborted, completedBeforeEvent, queuedNeverStarted, toolUseIds }` and is called on refusal fallback, chain advance and
streaming fallback. The counterpart `yq(executor, lane, opts)` produces the compensating `set_in_progress_tool_use_ids`
removal event. Telemetry: `tengu_rotunda_pennant_tools { lane, aborted, completed_before_event, queued_never_started, compensated_removes }`.

**Synthetic results** — `createSyntheticErrorMessage(id, reason, assistantMessage)` (**484396**):

| reason | `tool_result.content` | `toolDenialKind` |
|---|---|---|
| `user_interrupted` + abort reason `turn-abort` | `[Request interrupted by a plugin for tool use]` (`dE`, 413362) | `interrupted` |
| `user_interrupted` (otherwise) | `The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.` (`Yf`, 413362) | `user-rejected` |
| `conversation_ended` | `<tool_use_error>Cancelled: Claude ended the conversation</tool_use_error>` | — |
| default (streaming fallback) | `<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>` | — |

`toolDenialKind` vocabulary (`iP`, **306775**):
`["user-rejected","permission-rule","automode-blocked","automode-unavailable","automode-parsing-error","interrupted","cancelled"]`.

### 2.2 The second, batched path (`jTe`, cli.pretty.js:459780)

A separate implementation exists and **is the one with a concurrency cap**:

```js
function kEn() { return a.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY ?? 10; }     // 459777
function wEn(blocks, ctx) { /* fold consecutive blocks into runs by isConcurrencySafe */ } // 459819
async function* vEn(blocks, …) { yield* QZ(blocks.map(gen), kEn()); }        // 459836
```

`QZ(generators, limit)` (**459747**) is a bounded async-generator merge: keep `limit` generators in flight, `Promise.race`
them, refill as each finishes. `jTe` groups **consecutive** safe blocks into a run, runs each run through `QZ` with
limit 10, and runs unsafe blocks strictly serially via `TEn` (**459833**), yielding a
`set_in_progress_tool_use_ids` removal after each. Its callers in this build are single-block invocations
(**460251**, **460329** — the deferred-tool resume and control-protocol tool call), so in practice the 10-cap does not
govern the main loop. **INFERRED:** `jTe` is the legacy non-streaming batcher retained for those two entry points.

### 2.3 Per-tool execution (`a9`, cli.pretty.js:480870)

Ordered gates, each with its own synthetic `tool_result`:

1. Tool not found → `<tool_use_error>Error: No such tool available: …</tool_use_error>` (**480886**).
2. Already aborted at entry → `ube(id)` with content `f2(Yf)` and `toolDenialKind: "cancelled"`; telemetry
   `tengu_tool_use_cancelled { phase: "entry", abortKind, … }` (**480896**).
3. Isolation-latch denial (`KN`) → `<tool_use_error>${denyMessage}</tool_use_error>`, `toolDenialKind: "permission-rule"` (**480900**).
4. Routing (`sre`): `refused` → error result; `elsewhere` → delegate to `hosts.runToolUse` (remote tool host).
5. Otherwise `_Un(...)` — the real permission-gate + execution generator (**480917**).
6. Any throw → `Error calling tool (${name}): ${msg}` with `toolDenialKind: Jwt(err, signal)`.

Denial strings (all defined at **516329**):

| Symbol | Verbatim (truncated where long) |
|---|---|
| `iT` | `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.` |
| `uk` | `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. …). To tell you how to proceed, the user said:\n` |
| `nI` | `Permission for this tool use was denied. The tool use was rejected (eg. …). Try a different approach or report the limitation to complete your task.` |
| `S9` | `Permission for this tool use was denied. The tool use was rejected (eg. …). The user said:\n` |
| `Zpt` | `The agent proposed a plan that was rejected by the user. The user chose to stay in plan mode rather than proceed with implementation.\n\nRejected plan:\n` |

`ZBn()` (**483942**) returns `[iT, uk, nI, S9, Yf, Vc, dE]` — the set used by `eHn` to recognise a `tool_result`
as "a denial/interrupt result" when scanning history.

`f2(text)` (**516324**) optionally appends `Flt` (**413364**):
`\n\nNote: The user's next message may contain a correction or preference. Pay close attention — if they explain what went wrong or how they'd prefer you to work, consider saving that to memory for future sessions.`

### 2.4 What is *not* there

`grep "Sibling tool uses failed"` returns **zero hits** in 2.1.251. There is no blanket sibling-cancellation on a single
tool failure: a failed tool produces an `is_error: true` `tool_result` and its siblings run to completion. Whole-batch
cancellation happens only via `discardAndAbortInFlight`, i.e. on refusal fallback, chain advance, streaming fallback and
abort — not on a per-tool error.

---

## 3. Streaming

### 3.1 Two accumulators

Claude Code carries the vendored Anthropic SDK's `MessageStream` (beta copy **238758–238932**, stable **239716–239830**)
**and** its own fold inside `HIt`. The CLI hot path uses its own; the SDK's drives `beta.messages.create` / `countTokens`.

### 3.2 The engine's own fold

Per-attempt state (**498971**): `bf` = array of in-flight blocks indexed by content-block index; `ld` = the
`message_start` envelope; `Es` = `Map<blockIndex, assistantMessage>`; `zc` = ordered emitted messages;
`Ws` = usage accumulator seeded from `gp` (**205706**); `Fr` = `stop_reason`.

| Event | Line | Effect |
|---|---|---|
| `ping` | 499992 | re-emitted as `stream_event` and `continue`; excluded from stall accounting. `h2(e) = e.type === "ping"` (**518225**) |
| `message_start` | 499055 | `ld = event.message`; TTFT = `round(performance.now() - start)`; `Ws = S2(Ws, usage)`; records `message.diagnostics.cache_miss_reason` |
| `content_block_start` | 499060 | seeds `bf[i]`: `tool_use`/`server_tool_use` → `{...block, input: ""}` (a **string**), `text` → `{text:""}`, `thinking` → `{thinking:"", signature:""}` |
| `content_block_delta` | 499090 | throws `RangeError("Content block not found")` if the index is unknown |
| `content_block_stop` | 499122 | heals via `Uq` (**517784**), builds a **complete assistant message** `{message:{...ld, content}, requestId, type:"assistant", uuid, timestamp}`, pushes to `zc` / `Es`, and **yields it** |
| `message_delta` | 499142 | `Ws = S2(Ws, usage)`; `Fr = delta.stop_reason`; back-patches `usage`/`stop_reason`/`stop_details` onto **every** message in `zc` (**499166**); deletes `stop_details.fallback_credit_token` from the wire object (499147) |
| `message_stop` | 499206 | finalises cost; `Qd("stream_completed", requestId, Ws)` |

Delta types (**499096–499121**):

| Delta | Action |
|---|---|
| `text_delta` | `block.text += delta.text` |
| `input_json_delta` | `block.input += delta.partial_json` — plain concat, no incremental parse |
| `thinking_delta` | no-op on a `redacted_thinking` block; else `block.thinking += delta.thinking` |
| `signature_delta` | `block.signature = delta.signature` (assign, not append) |
| `citations_delta` | **ignored entirely** by the engine (the vendored SDK does handle it) |

Every non-swallowed event is then re-emitted (**499205**) as
`{ type: "stream_event", event, ...(message_start ? { ttftMs, requestSentAtMs, requestSentWallMs } : {}) }`.

`Uq` (**517784**) is the block healer at `content_block_stop`: `tool_use` with a string `input` is `JSON.parse`d; on
failure it emits `tengu_tool_input_json_parse_fail` and substitutes a raw sentinel `{[CJe]:{raw: truncate(2048), len}}`.
A `text` block with non-string text is **dropped**; a thinking block missing `thinking`/`signature` is healed to `""`
(`tengu_content_block_healed`).

**The engine has no partial-JSON repair.** The only repair implementation is in the vendored SDK
(`__json_buf` sentinel at **238567**; tokenizer `ya` **238426**, truncator `Ze` **238510**, closer `wa` **238533**),
and the SDK path is not the hot path.

**Negative finding:** `fine-grained-tool-streaming` / `fine_grained` appear nowhere as a beta. Claude Code does not
opt into fine-grained tool streaming. Its "eager tool start" comes from `content_block_stop`-per-block emission plus
`zEt`, not from partial-input tool dispatch.

### 3.3 Stall / heartbeat

| Const | Line | Value |
|---|---|---|
| `k8n` heartbeat interval | 498176 | `1e4` ms |
| `v8n` max synthetic pings | 498176 | `30` |
| `lOe` / `w8n` | 498176 | `20000` / `90000` |
| `fd` stall threshold | 498998 | `30000` ms → `tengu_streaming_stall` |
| stream idle timeout | 846665 | `max(CLAUDE_STREAM_IDLE_TIMEOUT_MS, 300000)` |
| byte-stream idle | 846668 | firstParty default `180000`, clamped `[1e4, 1800000]` |

`C8n` (**498177**) wraps the SDK stream and, when a byte-level `_chunkTimes` side channel exists, synthesises
`{type:"ping"}` if raw bytes arrived but no SSE event decoded within 10 s — capped at 30 consecutive.

If the stream ends without `message_start`, or with `message_start` but zero completed blocks, it throws `J2t` →
**non-streaming fallback** (**499268**), which emits a `streaming_fallback_began` event the loop uses to tombstone
everything and rebuild the tool executor (**486967**). If `cause === "no_events"` on the main thread, the user sees
(once per session, **486980**):

> `Streaming response ended before any complete data was received. Retrying without streaming. If this keeps happening, check any proxy or gateway between Claude Code and your model provider.`

### 3.4 Thinking

Config resolution, **498522–498540**:

```js
let Tu = oDe(F);                                              // model max_output_tokens (499602)
let Ia = Math.min(maxTokensOverride || maxOutputTokensOverride || Tu, Tu);
let xg = thinkingConfig.type !== "disabled" && !CLAUDE_CODE_DISABLE_THINKING;
if (xg && QSn(F)) {
  if (adaptive-eligible) Mp = { type: "adaptive", display };
  else {
    let Gc = Zer(F);                                          // 306273: $V(model).upperLimit - 1
    if (thinkingConfig.type === "enabled" && budgetTokens !== undefined) Gc = budgetTokens;
    Gc = Math.max(1024, Math.min(Ia - 1, Gc));
    Mp = { budget_tokens: Gc, type: "enabled", display };
  }
}
```

So the thinking budget floor is **1024** and the ceiling is **`max_tokens − 1`**. `tool_choice {type:"tool"}` is demoted
to `auto` whenever extended thinking is on (**498555**).

Replay & stripping — a family of functions around **519352–519659**:

| Fn | Line | Behaviour |
|---|---|---|
| `Aq` | 519352 | is `thinking` or `redacted_thinking` |
| `Tq` | 519355 | carries a signature (`redacted_thinking`, or `thinking` with truthy `signature`) |
| `MIt` | 519597 | **foreign-model strip** — removes signed thinking from assistant messages whose `message.model` differs from the request model (`gbe`, 519601, tolerates `<synthetic>` and canonical equality) |
| `IIt` | 519606 | **nuclear strip** — all thinking removed; if a message empties, substitutes `{type:"text", text:"[Thinking removed]"}` |
| `Jur` | 519361 | trims a *trailing* run of thinking blocks off the last assistant message unless `preserveTrailingThinking` |
| `Tce` | 519543 | drops orphaned thinking-only assistant messages |
| `OIt` | 519659 | when a removed `tool_use` sat *between* two thinking blocks, replaces it with `{type:"text", text:"[Tool use removed]"}` to keep adjacency legal |

400-error recovery (**498921**): `Bue` (**412938**) matches the server's thinking rejections
(`"signature in thinking block"`, `"thinking.signature" + "field required"`, `"thinking block"|"redacted_thinking"` +
`"cannot be modified"|"invalid signature"`). On a hit the harness calls `IIt` to strip *everything*, logs
`[thinking] server rejected a thinking block; stripping all thinking blocks and retrying.`, fires
`tengu_thinking_signature_strip_retry`, and retries with token `"retry:thinking-signature-strip"`. A sibling path
(**498909**) flips `enabled ↔ adaptive` on `thinking.type ... not supported` (`"retry:thinking-type"`).

Thinking-token estimation: `Evt` (**524397**) prefers `delta.estimated_tokens` (the `thinking-token-count-2026-05-13`
beta), else `ceil(text.length / 4)` (`kun`, **518144**); emits
`{type:"system", subtype:"thinking_tokens", estimated_tokens, estimated_tokens_delta}` (**355999**).

### 3.5 Beta headers

All beta constants are declared on one line, **303292**, via `he(name, header)` (**303290**). Selected entries
(condition line in the last column):

| Header | Symbol | Gate |
|---|---|---|
| `claude-code-20250219` | `$n` | every non-haiku model — 306521; forced for agentic sources — 306570 |
| `interleaved-thinking-2025-05-14` | `Cr` | `!DISABLE_INTERLEAVED_THINKING && JSt(model)` — **306527** |
| `context-1m-2025-08-07` | `qk` | `Cc(model)` (the `[1m]` suffix) — 306525; re-added at 498504 |
| `context-management-2025-06-27` | `TMe` | firstParty-class, `USE_API_CONTEXT_MANAGEMENT \|\| cQ(model)` — 306535 |
| `structured-outputs-2025-12-15` | `PV` | `QSt(model)` + gate `tengu_tool_pear` — 306538 |
| `effort-2025-11-24` | `k8e` | added by `e8n(effort,…)` — 498513 |
| `task-budgets-2026-03-13` | `r3t` | added by `t8n(taskBudget,…)` — 498513 |
| `extended-cache-ttl-2025-04-11` | `EMe` | `ttl === "1h" && uw()` — 498577 |
| `prompt-caching-evict-2026-05-12` | `Ude` | evict-on-complete — 498582 |
| `fast-mode-2026-02-01` | `x8e` | fast mode — 498571 |
| `redact-thinking-2026-02-12` | `DSt` | `uw() && JSt(model) && !Le()` — 306529; **removed** when a thinking `display` is set (498541) |
| `thinking-token-count-2026-05-13` | `Ts` | firstParty + thinking-capable — 306531 |
| `advanced-tool-use-2025-11-20` / `tool-search-tool-2025-10-19` | `Qc` / `vr` | tool search active, non-Bedrock — 498371 |
| `server-side-fallback-2026-06-01` / `-2026-07-01` | `zk` / `pg` | `MEt(...)` — 498514 |
| `mid-conversation-system-2026-04-07` | `Gk` | `NMe(model)` — 306546 |
| `per-turn-control-2026-07-01` | `qI` | `MSt(model, canonical)` — 306572 |
| `thinking-display-updates-2026-08-18` | `DV` | thinking `display` path — 498550 |

Escape hatch: `ANTHROPIC_BETAS` (comma-split, appended raw, **306549**). Filter sets: `Zc` (**303306**) = betas routed
through Bedrock's `body.anthropic_beta` instead of the header; `RSn` = the only betas forwarded on `countTokens`;
`Yw` (**306588**) = betas allowed on third-party providers, with rejects logged as `SDK beta '<x>' dropped on 3P`.

**Sticky betas** (**78889–78907**) are a per-conversation rejection latch:

```js
x4()  → { sent: new Set, rejected: new Set }
xJ(s, beta) → if (!s.rejected.has(beta)) s.sent.add(beta)
jC(s, beta) → s.sent.delete(beta); s.rejected.add(beta)
yA(s, beta) → s.rejected.has(beta)
```

Once a beta is rejected it is filtered out of the request for the rest of the conversation (**498429**). Two
error-driven latches fire in the retry handler: `cache-diagnosis-beta` (**498903**) and
`prompt-caching-evict-beta` (**498906**).

### 3.6 Usage and stop reasons

Zero template `gp` (**205706**):

```js
{ output_tokens_details:{thinking_tokens:0}, input_tokens:0, cache_creation_input_tokens:0,
  cache_read_input_tokens:0, output_tokens:0,
  server_tool_use:{web_search_requests:0, web_fetch_requests:0}, service_tier:"standard",
  cache_creation:{ephemeral_1h_input_tokens:0, ephemeral_5m_input_tokens:0},
  inference_geo:"", iterations:[], speed:"standard" }
```

`S2(prev, incoming)` (**499549**) is a "take incoming only if strictly positive" fold for the input-side counters and a
plain overwrite for `output_tokens`. `yft` (**499557**) is the server-fallback variant (plain `??`, derives
`cache_creation_input_tokens` from the 1h+5m sum). `TGe` (**499561**) is the cross-request summer used for session totals.

`stop_reason` union (**413194**):

```js
Eqt = { end_turn:1, max_tokens:1, stop_sequence:1, tool_use:1, pause_turn:1,
        compaction:1, refusal:1, model_context_window_exceeded:1 }
```

`pause_turn` is in the type set but has **no handler anywhere in the bundle** — the string appears nowhere else.

| stop_reason | Line | Handling |
|---|---|---|
| `refusal` | 499171 | `fallback_request` (with fallback) or `refusal_no_fallback` |
| `max_tokens` | 499190 | `tengu_max_tokens_reached`; error message `API Error: Claude's response exceeded the ${n} output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.`; `apiError: "max_output_tokens"` |
| `model_context_window_exceeded` | 499193 | `The model has reached its context window limit.` |
| `tool_use` | — | not branched on; the loop keys off the presence of `tool_use` blocks. If `stop_reason === "tool_use"` but zero blocks parsed → malformed-tool-use retry (**487301**) |
| `end_turn` / `stop_sequence` | 487311 | terminal, with the thinking-only nudge check |

Server-side fallback "pennant" blocks (`{type:"fallback", from, to, trigger}`) are recognised by `MRe` (**484212**),
consumed, never re-emitted, and converted into a `server_fallback` engine event (**499019**).

### 3.7 Spinner mapping (`Kve`, cli.pretty.js:518228)

`stream_request_start` → `requesting`; `content_block_start` of `thinking`/`redacted_thinking` → `thinking`,
`text` → `responding`, `tool_use` → `tool-input`; `message_stop` → `tool-use`. Caps: `Bzt = 1e6` streamed chars,
`Lur = 256` tracked streaming tool uses, `Fur = 32768` bytes max serialised `tool_use` block (**518150**).

---

## 4. Input queueing, steering, and interrupts

### 4.1 The message queue

The queue is a **closure**, not a class: factory `ssn(e)` at **421927**, process singleton `Qm()` at **422345**
(`var XV = ssn()` at **422337**). Internally it is a plain array `o` plus a frozen snapshot and a subscriber emitter.
The public surface is the object literal returned at **422336**:

```
subscribe, getCommandQueueSnapshot, getCommandQueue, getCommandQueueLength, getMainThreadQueueLength,
getDrainableMainThreadQueueLength, getQueuedPeerMessageCount, hasCommandsInQueue, recheckCommandQueue,
enqueue, enqueueReportingAdmission, flushPeerDropReceipts, enqueuePendingNotification, enqueuePollEvent,
drainPollEventChunk, countPendingWakePollEvents, countRemainingWakePollEventsAfter,
hasUserIntentCommandsInQueue, tryBeginPollCall, endPollCall, dequeue, dequeueAll, peek,
dequeueAllMatching, remove, consume, removeByFilter, clearCommandQueue, resetCommandQueue,
popAllEditable, popEditableAt, getCommandsByMaxPriority, markCancelPending, consumeCancelPending,
consumeCancelPendingAcked, hasCancelPendingAcked, registerFoldInFlight, unregisterFoldInFlight,
isFoldInFlight, suspendMidTurnFold, isMidTurnFoldSuspended, settleScreening, setInFlightDrainBatch,
clearInFlightDrainBatch, someInFlightDrainCommand, takeInboundEnqueueTurn
```

**Priorities** — `YV = { now: 0, next: 1, later: 2 }` (**421832**). `dequeue`/`peek` (**422161**, **422190**) are a
min-priority linear scan that preserves insertion order among equals. `getCommandsByMaxPriority(p)` (**422334**) is
`o.filter(c => YV[c.priority ?? "next"] <= YV[p])`.

Defaults at enqueue: ordinary commands `"next"` (**422090**), pending notifications `"later"` (**422100**), poll
events `"next"` when they carry a wake flag else `"later"` (**422132**).

**`"now"` is the steering priority.** Two independent watchers abort the running turn the moment a `now` command
lands — the REPL turn controller at **169718** (`this._snapshot.abortController?.abort(Su("interrupt"))`) and the
headless queue subscription at **359683** (`if (Qe && !xo() && F.getCommandsByMaxPriority("now").length > 0) Qe.abort(Su("interrupt"))`).
In this build `now` is only reachable from the cross-session UDS peer path (**318288**).

**Command modes.** `mode ∈ prompt | bash | task-notification | poll-event | …`, with `PYt = new Set(["task-notification","poll-event"])`
(**421859**), `yv` = user-editable (**421862**), `Zxe` = drainable main-thread (**421875**),
`BW(e) = e.passive === true && gu(e)` (**421882**).

**Lifecycle states.** Emitted internally as `{type:"command_lifecycle", uuid, state}` and translated to
`{type:"command_lifecycle", command_uuid, state, uuid, session_id}` (**358015**):

| state | emitted at |
|---|---|
| `queued` | 524740 (engine accepts a turn intent) |
| `started` | 486395 (poll-event absorption), 487521 (mid-turn queued-command absorption), 360602 |
| `completed` | 486343 (turn end, non-aborted), 360600 |
| `cancelled` | 486339 (turn end when `rbt(reason)`), 360629 |
| `discarded` | 524708 (queued intents dropped when the engine generator closes) |

### 4.2 Mid-turn fold — how typed-while-running text gets in

Three fold points, all guarded by `isMidTurnFoldSuspended()` (`Oe()` at **421996** = `pe || xo()`, where `pe` is set
only by `suspendMidTurnFold()` from the SDK `end_session` handler at **360641**, and `xo()` is the global
shutdown-committed flag at **59455**):

| Point | Line | What it folds |
|---|---|---|
| turn start, poll events | 486435 | `getCommandsByMaxPriority("next")` → `Lpe(...)` → `.filter(BE)` |
| turn start, passive commands | 486466 | `getCommandQueue().filter(BW)` |
| **mid-turn, after each tool batch** | 487487 | `getCommandsByMaxPriority("next")` → `Lpe(...)` → `.filter(OAt(screeningReader))` |

`Lpe(commands, {isMainThread, currentAgentId})` (**421888**) is the eligibility filter:

```js
let u = e.filter((d) => {
  if (IYt(d)) return !1;                                    // 421885
  if (t) return gu(d);                                      // main thread: any user-intent command
  return d.mode === "task-notification" && d.agentId === r; // subagents: only their own notifications
});
return OYt(u);
```

`IYt(e)` (**421885**) is `typeof e.value === "string" && e.value.trim().startsWith("/") && !e.skipSlashCommands` —
**slash commands are never absorbed mid-turn**; they wait for the turn to end.

`OAt(reader)` (**487602**) returns a *stateful* filter admitting **at most one `prompt`-mode command per fold**:

```js
function OAt(e) {
  let t = !1;
  return (r) => {
    if (t && r.mode === "prompt") return !1;
    if (!$jn(r, e)) return !0;
    return t = !0, !1;
  };
}
```

Fold sequence (**487488–487535**): `registerFoldInFlight(candidates)` (holds uuids in a `Set` so the UI cannot pop
them concurrently, **421978**) → `Jee(...)` (**493197**) builds `queued_command` / `poll_events` attachments (image
handling and `promptSubmitted.text` come from `vSe` at **492162**) → each attachment is yielded **and pushed into
`fo` (`toolResults`)**, so the queued text lands in the *same* user turn as the tool results → `consume(cmds,
{reason:"absorbed_mid_turn"})` → `yield {type:"command_lifecycle", uuid, state:"started"}` → `finally
{ unregisterFoldInFlight }`.

Degradation is deliberately conservative — the code refuses to drop input:

- **487523** — `[query] queued_command attachments degraded to 0 for ${n} consumed command(s) — leaving them queued instead of dropping them`
- **487525** — `[query] partial queued_command emission: ${k}/${n} — removing commands that were not all delivered` (level `error`)
- **487516** — `[query] abort/suspension during mid-turn absorption — leaving ${n} command(s) queued`
- **486388** — `[query] abort/suspension during ${phase} absorption — leaving ${n} poll event(s) queued`
- **486398** — `[query] ${phase} poll_events emission degraded to 0 for ${n} event(s) — leaving them queued`
- **486472** — `[query] turn-start passive fold emitted ${k} of ${n} — leaving them queued`

### 4.3 What the model actually sees

`Ece(text, origin, opts)` (**519826**) picks the wrapper. For `origin.kind ∈ {human, auto-continuation, undefined}`
(**519852**) the folded text becomes, verbatim (`Iun` at **519795**):

```
The user sent a new message while you were working:
<text>

This is how Claude Code surfaces messages the user sends mid-turn — within the running turn, often alongside the
next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn.
```

Other origins get their own prefixes: `Pun` (**519795**) `A message arrived in the bound thread while you were working:\n`
for a verified Slack human turn, `Gq` for non-user sources, and per-kind wrappers for `task-notification`,
`coordinator`, `channel`, `peer`, `observer`, `plugin`.

There is also a *pre-API* steering hook: `shouldStopBeforeNextApiCall?.()` (**486509**) is wired in the REPL to
`() => gesture.pending !== null` (**169927**) — a pending gesture parks the turn with
`{reason:"background_requested"}` rather than firing another request.

### 4.4 How typed text becomes a queued command

`wI(S)` at **168909** is the prompt-submit entry. At **168973** — `if (st.isActive || nt)` (a turn is running, or an
external load is in flight) — the prompt is **not** dispatched; instead (**168980**):

```js
Fe.enqueue({ ...Qo, value: jt.trim(), preExpansionValue: …,
             ...tn && { screeningPending: !0 },
             ...(cn || nn) && { drainOnly: !0 } });
```

then `y("prompt_queued")`. `screeningPending` runs the `UserPromptSubmit` hook chain immediately at Enter
(**168991**) and is settled later via `settleScreening(uuid, …)` (**422001**); a hook that drops the prompt removes
it with reason `"dropped_by_hook"` (**422005**).

### 4.5 The abort vocabulary

**742382** — abort reasons are pre-allocated `DOMException`s:

```js
var d = { "user-cancel": …, "remote-cancel": …, shutdown: …, interrupt: …, "turn-abort": …,
          background: …, "refusal-fallback-edit": …, "recovery-timeout": … };  // each new DOMException(name, "AbortError")
function Su(e) { return d[e]; }
function Za(e) { return e instanceof DOMException && e.name === "AbortError" ? e.message : e; }
var A = new Set(["user-cancel","remote-cancel","shutdown","interrupt","turn-abort"]);  function zLe(e){ return A.has(Za(e)); }
var f = new Set(["interrupt","turn-abort","refusal-fallback-edit"]);                   function SV(e){ return f.has(Za(e)); }
function VS(e) { return Za(e.reason) === "shutdown" ? !0 : void 0; }
```

| Reason | Raised by | Line |
|---|---|---|
| `user-cancel` | ESC / Ctrl-C in the TUI; `interruptForSubmit` | 169915, 169917 |
| `remote-cancel` | SDK `interrupt` control request | 169915, 360616 |
| `interrupt` | a `now`-priority queued command arrived (silent steering) | 169721, 359684 |
| `turn-abort` | a plugin's `raiseTurnStart` hook called `abort()` | 170120 |
| `shutdown` | process shutdown / `end_session` | 48018, 360642 |
| `background` | task backgrounded, not cancelled | 145038 |
| `refusal-fallback-edit` | user chose "edit prompt" at a refusal-fallback dialog | 486909 |

**The `interrupt` vs `user-cancel` distinction is load-bearing in two places at once.** `SV()` (**742394**)
suppresses the turn-level `[Request interrupted by user…]` marker for `interrupt`, and `dG()` (**480620**)
suppresses the per-tool synthetic result for the same reason:

```js
function dG(e, t, r) {
  if (!e.aborted) return null;
  let o = Za(e.reason);
  if (o === "interrupt") return null;
  if (t.ran && $A.backgroundsTheShell(e.reason, r) && (t.name === Qe || t.name === Bt)) return null;
  if (o === "end_conversation") return t.name === dUn ? null : "conversation_ended";
  return "user_interrupted";
}
```

So `interrupt` is the **silent steering** abort — the queued message *is* the signal, and the transcript stays clean —
while `user-cancel` is the **visible ESC** abort that records the interruption. A harness that collapses both into a
single "abort" will either double-inject interruption markers during steering or lose them on ESC.

### 4.6 The synthetic messages

All defined together at **413362**:

```js
var V_ = "[Request interrupted by user]",
    Vc = "[Request interrupted by user for tool use]",
    dE = "[Request interrupted by a plugin for tool use]",
    Yf = "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
    jU = "User rejected tool use",
    JR = "API Error: Request was aborted.",
    iee = "Operation stopped by hook",
    b2 = [V_, Vc, dE, Yf];
```

The factory (**516592**):

```js
function rI({ toolUse = !1, interruptedMessageId, interruptedByShutdown, now, uuidFn }) {
  return xe({ content: [{ type: "text", text: toolUse ? Vc : V_ }], interruptedMessageId, interruptedByShutdown, now, uuidFn });
}
```

The choice between the two turn-level strings is purely **"was the turn aborted before or after tool execution"**:

| Call site | Line | `toolUse` | Text | Terminal reason |
|---|---|---|---|---|
| after streaming, before tools | 487195 | `false` | `[Request interrupted by user]` | `aborted_streaming` |
| Fable-consent dialog abort | 486637 | `false` | same | `aborted_streaming` |
| Stop-hook phase | 485781 | `false` | same | — |
| end-turn path `Mjn` | 486290 | `false` | same | — |
| **after tool execution** | 487416 | `true` | `[Request interrupted by user for tool use]` | `aborted_tools` |
| during `PostToolBatch` hooks | 487466 | `false` | `[Request interrupted by user]` | `aborted_tools` |

Every site is guarded by `if (!SV(signal.reason))`. `kq(ctx)` (**486249**) supplies `interruptedMessageId` only for
`user-cancel` / `remote-cancel` and only on the main thread.

Per-tool synthetics (see §2.3 for the full table): `iT` (`The user doesn't want to proceed with this tool use…`,
**516329**) with `toolUseResult: jU` and `toolDenialKind: "user-rejected"` for an ESC during execution; `Yf` with
`toolDenialKind: "cancelled"` for a tool dispatched *after* the signal already aborted (`ube(id)` at **516611**,
used at **480892** with telemetry `phase: "entry"`); `dE` with `toolDenialKind: "interrupted"` when the reason is
`turn-abort`.

Recognizers built on these constants:

| Fn | Line | Meaning |
|---|---|---|
| `NA(e)` | 413365 | every content element's text starts with a member of `b2` — "this message is purely an interruption marker" |
| `mI(e)` | 413378 | `interruptedByShutdown === true` **and** the content contains a `tool_result` |
| `lp(e)` / `dp` | 354149 / 354158 | `dp = new Set([V_, Vc, dE, Yf, Yf+Flt, iT, iT+Flt])` — "all blocks are interruption tool_results" |
| `bce` | 516388 | `new Set([V_, Vc, Yf, iT, Qv])` — excluded from API-error reason extraction |

Adjacent synthetic strings worth knowing:

| String | Meaning | Line |
|---|---|---|
| `No response requested.` (`Qv`) | synthetic **assistant** message (`message.model === "<synthetic>"`, `rd` on the same line) appended when a transcript ends on a user message so resumed history alternates correctly; spliced in at **453878**, removed again at **360559** | 205706 |
| `Continue from where you left off.` | `Rut()`, the resume prompt injected when a shutdown-interrupted turn is resumed; overridable by `CLAUDE_CODE_RESUME_PROMPT` | 453762 |
| `(no content)` (`of`) | empty-content placeholder in `xe(...)` | 205706 |

### 4.7 Unresolved `tool_use` ids

**During a live turn — yes, one synthetic `tool_result` per id, from two complementary layers.**

1. **Scheduler layer** (`ORe`, §2.1): `getAbortReason` → `dG` → `createSyntheticErrorMessage`. Covers every reason
   except `interrupt`.
2. **Tool-runner layer** (`a9`, **480890**): the very first check is `if (o.abortController.signal.aborted)` → emit
   `ube(id)` with `content = f2(Yf)`, `toolDenialKind: "cancelled"`. This catches the plain `interrupt` reason that
   `dG` deliberately lets through.

Queued-but-never-started tools are not skipped: `processQueue()` re-runs from `executeTool`'s `finally` (**484480**)
and `getRemainingResults()` (**484503**) loops until `hasUnfinishedTools()` is false, so every id passes through
layer 1 or 2 exactly once.

**At resume/reconstruction time — no.** `pbe(e, t, r)` (**517988**) computes `{tool_use ids} \ {tool_result ids}` and,
rather than fabricating results, **drops the assistant messages** whose `tool_use` blocks are all unresolved
(**518041**), optionally dropping sibling blocks of the same `message.id`. Callers at **453865** pass
`shutdownUnwindResultsDoNotResolve: true`, which makes shutdown-authored tool results (`mI`) *not* count as
resolving — so the whole shutdown-unwound assistant turn is excised and a `Continue from where you left off.` prompt
is injected instead (**453877**).

**Partial assistant text on abort.** `keepPartialMessageOnAbort` (**498974**): `if (d.querySource !== "sdk" &&
d.keepPartialMessageOnAbort !== true) return;` — otherwise the last non-empty text block is salvaged into an
assistant message stamped `isAbortedMidStream: true` (**498979**). The REPL separately preserves partially-streamed
*thinking* as a virtual message `{content:[{type:"thinking", thinking: partial, signature: ""}], isVirtual: true}`
(**169896**).

### 4.8 ESC, Ctrl-C, double-ESC

Default bindings, `ADe` at **717586**:

| Context | Chord | Action |
|---|---|---|
| Global | `ctrl+c` | `app:interrupt` |
| Global | `ctrl+d` | `app:exit` |
| Global | `ctrl+r` | `history:search` |
| Chat | `escape` | `chat:cancel` |
| Chat | `enter` | `chat:submit` |
| Chat | `ctrl+x enter` | `chat:queueSubmit` |
| Chat | `ctrl+x ctrl+k` | `chat:killAgents` |
| Chat | `ctrl+l` | `chat:clearInput` |
| Autocomplete | `escape` | `autocomplete:dismiss` |

**Single ESC = interrupt.** `chat:cancel` (**153657**): if a queue-edit is in progress it is cancelled instead;
otherwise `jo({ gesture: "escape", suppressBackgroundAgentKill: true })`. `jo` (**153619**) fires
`tengu_cancel {source:"escape"}` and calls the REPL `cancel` (**169886**), which aborts with `user-cancel` and calls
`this._engine.interrupt(reason, dKt(source))`. `dKt("local")` (**524422**) yields `{scope: "turn-cancel"}` — the
engine then aborts **only** the turn (**524722**), leaving background agents alive.

**Ctrl-C = interrupt, then exit on the second press.** `app:interrupt` (**153674**) calls
`jo({gesture:"ctrl_c"})` with **no** `suppressBackgroundAgentKill`, so Ctrl-C also reaps background agents
(**153643**). With nothing running it becomes a double-press exit rendering `Press Ctrl-C again to exit`
(**131832**, **173213**, **188101**).

**Double-press primitive** — `YP(setPending, onDouble, onFirst?, n = a)` at **398424** with `a = 800` ms
(**398423**).

**Double-ESC = rewind.** `rEe = YP(() => {}, H.openMessageSelector)` (**160091**); the chat key handler calls `rEe()`
on `escape` (**159968**) once the guards pass. `openMessageSelector` (**171628**) refuses in cloud sessions with
`Rewind is not yet available in cloud sessions` and otherwise opens the picker (dialog titled `"Rewind"`,
**151345**). The in-product tips confirm the semantics (**528631**):

| tip id | content |
|---|---|
| `double-esc` | `Double-tap esc to rewind the conversation to a previous point in time` |
| `double-esc-code-restore` | `Double-tap esc to rewind the code and/or conversation to a previous point in time` |

Rewind telemetry: `tengu_conversation_rewind { preRewindMessageCount, postRewindMessageCount, messagesRemoved, rewindToMessageIndex, source }`
(**151043**), metric `repl_rewind_conversation` (**151053**). It is also a control-request subtype,
`rewind_conversation` (**360899**), validating `rewind_conversation: target_message_uuid must be a string`.

**ESC on a non-empty composer = clear** — a *different* double-press. `vnt` (**623406**), handler at **623423**:
first press shows the immediate toast `Esc again to clear` (key `escape-again-to-clear`, `timeoutMs: 1000`), second
press pushes the buffer to history and clears it (**623430**). Dialogs opt out with `disableEscapeDoublePress: true`
(**164362**, **384302**, **594718**).

Other verbatim ESC hints:

| String | Line |
|---|---|
| ` · next try in ${d} · attempt ${n} · esc to interrupt` (API-retry countdown) | 77762 |
| `Claude is using your computer · press Esc to stop` / `… press Ctrl+C to stop` | 97100 |
| `Claude Code will continue automatically ${when}. Keep this session open; it may still pause for permission prompts. Press esc to cancel the wait.` | 207677 |
| `Press <ctrl+x ctrl+k> again to stop background agents` | 153709 |
| `No background agents running` | 153678 |
| `Interrupted ` + `· What should Claude do instead?` (post-interrupt composer label) | 188385 |

**Not present in this build:** `Interrupted by user` and `Press Esc again` — both return zero hits.

### 4.9 Queued-input UX

| String | Meaning | Line |
|---|---|---|
| `Press up to edit queued messages, Enter to send them immediately` | placeholder when the queue is non-empty and the `tengu_jiggly_mochi` gate is on (`EL()`, 159418) | 159431 |
| `Press up to edit queued messages` | same without the gate; shown at most `jKe = 3` times | 159433 (`jKe` at 159420) |
| `Clear the input to edit this queued shell command` | up-arrow onto a queued `!bash` command with a non-empty draft | 159834 |
| `Message queued for the main conversation's next turn.` | `SendMessage` tool result, `priority:"next"` | 6381 |
| `Message queued for delivery to <agent> at its next tool round.` | same, to a subagent | 6384 |
| `${n} queued command(s) would be lost` / `Press ← again once the queue clears.` | left-arrow exit guard | 170217 |

Navigation: `EIe` (**159780**) walks `queueEditIndex` backwards through `getCommandQueueSnapshot().filter(yv)`;
`DIe` (**159806**) walks forward; `Jte` (**159829**) pops the selected entry via `popEditableAt(index, draft, cursor,
pasted)` (**422299**); `soe` (**160092**) pops the whole queue via `popAllEditable(...)` (**422265**), concatenating
every editable command with the current draft and re-attaching image blocks.

"Enter sends the queue now" — `x_e(S)` (**168902**) is gated on `EL()`, prompt mode, `turn.guard.isActive`, and
`WNt(queue)`; it calls `turn.interruptForSubmit` (**169915**), i.e. `abort(Su("user-cancel"))`. Telemetry
`input_send_queued_now`, `tengu_cancel {source:"queued_send_now"}`.

### 4.10 Interrupt over the control protocol

Client side, `SdkClient.interrupt(e)` (**607561**):

```js
let t = await this.request({ subtype: "interrupt", ...e?.cancelQueued === !0 && { cancel_queued: !0 } });
… return { still_queued: […], ...Array.isArray(o) && { cancelled: […] } };
```

`interrupt` is in the fire-and-forget subtype set at **182335** and the remote-control allowlist at **206468**.
Server handling (**360614**):

```js
if (d.request.subtype === "interrupt") {
  if (Qe) Qe.abort(Su("remote-cancel"));
  … stop background tasks, leave artifact rooms …
  let X = F.getCommandQueueSnapshot().filter(gu).map(u => u.uuid).filter(Boolean);
  if (d.request.cancel_queued === !0) {
    let ue = F.removeByFilter(gu, { reason: "cleared_on_cancel" });
    … onCommandLifecycle(uuid, "cancelled") per entry …
    nt(d, { still_queued: [], cancelled: [...] });
  } else nt(d, { still_queued: [...] });
}
```

Capability strings at **524054**: `interrupt_receipt_v1`, `msg_lifecycle_v1`, `interrupt_cancel_queued_v1`.

Engine-internal intent (**524722**):

```js
case "interrupt": {
  if (nt?.abort(Ie.reason !== void 0 ? new DOMException(Ie.reason, "AbortError") : void 0), Ie.scope !== "turn-cancel") {
    … stop background tasks, leave artifact rooms …
  }
  break;
}
```

`end_session` (**360639**) is the stronger form: `suspendMidTurnFold()` first, then `abort(Su("shutdown"))`, so
nothing further folds into the dying turn and every emitted marker carries `interruptedByShutdown: true`.

---

## 5. Turn limits and budgets

### 5.1 `maxTurns`

The counter lives in `Pe.turnCount`, initialised to `1` (**486438**). The check is **pre-emptive**, at the very end of
a turn (**487487**):

```js
let Wk = Yn + 1, gR = M && Wk > M ? M : void 0;      // M = maxTurns, Yn = current turnCount
...
if (gR !== void 0)
  return yield Mn({ type: "max_turns_reached", maxTurns: gR, turnCount: Wk }, pe),
         Ik(ct, A), yield* Xh(hi, [...Cn, ...Ar, ...fo], { stopHookActive: Qn }),
         { reason: "max_turns", turnCount: Wk };
```

So `--max-turns N` gives the model exactly N turns; turn N+1 is never dispatched. Two other emission sites:
**487419** (abort path — the attachment is still emitted so the caller sees why) and **487336** (Stop-hook blocking
path, telemetry `hit_max_turns: true`).

`max_turns_reached` is an **attachment**, not a result. The SDK driver converts it (**356023**) into the
`error_max_turns` result variant, whose `num_turns` comes from the attachment, not the driver's own counter.

Defaults: forked/background agents `w4n = 50` (**487954**); the built-in general agent `maxTurns: 500` (**3231**).
Agent-file `maxTurns` must be a positive integer, else `Agent file <path> has invalid maxTurns '<v>'. Must be a positive integer.` (**451141**).

### 5.2 `maxBudgetUsd`

Not enforced inside `DAt` at all — it is a **driver-level** check. `qB(limit)` (**449575**):

```js
function qB(e) { return e !== void 0 && !(ul() < e); }   // ul() = session total cost USD
```

Checked after every yielded message in the SDK driver (**356090**) and again in the REPL entry gate (**360220**,
**362216**). Tripping it produces terminal reason `budget_exhausted` and result subtype `error_max_budget_usd` with
`errors: [Yct(limit)]` (**449579**):

- normal: `Reached maximum budget ($${limit})`
- NaN cost: `Session cost is not a number (a usage or pricing fault upstream); refusing to continue under --max-budget-usd ${limit}`

`ql(...)` (**357705**) additionally stops background agents when the print-mode budget trips, writing to stderr:
`Budget limit reached ($X of $Y); stopping background agents.`

### 5.3 `taskBudget` — a *server-side* budget

`taskBudget: { total, remaining? }` rides on the request body, not the client. `t8n` (**497882**):

```js
function t8n(e, t, r) {
  if (!e || "task_budget" in t || !uw()) return;
  t.task_budget = { type: "tokens", total: e.total, ...e.remaining !== void 0 && { remaining: e.remaining } };
  if (!r.includes(r3t)) r.push(r3t);        // beta task-budgets-2026-03-13
}
```

The harness *decrements the remaining* on compaction, because compaction discards tokens the server already counted
(**486536** and **487262**):

```js
if (e.taskBudget) { let Bi = ahe(Cn); Be = Math.max(0, (Be ?? e.taskBudget.total) - Bi); }
```

and passes `{ total, remaining: Be }` on the next request (**486781**). CLI surface: `--task-budget <tokens>`
(hidden), documented as `API-side task budget in tokens (output_config.task_budget)`.

### 5.4 Effort and thinking budget

Effort levels — `Uh = ["low","medium","high","xhigh","max"]` (**232668**). Resolution (`_`, **232963**):
`max` degrades to `high` when the model lacks it; `xhigh` likewise. `il(state, model)` (**232917**) resolves
`sessionEffort` of kind `level` / `default` / `inherit`, the last consulting a per-model settings table.
`yT(model, effort, {honorLaunchPin})` (**232938**) is the accessor used at the request site (**498422**).
`e8n` (**497870**) writes `output_config.effort` and adds the `effort-2025-11-24` beta.

Thinking config resolution `KOe(ctx)` (**88541**):

```js
function KOe(e) {
  let o = e.options.thinkingConfig;
  for (let t of e.permissionLayers ?? []) if (t.kind === "max_thinking_tokens") o = y(t.maxThinkingTokens);
  return o;
}
function y(e) { return e === 0 ? { type: "disabled" } : { type: "enabled", budgetTokens: e }; }
```

so a permission layer (a skill, an agent definition, `/model` state) can override the thinking budget mid-session.
`Sf(n, display, prior)` (**363099**) is the constructor used at CLI-parse time: `null` → inherit or `{type:"adaptive"}`,
`0` → `{type:"disabled"}`, else `{type:"enabled", budgetTokens: n, display}`.

`MAX_THINKING_TOKENS` env var (**306374**, **529937**) sets the budget; `MAX_THINKING_TOKENS=0` disables thinking and
produces the diagnostic `Effort '<x>' isn't available with thinking turned off on this model · <hint>, or turn thinking back on (unset MAX_THINKING_TOKENS=0)` (**437400**).

### 5.5 `ultrathink` — no longer a token budget

This is the biggest behavioural delta from the February snapshot. In 2.1.251 the *only* magic phrase is `ultrathink`:

```js
function G8e(e) { return /\bultrathink\b/i.test(e); }                     // 306329
function IVn(e) {
  if (!UV() || !e || !G8e(e)) return [];
  return s("tengu_ultrathink", {}), [{ type: "ultrathink_effort" }];      // 492482
}
```

gated by `UV() = I("tengu_turtle_carbon", !0)` (**306326**). It produces an **attachment**, which renders (**518738**) to:

> `The user included the keyword "ultrathink", requesting deeper reasoning on this turn. Reason as thoroughly as the task warrants.`

wrapped as a `<system-reminder>`. There is **no** `think` / `think hard` / `think harder` / `megathink` tier and no
`31999`-style budget mapping anywhere in the bundle. Its sibling is `ultracode` → `workflow_keyword_request` (**492487**).

### 5.6 `max_tokens` selection

```js
function $V(e) {                                     // 306255
  let u = Ql(canonical)?.max_output_tokens;
  if (u) { t = u.default; r = u.upper; }
  else if (canonical === "claude-3-opus" || "claude-3-haiku") { t = 4096; r = 4096; }
  else if (canonical === "claude-3-sonnet") { t = 8192; r = 8192; }
  else { t = Q3; r = Z3; }                           // 306109: Q3 = 32000, Z3 = 128000
  ...
  return { default: t, upperLimit: r };
}
function oDe(e) {                                    // 499602
  let t = $V(e);
  return uee("CLAUDE_CODE_MAX_OUTPUT_TOKENS", process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, t.default, t.upperLimit).effective;
}
```

Fallback default **32000**, fallback upper limit **128000** (**306109**). Effective `max_tokens` at the request site
(**498522**): `Ia = min(sr.maxTokensOverride || options.maxOutputTokensOverride || oDe(model), oDe(model))` — the
override can only ever *lower* it. Context-window constants on the same line: `q8e = g$ = 200000`.

### 5.7 Other caps encountered in the loop

| Cap | Value | Line |
|---|---|---|
| `CAt` — max output-token / truncation recovery attempts | 3 | 486305 |
| `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | default 8; `0` disables | 487339 |
| `MAX_STRUCTURED_OUTPUT_RETRIES` (`vHe`) | 5 | 7340 |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | 10 (batch path only) | 459777 |
| tool heartbeat interval | 30000 ms | 459714 |
| `MAX_MCP_OUTPUT_TOKENS` | 25000 | 34310 |
| `TASK_MAX_OUTPUT_LENGTH` default / ceiling | 32000 / 160000 | 475949 |

Stop-hook cap message (**487339**), verbatim:

> `A hook blocked the turn from ending ${n} consecutive times — overriding and ending turn. For Stop/SubagentStop hooks, check stop_hook_active in the input and return success while it's true. Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit.`

---

## 6. Error handling and resilience

### 6.1 The retry wrapper owns everything

Every SDK client is constructed with `maxRetries: 0` (**498036**, and the Vertex/Bedrock/Mantle variants at 7604,
284325, 315960). The harness's own retry driver is `kQ` at **445990–446214** — an *async generator*, so it can yield
retry-notice messages into the transcript while it sleeps.

Constants, all declared on **445922**:

| Const | Value | Meaning |
|---|---|---|
| `cin` | 10 | default max retries |
| `uin` | 300 | max retries under `CLAUDE_CODE_RETRY_WATCHDOG` |
| `X_e` | 15 | clamp for `CLAUDE_CODE_MAX_RETRIES` outside watchdog mode |
| `bQ` | 3 | consecutive 529s before model fallback |
| `X7e` | 3000 | floor output tokens for the context-overflow shrink |
| `Kun` | 60000 | a computed delay above this aborts instead of sleeping (non-watchdog) |
| `Vun` | 300000 | per-attempt backoff cap in watchdog mode |
| `uJe` | 21600000 | absolute delay ceiling (6 h) |
| `Yun` | 30000 | watchdog sleeps are sliced into 30 s chunks so the UI repaints |

`xbe()` (**446406**) resolves the attempt budget; the loop is `for (let Be = 1; Be <= o + 1; Be++)` (**445991**), i.e.
1 initial + `o` retries. Clamp warning: `CLAUDE_CODE_MAX_RETRIES=${t} clamped to ${X_e}`.

Backoff — `kV(attempt, retryAfter, cap = 32000)` (**227981**):

```js
let t = Math.min(500 * Math.pow(2, s - 1), e),
    a = Math.round(t + Math.random() * 0.25 * t);
if (n) { let o = parseInt(n, 10); if (!isNaN(o)) return Math.max(o * 1000, a); }
return a;
```

500 ms × 2ⁿ⁻¹ capped at 32 s, with **additive** jitter of up to +25 % (never reduces the delay), and `Retry-After`
acting as a **floor**, not a replacement. The header is read by `pJe` (**446229**), tolerating both plain-object and
`Headers` shapes.

### 6.2 Retryability

`odn` (**446329–446389**), first match wins. Highlights:

- **Not retryable:** DLP denial; 429 `credits_required`; spend-cap 429s (`service_spend_limit_reached`, org spend cap,
  out of credits); `x-should-retry: false`; no status at all.
- **Retryable:** 408, 409, 401 (also invalidates the credential), revoked OAuth, ≥ 500 (covers 500/502/503/529),
  network errors, `"type":"overloaded_error"` in the body, context-overflow 400s, CCR/apiKeyHelper 401-403.
- **429 is conditional:** `!Tt() || fpe() || nJe(e)` — subscription users (`Tt()`) do **not** retry a 429 unless it
  carries no `anthropic-ratelimit-unified-overage-disabled-reason` header.

Non-retryable errors are then split (**446181**) between "try the fallback model as a last resort" and "hard fail":
`Zun = new Set([401, 407, 429, 404, 403, 413])` (**445987**) plus the predicate list `edn` (**445988**).

### 6.3 Model fallback

Two independent mechanisms.

**Server-side ("pennant").** The API serves a different model; the engine sees `{type:"server_fallback", fromModel,
toModel, reason: "refusal"|"sticky", apiRefusalCategory, midStream, discardedMessages, retainedText, …}`. Refusal
categories (**487843**):

```js
var n1n = new Set(["cyber", "bio", "frontier_llm", "reasoning_extraction"]);
```

`"cyber"` is latched across resume (`tengu_refusal_fallback_resume_latch`) and drives the mid-stream seam-merge
decision (**486836**). When the server's target is not in the org's `availableModels` allowlist the swap is declined and
the response is discarded with (**486825**):

> `The server routed this response to a model that is not in your organization’s availableModels allowlist; the response was discarded.`

**Client-side chain advance.** `GSt` (**305632**):

```js
function GSt(e, t) { if (T6()) return [e]; return [e, ...t.filter(r => r !== e)]; }
```

`T6()` is `CLAUDE_CODE_NO_MODEL_FALLBACK`. A tripwire `qSt()` (**305630**) throws if a pivot is attempted under the
guarantee. The chain is walked at **487102–487152** on catching a `jf` (`FallbackTriggeredError`, **445804**, message
`Model fallback triggered: ${a} -> ${b}`). Trigger table:

| Reason | Condition | Line |
|---|---|---|
| `model_not_found` | 404 `not_found_error` + `"model:"` | 446095 |
| `permission_denied` | 403 `permission_error` + `"model:"` | 446095 |
| `server_error` | 5xx excluding 529, non-watchdog | 446095 |
| `overloaded` | 3 consecutive 529s (`bQ`) | 446122 |
| `overloaded` (mid-stream) | 529 before any content, streaming retries exhausted | 499363 |
| `last_resort` | non-retryable, unclassified, has a status, distinct fallback exists | 446186 |
| `model_blocked` | per-model block list | 498333 |

A notable subtlety at **487124**: if the only remaining chain entry *is* the model that just failed and the failure was
transient, the harness **collapses back onto it and re-dispatches in place with a fresh retry budget**:

> `chain advance collapsed onto the failed model ${m}; re-dispatching in place with the full retry budget`

Notice text `Fjn` (**487552**):

| reason | text |
|---|---|
| `overloaded`, `server_error` | `Switched to ${fallback} due to high demand for ${original}` |
| `model_not_found`, `permission_denied`, `model_blocked` | `Switched to ${fallback} because ${original} is not available<detail>` |
| `last_resort` | `Switched to ${fallback} because ${original} returned an error that could not be retried<detail>` |

`model_blocked` has its own terminal path (**487163**): `${model} is currently unavailable.` with `error: "rate_limit"`.

### 6.4 Context overflow — two distinct paths

**(a) `max_tokens` overflow — silent shrink inside the retry loop.** `mJe` (**446232**) parses

```
/input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)/
```

and the loop (**446190**) sets `maxTokensOverride = max(0, contextLimit − inputTokens − 1000)` and `continue`s with no
sleep. Aborts if the headroom is below `X7e = 3000` or the shrink makes no progress.

**(b) `prompt_too_long` / 413 — reactive compaction.** Detection `Rb` (**436925**): the last assistant message is an
API-error message whose text starts with `fk = "Prompt is too long"` (**436924**). `Oj` (**436933**) parses
`/prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i`. The loop path (**487242–487275**):

1. rapid-refill breaker → `{reason:"rapid_refill_breaker"}` with `she` (**435818**):
   > `Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.`
2. single-exchange conversation → cannot compact; `$5e(...)` (**436947**) picks one of three tailored messages
   (see table below), returns `{reason:"prompt_too_long"}`.
3. otherwise `XRe` (precomputed-compact borrow) then `Tte` (reactive compact). `Sve` (**461000**) allows **one**
   reactive attempt per turn.
4. success → `transition.reason` = `reactive_compact_retry` / `precomputed_compact_swap`; failure → surface and return.

| Situation | Message |
|---|---|
| token counts unparseable | `Prompt is too long · this conversation is a single exchange and cannot be compacted — the request size comes mostly from system prompt, tool definitions, or attachments.` |
| conversation ≥ 80 % of request | `Prompt is too long · the request is ~${t} tokens (limit ${r}) and this conversation's own content is most of it. A single-exchange conversation cannot be compacted; start with less content (smaller files or pasted text).` |
| overhead dominates | `Prompt is too long · the request is ~${t} tokens (limit ${r}) but this conversation is only ~${o} tokens — the rest is system prompt, tool definitions, and attachment content. A single-exchange conversation cannot be compacted; reduce attached files/tools or start with less context.` |

Proactive autocompact gate `VRe` (**488800**) returns false if autocompact already ran this turn, if this is a
pre-first-compact fork, if a reactive compact was already attempted, or if the last transition was a
`precomputed_compact_swap`.

### 6.5 Error strings that matter

`_u = "API Error"` (**819189**). Selected verbatim strings, deduped to their definition site:

| String | Trigger | Line |
|---|---|---|
| `API Error: Request was aborted.` (`JR`) | request aborted | 413362 |
| `Operation stopped by hook` (`iee`) | hook stop | 413362 |
| `API Error: Claude's response exceeded the ${n} output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.` | `stop_reason: max_tokens` | 499192 |
| `The model has reached its context window limit.` | `model_context_window_exceeded` | 499193 |
| `The model's tool call could not be parsed (retry also failed).` | malformed-tool-use exhausted | 487306 |
| `API Error: 400 due to tool use concurrency issues.` (+ ` Run /rewind to recover the conversation.` interactive) | dangling `tool_use` without `tool_result` | 437434 |
| `API Error: 400 duplicate tool_use ID in conversation history.` | duplicate ids | 437442 |
| `Repeated 529 Overloaded errors` (`uX`) | 3× 529 with no fallback | 437026 |
| `Server is temporarily limiting requests (not your usage limit)` | 429 for subscription users; sets `apiErrorIsTransient` | 437381 |
| `Credit balance is too low` (`lft`) | billing | 436969 |
| `Streaming response ended before any complete data was received. Retrying without streaming. If this keeps happening, check any proxy or gateway between Claude Code and your model provider.` | `streaming_fallback_began` with `cause: "no_events"` | 486980 |

Transient classifier (**516401**): `exe(e) = e.apiErrorIsTransient === true || e.error === "overloaded" || e.error === "server_error"` —
this is what `{reason:"api_error", isTransient}` reports.

### 6.6 Abort propagation

Abort reasons are DOMException names (**742383**): `user-cancel`, `remote-cancel`, `shutdown`, `interrupt`,
`turn-abort`, `background`, `refusal-fallback-edit`, `recovery-timeout`; plus `server-fallback-tombstone` (**742406**)
and `subagent-park` (**742412**).

Propagation is a **tree of linked AbortControllers**:

- One `toolUseContext.abortController` per turn.
- `ORe.executeTool` creates a child via `w_(parent)` (**484448**), and installs the reverse edge (**484449**) so a
  child abort escalates to the parent — hence to every sibling.
- On abort the loop still drains `getRemainingResults()` so every in-flight tool emits its synthetic result
  (**487176**, **487377**), then emits the interrupt message and returns `aborted_streaming` / `aborted_tools`.
- `dG` (**480620**) classifies the abort per tool and has three carve-outs: reason `interrupt` produces **no**
  synthetic error at all; a Bash/PowerShell call that already `ran` and is being backgrounded produces none; the
  end-conversation tool is exempt from `conversation_ended`.
- On a *thrown* query error, `Pjn` (**486233**) back-fills a synthetic `is_error` `tool_result` for every `tool_use`
  that has no result yet — the already-satisfied id set is computed at **487167**.

Timeouts:

| Env var | Default | Line |
|---|---|---|
| `API_TIMEOUT_MS` (client) | 600000 | 846500 |
| `API_TIMEOUT_MS` (dispatch) | 300000; 120000 under `CLAUDE_CODE_REMOTE` | 498003 |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | floor 300000 | 846665 |
| `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS` | firstParty 180000, clamped `[1e4, 1800000]` | 846668 |
| `MCP_TIMEOUT` / `MCP_CONNECT_TIMEOUT_MS` | 30000 / 5000 | 814975 / 814980 |
| `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS` | 120000 / 600000 | 413444 / 413453 |

Non-streaming fallback on a stream error can be disabled by `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK` or the
`tengu_disable_streaming_to_non_streaming_fallback` gate (**499286**).

---

## 7. Output modes plumbing

### 7.1 The flags

Defined in one chained commander expression starting at **748394** (hidden ones continue at **748437**).

| Flag | Values / default | Line |
|---|---|---|
| `-p, --print` | boolean | 748394 |
| `--output-format <format>` | `text \| json \| stream-json`; no commander default, coerced to `"text"` at 529951 | 748394 |
| `--input-format <format>` | `text \| stream-json`; coerced to `"text"` at 529961 | 748394 |
| `--verbose` | boolean | 748394 |
| `--include-partial-messages` | boolean; requires `--print` + stream-json | 748394 |
| `--include-hook-events` | boolean; requires stream-json | 748394 |
| `--forward-subagent-text` | boolean | 748394 |
| `--replay-user-messages` | boolean; requires **both** formats be stream-json | 748404 |
| `--json-schema <schema>` | the structured-output flag (**there is no `--structured-output`**) | 748394 |
| `--max-turns <turns>` | hidden; `--print` only | 748394 |
| `--max-budget-usd <amount>` | must be > 0 | 748394 |
| `--task-budget <tokens>` | hidden; `output_config.task_budget` | ~748412 |
| `--session-mirror` | hidden; emits `transcript_mirror` frames | 748394 |
| `--sdk-url <url>` | hidden; WebSocket SDK I/O | 748437 |
| `--thinking <mode>` | `enabled \| adaptive \| disabled`, hidden | 748394 |
| `--thinking-display <display>` | `summarized \| omitted`, hidden | 748394 |

Validation gates:

| Rule | Line | Message |
|---|---|---|
| stream-json output **requires** `--verbose` | 358319 | `Error: When using --print, --output-format=stream-json requires --verbose` then `exit(1)` |
| `--replay-user-messages` requires both formats stream-json | 529639 | `Error: --replay-user-messages requires both --input-format=stream-json and --output-format=stream-json.` |
| `--include-partial-messages` requires `--print` + stream-json | 529648 | `Error: --include-partial-messages requires --print and --output-format=stream-json.` |
| `--prompt-suggestions` requires `--print` + stream-json | 529644 | `Error: --prompt-suggestions requires --print and --output-format=stream-json (prompt_suggestion messages are only surfaced in stream-json output).` |
| `--environment` forbids stream-json | 527697 | `Error: --environment does not support --output-format stream-json` |

The bundled TypeScript SDK spawns the CLI with a fixed prefix (**606853**):

```js
let M = ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json"];
```

then conditionally appends `--thinking`, `--max-thinking-tokens`, `--effort`, `--max-turns`, `--max-budget-usd`,
`--task-budget`, `--model`, `--json-schema`, `--permission-prompt-tool stdio`, `--fallback-model`,
`--include-hook-events`, `--include-partial-messages`, `--session-mirror`, … (606850–606945).

### 7.2 One engine, three serializations

`runHeadless` (**358127**) iterates the *same* generator for all three formats; the format only changes what happens
per message (**358394–358427**):

- `mf(e)` (**358089**) = `system`/`informational`; these are **buffered until `system`/`init` has been emitted**, then
  flushed. A parity implementation that emits them eagerly reorders the stream.
- `ay(e)` (**358093**) is the SDK-visibility filter, excluding `control_response`, `control_request`,
  `control_cancel_request`, `stream_event`, `keep_alive`, `prompt_suggestion`, `conversation_reset`,
  `transcript_mirror`, `command_lifecycle`, `active_goal`, `autocompact_state`, plus ~24 `system` subtypes.

Final switch (**358428–358471**):

| Format | Behaviour |
|---|---|
| `json` | with `--verbose`, `stdout(JSON.stringify(allMessages))`; without, `stdout(JSON.stringify(lastResult))`. No result → stderr `Error: No messages returned from query`, exit 1 |
| `stream-json` | **nothing extra** — every message was already written line-by-line inside the loop |
| `text` | prints `result.result`, or one of `Execution error` / `Error: Reached max turns (N)` / `Error: Exceeded USD budget (X)` / `Error: Failed to provide valid structured output after maximum retries` |

Exit code (**358487**): `1` when the result `is_error` or the transport closed permanently, else `0`.
Framing (**522218**): `write(t) { er(JSON.stringify(t) + "\n") }` — one JSON object per line on stdout.

### 7.3 `system`/`init` and `result` envelopes

`init` — `Gve(S)` at **524073**. Ordered fields: `type`, `subtype`, `cwd`, `session_id`, `tools[]`, `mcp_servers[]`,
`model`, `permissionMode`, `slash_commands[]`, `terminal_slash_commands[]?`, `apiKeySource`, `betas?`,
`claude_code_version` (literal `"2.1.251"` inlined), `output_style`, `agents[]`, `skills[]`, `plugins[]`,
`plugin_errors[]?`, `plugin_warnings[]?`, `capabilities[]?`, `mcp_server_errors[]?`, `analytics_disabled`,
`product_feedback_disabled`, `uuid`, then conditionally `memory_paths`, `worker_epoch`, `messaging_socket_path`,
`fast_mode_state`, `fast_mode_disabled_reason`, `footer_indicator`, `effort`, `powershell_path`.

Note the deliberate case mix: `permissionMode`, `apiKeySource`, `betas`, `modelUsage` are camelCase inside otherwise
snake_case envelopes.

`result` — `KC({startedAt, common, variant})` at **523519**:

```js
{ ...common, ...variant, type: "result", duration_ms, uuid }
```

`common` (**524681**): `duration_api_ms`, `stop_reason`, `session_id`, `total_cost_usd`, `usage` (the `gp` shape from
**205706**), `modelUsage`, `permission_denials`, `terminal_reason` (one of `Zw`), `fast_mode_state`,
`fast_mode_disabled_reason`, `origin`, `subagent_stats`, `is_error`, `num_turns`.

| `subtype` | Extra fields | Selected when |
|---|---|---|
| `success` | `api_error_status`, `result`, `structured_output`, `ttft_ms`, `ttft_stream_ms`, `time_to_request_ms`, `deferred_tool_use` | default |
| `error_max_turns` | `errors: ["Reached maximum number of turns (N)"]`; `num_turns` from the attachment | `max_turns_reached` attachment seen |
| `error_max_budget_usd` | `errors: [Yct(limit)]`; `terminal_reason: "budget_exhausted"` | `qB(maxBudgetUsd)` |
| `error_during_execution` | `errors: [...]` | last message isn't a clean terminal |
| `error_max_structured_output_retries` | `errors: [...]` | retraction exhausted (356142, 356445) |

`num_turns` is **not** one counter: it is the driver's own increment for most variants, but the attachment's
`turnCount` for `error_max_turns`.

### 7.4 Streaming-input / control protocol

Input framing (**521862**): the transport `read()` accumulates a string buffer, splits on `\n`, and dispatches per line
via `processLine` (**522047**). Accepted inbound types: `user`, `bash_command`, `control_request`,
`control_cancel_request`, `assistant`, `system`, `queued_notification`, `session_notice`, `workflow_launch`,
plus `keep_alive` (dropped), `update_environment_variables`, and `control_response`. Anything else logs
`Ignoring unknown message type: <t>`.

Control envelopes:

```js
function gK(t, e) { return { type:"control_response", response:{ subtype:"success", request_id:t, response:e } }; }  // 522609
function $U(t, e) { return { type:"control_response", response:{ subtype:"error",   request_id:t, error:e   } }; }  // 522612
// outbound: { type: "control_request", request_id, request }                                                        // 522227
// cancel:   { type: "control_cancel_request", request_id }                                                          // 522023
```

`can_use_tool` payload (**171477**): `{ subtype:"can_use_tool", tool_name, display_name, input, tool_use_id,
description, permission_suggestions?, blocked_paths? }`. Subtype partition (**182335**): fire-and-forget
(`interrupt`, `stop_task`, `set_permission_mode`, `set_model`, `set_max_thinking_tokens`, `set_color`, `mcp_toggle`,
`message_rated`) vs host-answered (`can_use_tool`, `request_user_dialog`, `elicitation`).

`stream_event` reaches the wire only with `--include-partial-messages`; shape `Gi` (**355407**):

```js
{ type:"stream_event", event, session_id, parent_tool_use_id: null, uuid, ...(ttftMs !== undefined && { ttft_ms }) }
```

When a partial message is retracted mid-stream, the transport **fabricates a close**: `pl(index)` emits a synthetic
`content_block_stop` (**355411**) and `Js(...)` a synthetic `message_delta` + `message_stop` pair (**355413**),
telemetry `tengu_partial_stream_retraction_closed`.

### 7.5 Structured output

`--json-schema` compiles at **529759**; the compiler `B(e)` (**74975**) rejects oversized schemas (node budget 1e5,
depth 1e4), validates with Ajv, derives a strict variant, and returns a synthetic `StructuredOutput` tool (**74930**):
`isReadOnly() → true`, `maxResultSizeChars: 1e5`, prompt *"Use this tool to return your final response in the
requested structured format. You MUST call this tool exactly once at the end of your response…"*, `call` returns
`{ data: "Structured output provided successfully", structured_output: e, endsTurn: true }`. Mismatch throws
`Output does not match required schema: <path: message, …>` (**74994**).

The result becomes a `structured_output` **attachment** (**481241**); the driver collects them, evicts them when the
producing `tool_use` is tombstoned (`tengu_structured_output_late_retraction_drop`), and after
`MAX_STRUCTURED_OUTPUT_RETRIES` ends the run as `error_max_structured_output_retries`.

---

## 8. The message data model

### 8.1 The transcript record

Written at **417523**:

```js
let ge = { parentUuid: fe ? null : pe, logicalParentUuid: fe ? M : void 0,
           isSidechain: t, teamName, agentName,
           promptId: me.type === "user" ? $J() ?? void 0 : void 0, agentId: r,
           ...me,                                       // the message itself
           sessionKind: v6(), userType: bcn(), entrypoint: XBe(), cwd: ee(),
           sessionId: B, version: oVt, gitBranch: U, slug: W };
if (ge.type === "user" && ge.toolUseResult != null) ge.toolUseResult = EHe(ge.toolUseResult);
```

| Field | Notes |
|---|---|
| `parentUuid` | `null` at a compact boundary; can be redirected to `sourceToolAssistantUUID` for tool-result users (417513), guarded by `tengu_phantom_parent_write`; self-reference fires `tengu_chain_self_reference_write` |
| `logicalParentUuid` | only at a compact boundary — the pre-compaction parent |
| `isSidechain` | true for sub-agent (Task) transcripts |
| `userType` | **hardcoded `"external"`** — `function bcn() { return "external"; }` (**416249**) |
| `entrypoint` | `process.env.CLAUDE_CODE_ENTRYPOINT` (**416252**) |
| `version` | `"2.1.251"` (**415993**) |
| `toolUseResult` | user records only, sanitised by `EHe` before write |

Compact-boundary predicate (**519249**):

```js
function Du(e)  { return e?.type === "system" && e.subtype === "compact_boundary"; }
function mbe(e) { return Du(e) || e.type === "user" && e.isCompactSummary === !0; }
```

Other record kinds sharing the JSONL: `atis-latch` (**417510**), `file-history-snapshot` (**417541**),
`attribution-snapshot`. The byte-level fast scanner keys off literal prefixes `{"parentUuid":`, `"uuid":"`,
`"isSidechain":true`, `","timestamp":"` (**420182**, **420301**).

Flags observed on user records: `isMeta`, `isCompactSummary`, `isVirtual`, `isReplay`, `isSynthetic`, `ephemeral`,
`turnCompanion`, `interruptedMessageId`, `interruptedByShutdown`, `toolDenialKind`, `userFeedback`,
`sourceToolAssistantUUID`, `replacesSpan`, `supersedesUuids`, `promptSource`, `origin`. The constructor is `xe(...)`
at **516565–516585** (the returned object literal is at **516584**).

### 8.2 The internal `type` union

The classifier `H0e` (**413113**) is the definitive split:

| Class | Types |
|---|---|
| **Persisted / conversational** (`false`) | `user`, `assistant`, `attachment`, `progress`, `system` |
| **Transient / control** (`true`) | `tombstone`, `tool_use_summary`, `notification`, `set_expanded_view`, `post_turn_summary`, `active_goal`, `set_in_progress_tool_use_ids`, `conversation_reset`, `hint_clears`, `api_metrics`, `os_notification`, `open_message_selector`, `apply_flag_settings`, `command_lifecycle`, `refusal_continuation`, `query_model_change` |
| **Streaming control** (`AR`, `wqt`) | `stream_event`, `stream_request_start`, `response_length`, `compact_progress`, `sdk_status`, `stream_mode` (**413059** + **413107**) |

Additional in-band engine events yielded by `DAt` that never leave the engine: `server_fallback`,
`refusal_no_fallback`, `fallback_request`, `streaming_fallback_began`, `tool_drain_tick`.

Constructors:

| Type | Shape | Line |
|---|---|---|
| `attachment` | `{ type:"attachment", attachment, uuid, timestamp }` | 483992 |
| `progress` | `{ type:"progress", data, toolUseID, parentToolUseID, uuid, timestamp }` (`mGe`) | 516607 |
| `tool_use_summary` | `{ type:"tool_use_summary", summary, precedingToolUseIds, uuid, timestamp }` | 519622 |
| `system` (api_error) | `{ type:"system", subtype:"api_error", level:"error", error, retryInMs, retryAttempt, maxRetries, source, timestamp, uuid }` | 519247 |
| `system` (turn_duration) | `{ type:"system", subtype:"turn_duration", durationMs, budgetTokens, budgetLimit, budgetNudges, messageCount, pendingBackgroundAgentCount, pendingWorkflowCount, … }` | 519228 |

### 8.3 Attachments

The full subtype set is enumerated in `ec` at **354128** (84 entries) with a shorter operational list at **16262**
(`Sd`). Notable members for this domain: `max_turns_reached`, `poll_events`, `queued_command`, `structured_output`,
`hook_deferred_tool`, `hook_stopped_continuation`, `hook_additional_context`, `ultrathink_effort`,
`workflow_keyword_request`, `batching_reminder` / `batching_reminder_sent`, `secondary_reminder` /
`secondary_reminder_sent`, `session_context`, `date`, `date_change`, `dir_sync_notice`, `read_truncation_notice`,
`token_usage`, `output_token_usage`, `total_tokens_reminder`, `attention_budget`, `budget_usd`.

### 8.4 Normalization to API wire form

There is **no** `normalizeMessages` symbol. The chain is:

```
internal messages
  → P8n(e, t)      (498266)   MIt (foreign-thinking strip) → RE(...) → OIt / advisor strip / media cap
  → onWireMessagesBuilt(...)  (498596)   caller-visible observability hook, deep-cloned first
  → L8n(LIt(mn, ...), ...)    (498604)   cache-control breakpoints + final body
```

`RE(e, tools, model, opts)` (**517325**) is the collapser. Its per-type behaviour (**517452–517577**):

| Case | Behaviour |
|---|---|
| `W_(msg)` | dropped wholesale (the transient classes) |
| `progress` | **dropped** |
| `system` | kept only if `eBt(msg)`; converted to a user message and merged into the preceding user message via `Uce` |
| `user` | task-notification origins rewrapped; plain string content wrapped by `umn(...)` (the hardened `<system-reminder>` wrapper) |
| `assistant` | tool_use / thinking reconciliation |
| `attachment` | rendered by `Pie(attachment)` then either hoisted into a separate reminder list or merged into the trailing user message |

**`isMeta` is not dropped — it is created.** Synthesised messages are emitted as `xe({content, isMeta: true})` and
`isMeta` then acts as a *skip* marker when walking backwards for a tool-result carrier (**517520**) and controls uuid
inheritance during merge (**517661**: `uuid: e.isMeta ? t.uuid : e.uuid`).

**Attachments become `<system-reminder>` text.** Three pieces:

```js
function hl(e) { return `<system-reminder>\n${e}\n</system-reminder>`; }        // 518353
function U$e(e) { /* inverse regex */ }                                        // 518358
function hs(e) { /* map every string content and every text block through hl */ } // 518426
function Pie(e, t) { if (e.type in Gzt) return Gzt[e.type](e); switch (e.type) { … } } // 518747
```

`Gzt` (**518610**) is the renderer table, `attachment.type → (attachment) => Message[]`. Some entries render as
**synthetic tool_use + tool_result pairs** rather than text — e.g. `directory` becomes a fake `Bash ls` call, `file`
becomes a fake `Read` call (**518784**).

The `userContext` map is prepended as its own `<system-reminder>` by `HAt` (**497275**), verbatim:

```
<system-reminder>
As you answer the user's questions, you can use the following context:
# <key>
<value>

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
```

`umn` (**74703**) is the hardened wrapper used for *untrusted* content: it escapes nested `</system-reminder>` closers
(`D6t`, **74697**) and is idempotent.

**Tool pairing is repaired, not reordered.** The assistant side moves all `tool_use` blocks to the end
(`cGt`, **517629**, skipped when a thinking block interleaves them — `tengu_reorder_tool_uses_skipped_for_thinking`);
the user side hoists all `tool_result` blocks to the front (`dGt`, **517707**). A repair pass diffs the two id sets and
injects `{type:"tool_result", content: "[Tool result missing due to internal error]", is_error: true}` (`nur`,
**516344**) for missing results, drops extras, and replaces orphaned `tool_use` blocks with `[Tool use removed]` /
`[Tool use interrupted]` (**519659**, **519661**). Telemetry `tengu_tool_result_pairing_repaired`; under a strict gate
it throws instead:

> `ensureToolResultPairing: tool_use/tool_result pairing mismatch detected (strict mode). Refusing to repair — would inject synthetic placeholders into model context. Message structure: …. See inc-4977.` (**519726**)


---

### Deltas vs the February parity rows

The February tables (`docs/parity/03-query-engine.md`, `docs/parity/04-turn-pipeline.md`) were written from an older
snapshot and describe the *SDK's* surface. Read against the 2.1.251 binary, these rows need amending. Every delta
below is anchored to a line read in this report.

| Row | February claim | 2.1.251 reality |
|---|---|---|
| **03.1** multi-turn loop | "each yielded SDKMessage is the equivalent of CC's normalized stream" | Not equivalent. The engine yields **22 event types the SDK never sees** (`H0e`, **413113**): `tombstone`, `refusal_continuation`, `query_model_change`, `hint_clears`, `set_in_progress_tool_use_ids`, `api_metrics`, `command_lifecycle`, `tool_drain_tick`, `server_fallback`, `fallback_request`, `refusal_no_fallback`, `streaming_fallback_began`, … The SDK translator `cu` (**355545**) is a lossy projection, not a rename. |
| **03.2** streaming | "SDK still streams internally and yields complete assistant messages" | CC yields **one complete assistant message per content block** at `content_block_stop` (**499122**), then retro-patches `usage`/`stop_reason` onto all of them at `message_delta` (**499166**). A consumer that assumes one assistant message per API response will mis-count. |
| **03.3** retry | "Retries are built into the SDK; retry count/backoff is internal and not separately configurable" | Both are configurable **from the environment**: `CLAUDE_CODE_MAX_RETRIES` (clamped to 15, or 300 under `CLAUDE_CODE_RETRY_WATCHDOG`), `xbe()` at **446406**; backoff `kV` at **227981** (500 ms × 2ⁿ, cap 32 s, +25 % jitter, `Retry-After` as a floor). The Anthropic SDK's own retry is **disabled** (`maxRetries: 0`, **498036**). |
| **03.5** result subtypes | four error subtypes + success | Correct, but `terminal_reason` is a **separate, 19-value** field (`Zw`, **306736**) that carries far more information than the subtype. Parity work should surface `terminal_reason`, not just the subtype. |
| **03.7** maxTurns | "the SDK terminates with error_max_turns on overrun" | The check is **pre-emptive** (**487487**): turn N+1 is never dispatched. `num_turns` on the result comes from the `max_turns_reached` **attachment** (**356023**), not the driver's counter. |
| **03.9** taskBudget | "`Options.taskBudget: { total }`" | The harness also tracks and sends `remaining`, decrementing it on every compaction (**486536**, **487262**), and adds the `task-budgets-2026-03-13` beta (`t8n`, **497882**). A `total`-only implementation over-reports budget after a compact. |
| **03.10** thinking/effort | "`Options.thinking` + `Options.effort`; defaults adaptive/high" | Confirmed for effort (`Uh = ["low","medium","high","xhigh","max"]`, **232668**). But **`ultrathink` is no longer a thinking-token trigger** — it produces a `ultrathink_effort` attachment rendering to a `<system-reminder>` (**492482**, **518738**). There is no `think` / `think hard` / `megathink` tier anywhere in the bundle. Budget clamp is `[1024, max_tokens − 1]` (**498522**). |
| **03.12** fallbackModel | "the SDK switches automatically on overload" | Two mechanisms, not one: server-side refusal fallback (`server_fallback` blocks, categories `cyber/bio/frontier_llm/reasoning_extraction`, **487843**) and client-side chain advance (**487102**). The chain-advance path has a **collapse-onto-the-failed-model** branch (**487124**) that re-dispatches in place with a fresh retry budget. `CLAUDE_CODE_NO_MODEL_FALLBACK` collapses the chain to `[primary]` with a throwing tripwire (**305630**). |
| **03.13** interrupt | "abort streaming and tool execution as CC does" | Understated. There are **eight** distinct abort reasons (**742382**) and two of them behave differently in two places: `SV()` (**742394**) and `dG()` (**480620**) both special-case `interrupt` so that **silent steering produces no interruption marker and no synthetic tool_result**, while `user-cancel` produces both. Collapsing them breaks either steering or ESC. |
| **04.2** concurrency | "Concurrency batching … internal to the SDK agent loop" | There are **two** schedulers. The live one (`ORe`, **484328**) is **uncapped** and starts a tool the moment its content block closes — before the assistant message finishes. The capped one (`jTe`, **459780**, `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY ?? 10`) is only reached from two replay paths (**460251**, **460329**). Result ordering within a safe batch is **completion order**, not `tool_use` order. |
| **04.6** synthetic results | "internal harness behavior the SDK reproduces" | Worth spelling out: the wrapper is `hl(e)` = `` `<system-reminder>\n${e}\n</system-reminder>` `` (**518353**), with a hardened, idempotent, closer-escaping variant `umn` for untrusted content (**74703**). `isMeta` messages are **not dropped** — they are merged into the adjacent real user turn (**517457**). Only `progress` and `W_()`-matching types are truly dropped (**517453**). |
| **04.7** tool-result budgeting | "Not separately configurable per-tool from the SDK" | Per-tool caps do exist in the binary: Bash `maxResultSizeChars: 30000` (**515841**), `MAX_MCP_OUTPUT_TOKENS` 25000 (**34310**), `TASK_MAX_OUTPUT_LENGTH` 32000 / ceiling 160000 (**475949**). |
| **04.8** overflow recovery | "ANT-gated paths" | Not ANT-gated. Two distinct, always-on mechanisms: a silent in-retry-loop `max_tokens` shrink (**446190**, floor 3000) and reactive compaction on `prompt_too_long` (**487242**), with a rapid-refill breaker (**435818**) and three tailored "cannot be compacted" messages (**436947**). Plus two nudge-and-retry loops capped at `CAt = 3` (**486305**). |
| **04.10** queued-command drain | "the SDK drains them across turns" | Across turns **and within** a turn. The mid-turn fold (**487487**) injects queued text as a `queued_command` attachment into the *same* user turn as the tool results, wrapped with `The user sent a new message while you were working:` (**519795**). Slash commands are explicitly excluded from mid-turn fold (**421885**), and at most one `prompt`-mode command is admitted per fold (**487602**). |

Two rows hold up unchanged: **03.4** (`system/init`) — the field list at **524073** matches — and **03.8**
(structured output), though the flag is `--json-schema`, not `--structured-output`, and the retry cap is
`MAX_STRUCTURED_OUTPUT_RETRIES = 5` (**7340**).

### Open questions

Things this pass did not resolve, ordered by how much they would change a re-implementation.

1. **`_8e` / `fL` — the Bash read-only classifier.** Bash's `isConcurrencySafe` delegates to `isReadOnly`, which is
   `_8e(input, fL(command)).behavior === "allow"` (**515851**). That command classifier is the single decision that
   determines whether shell calls run in parallel; it was not decompiled here.
2. **`MYe` — the autocompact threshold arithmetic.** `VRe` (**488800**) gates on it, and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
   / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `CLAUDE_CODE_MAX_CONTEXT_TOKENS` feed it, but the actual fraction was not read.
3. **`hHn()` — the strict tool-pairing gate** (**519726**). Under it, a `tool_use`/`tool_result` mismatch **throws**
   instead of being repaired. What enables it (env var? gate? ANT-only?) is unknown.
4. **`pause_turn`.** It is in the canonical `stop_reason` set (**413194**) but the string appears nowhere else in the
   bundle — no handler, no branch. Either dead type-space or handled generically by falling through to `end_turn`.
   Worth a live probe.
5. **`Su`/`Za` call-graph completeness.** Eight abort reasons are declared (**742382**); this pass traced seven to a
   raiser. `recovery-timeout` was not located.
6. **`e8n` effort vs `qI` per-turn control.** `per-turn-control-2026-07-01` (`qI`) is filtered by a sticky-beta latch
   (**498429**) but its request-side payload was not read; the relationship between session `effort` and per-turn
   effort overrides is unclear.
7. **Ordering guarantee under `getCompletedResults`.** The code demonstrably yields safe-batch results in completion
   order (**484483**), and the wire normalizer hoists all `tool_result`s to the front of the merged user message
   (**517707**). Whether the API cares about `tool_result` order relative to `tool_use` order is a live-probe question,
   not a bundle question — but if it does, this is a real divergence risk for a re-implementation that sorts.
8. **`jTe`'s remaining role.** It is reached only from the deferred-tool resume and orphaned-permission replay paths.
   Whether it is genuinely legacy or a deliberate "replay must be deterministic, so cap concurrency" choice is
   INFERRED either way.
