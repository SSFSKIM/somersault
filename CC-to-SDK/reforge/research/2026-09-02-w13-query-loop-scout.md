# W13 query-loop scout — the turn driver, the nine deferrals, the inversion seam, and the cut for C16 (pin 2.1.251)

Scope: C16 / W13 — `subsystem/query-loop` plus everything nine earlier waves deferred into it: the
compaction drivers, the segment-compaction producer, the resume loop half, the headless dispatch,
the API transport and streaming assembler, the tool-use loop, the frames the stream carries, the
process lifecycle, and the model-switch pair. Also the **inversion milestone** (§2.4) and the
**§3.6 hermetic isolation substrate**, both of which the campaign scheduled here. READ-ONLY: no
build, no gate, no recording, no scenario was run; nothing outside this file was written. A
concurrent worker (C10.6) holds `reforge/strangle/*`, the hooks oracle, `ledger.json` and
`attestation/` — all of those were read, never written, and their working-tree state is noted in
§7.

Method: TypeScript-parser spans over `chunk-fy12d89p.js` (10,446 top-level declarations),
`chunk-dvbbv89q.js` (419), `chunk-g461tywa.js` (681), `chunk-38213y7h.js` (852),
`chunk-9gqmx4zx.js` (32), `chunk-29shcjw2.js`; a per-class member walk recording private-vs-public
status for every member; an owner map from byte offset → enclosing top-level declaration, used to
attribute every literal hit to a function rather than to a chunk; `import{…}from` graph walks over
the 2,074-file module set for importer counts; the single `export{…}` statement of each chunk
parsed into an alias map; and offset→pretty-line mapping through `cli.pretty.js` lines
411,873–520,034 so this document can speak the census's `@Nk` dialect. Three bounded measurement
sub-agents covered the repo side (isolation substrate, dual-wiring/engine-ts, corpus/grading) in
parallel; their numbers are reproduced here with their own methods named. Scratch scripts in
`/tmp/w13/`.

Grounding: campaign spec §1.1/§1.2/§2.1/§2.3/§2.4/§3.1/§3.2/§3.3/§3.4/§3.6/§6-W13, the C16 child
section and the C7 charter-widening Revision Note; `reforge/research/2026-09-02-w8-moat-tools-scout.md`,
`…-w9-session-storage-scout.md`, `…-w10-bash-executor-scout.md`, `…-w11-mcp-slash-skills-scout.md`,
`…-w75-hook-executor-design.md`, `…-w75-segment-compaction-reachability.md`,
`2026-09-01-w5-w7-anchor-scout.md` (both supersession banners), `2026-09-02-w7-control-subtype-matrix.md`,
`2026-08-31-engine-census.md`; `reforge/ledger.json`; `reforge/strangle/manifest.ts`;
`research/fixtures/symbol-map-2.1.251.json`, `gate-defaults-2.1.251.json`; `docs/parity/`.

---

## 0. Eleven corrections, before anything is budgeted

**1. The census locator `@75–80k` is right about the turn driver and wrong about the wave.** The
turn driver `DAt` really does start at chunk-relative pretty line **74,528** and the compaction
drivers sit at **77.3–77.8k**, so the census's window covers them. But it covers nothing else W13
owns. The **API transport and streaming assembler** is at **@85.3–88.2k** (`Eie` 85,260 · `sX`
86,103 · `XN` 86,117 · `EIt` 86,158 · `HIt` 86,447 · `S2` 87,677); the **retry driver** `kQ` is at
**@34.1k**; the **reactive compaction driver** `Tte` is at **@49.1k**; the **shutdown coordinator**
`TWn` is at **@3.1k**. The row's real footprint in the engine chunk is five disjoint regions, not
one 5,000-line window.

**2. The query loop's cross-turn state is not in the generator. It is in a 94 KB chunk with 895
importers.** `chunk-38213y7h.js` (94,444 B, 548 exports, 482 self-declared semantic names, **895
importers bundle-wide**) holds **105** loop-state accessors: the cost/usage ledger (45 names:
`getTotalCostUSD`, `getTotalCacheReadInputTokens`, `getTurnOutputTokens`, `snapshotOutputTokensForTurn`,
`claimCostLedgerForCurrentSession`, …), the main-loop model and effort state (13:
`getMainLoopModelOverride`, `setMainLoopBusy`, `pinPerTurnEffort`, …), the **refusal-fallback latch**
(12: `latchRefusalFallbackModel`, `getRefusalFallbackLatchOriginRequestId`,
`rewriteRefusalFallbackPreviousOverride`, …), the loop tick/wake/chain (12), the last-API-request memo
(10), the prompt-cache allowlist and TTL (8), and the post-compaction latch (5). §1.1's
"module-level (long async generator)" reads as *the generator holds the state*; it does not. The
state is in the same class of chunk W9 excluded as "500-importer infrastructure", which means
**W13 cannot own it as a chunk — every one of those 105 accessors is a port member or an owned
constant.**

**3. Upstream already has the inversion seam, and it is a named parameter.** All three surfaces
that run a turn construct the session object by passing the query loop *in*:
`zve({run: Kx, queryParams, …})` — the REPL builder in `chunk-g461tywa.js`, `jH` in
`chunk-6thm48px.js`, and the headless `bu` in `chunk-dvbbv89q.js` (offset 106,104). `zve` is
23,757 B and lives in `g461tywa`; `Kx` is the exported query entry in the engine chunk. **The port
W13 must present is `zve`'s `run` argument**, not a port the campaign invents. This is the single
most consequential structural fact in this document, and no prior scout has it.

**4. The headless turn entry is a two-way GATE FORK, and the corpus drives the legacy side.**
Inside `ky`, `let Wn = Im()` selects between two turn entries, and the engine logs which one it
picked in words: `"[print] turns run on the engine session (createHeadlessSession)"` versus
`"[print] turns run on legacy per-turn ask()"`. `Im()` is
`function Im(){let e=a.CLAUDE_CODE_PRINT_ENGINE_LOOP; if(e!==void 0) return e; return I("tengu_print_engine_loop",!1)}`.
The gate's committed default is **`{"default": false, "sites": 1}`**, and
`CLAUDE_CODE_PRINT_ENGINE_LOOP` is **not in reforge's env allowlist** (`src/env.ts`
`HARNESS_SET_VARS`/`PLATFORM_PASSTHROUGH`/`CREDENTIAL_VARS`), so under X6 it cannot be set. Therefore
**`bu` (`createHeadlessSession`, 15,648 B) and the `zve` session factory it builds are gate-dead at
this pin**, and everything the corpus has ever recorded went through `ku` → `new hu(...)` →
`Kx(...)`. The guard is citable in one line and it is a *flip-liveness* candidate of exactly the
class §3.3 asks for: flipping one allowlisted variable swaps which of two turn drivers runs.

**5. The gate-defaults fixture cannot see this class of override.** Zero of the 439 gates in
`research/fixtures/gate-defaults-2.1.251.json` record a `CLAUDE_CODE_*` env override, because the
extractor reads the gate call site and `Im`'s override is read **before** the call. This is the same
shape as W11's `MCP_SDK_GENERATION` finding (an env var consulted ahead of `tengu_brindle_causeway`)
and W0's `CLAUDE_CODE_LUMINOUS_WHISTLE`. Generalising: **a gate-default fixture that reads call
sites measures the gate, not the decision.** The env-override inventory §3.3 asks to regenerate per
pin bump is a *separate* extraction from the defaults table, and today only the latter exists.

**6. `zRe` is not called anywhere — it is injected.** `function aAt(){return{callModel:XN,
autocompact:zRe,uuid:gjn,now:()=>new Date().toISOString()}}` (94 B) is the loop's **default deps
factory**, and `DAt` opens with `let pe = e.deps ?? aAt()`. The compaction driver, the model
transport, the clock and the uuid source are already four injected members with a declared default.
The campaign has been treating `ModelTransportPort` as something to design; upstream ships its
shape.

**7. Every load-bearing symbol in the query loop is unnamed, and the module boundary is four
exports wide.** `chunk-fy12d89p.js` re-exports 831 semantic names about itself; **`DAt`, `HIt`,
`XN`, `zRe`, `Tte`, `nKn`, `yxe`, `aAt` and `XCt` are none of them**, and `DAt`/`HIt`/`XN`/`zRe`/
`Tte`/`nKn`/`aAt` are not in the chunk's 2,591-name `export{…}` statement at all. What crosses the
module boundary is exactly `Kx` (the query entry), `sX` (the one-shot model call), `E4n` and `wFt`
(compaction producers), and `mdt`/`gdt`. **That four-symbol surface is the S-module cut**, and it is
narrower than any S-module surface the campaign has met.

**8. `Kx` has three importers and exactly one call site.** `chunk-6thm48px.js` and
`chunk-g461tywa.js` import `Kx` and never call it — they pass it as `zve`'s `run`. The only literal
`Kx(...)` invocation bundle-wide is at offset 90,188 of `chunk-dvbbv89q.js`, inside
`hu.submitMessage`. So the headless seam the harness grades through reaches the turn driver by one
edge.

**9. The classes in W13's territory have zero private fields — the W10 blocker does not recur.**
`hu` (20,624 B, the headless turn holder): 24 members, 0 private, `submitMessage` a 19,056 B async
generator. `ORe` (6,837 B, the streaming tool executor): 27 members, 0 private. `TWn` (8,919 B, the
ShutdownCoordinator): 44 members, 0 private. `qvt` (the model-switch decision holder):
`{pending=[]; landedOn=null; inFlight=new Set}`, 3 public fields. Every stateful core W13 must own
is marshalable.

**10. The `stream:false` retry has two arms, not one, and the corpus already records the wrong
one.** `HIt` calls `EIt` (2,186 B, `M.beta.messages.create({...me, stream:!1})`) at two sites: a
**mid-stream failure** arm with a classified cause, and a **`404_stream_creation`** arm. The two
cassettes the corpus has (`m1-api-error`, `m1-search-tools-lean`, measured by the corpus sub-agent)
are the 404 arm, recorded by accident of a non-existent model name. The mid-stream arm — C3's actual
finding, the one strict replay caught — has **no recording**. Both are live under reforge's pinned
gates: the disabling predicate is
`(I("tengu_watchdog_skip_nonstreaming_fallback",!1)||a.CLAUDE_CODE_REMOTE)&&Jm || Me(process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK) || I("tengu_disable_streaming_to_non_streaming_fallback",!1)`,
and all three inputs are false/unset under X6.

**11. The wave's row is ~549 KB across three chunks — the largest single row the campaign has
measured.** Detail in §1.7. W10's was ~354 KB and got six children.

---

## 1. The loop, measured

### 1.1 The call chain, end to end

Reading in the direction the bytes actually flow, headless:

```
GH  runHeadless            dvbbv89q  16,018 B  async fn        the headless entrypoint
 └ ky  _runHeadlessStreamingForTesting
                           dvbbv89q 140,599 B  plain fn, 20 params
    │                                          the drain loop + the 52-arm control ladder
    ├ Wn = Im()  ── gate tengu_print_engine_loop, default FALSE ──┐
    │                                                            │
    ├ (gate true, DEAD)  bu  createHeadlessSession  15,648 B ──► zve({run: Kx, …})  g461tywa 23,757 B
    │                                                     └► Te.submitMessage(…)
    └ (gate false, LIVE) ku  legacy per-turn ask()    2,671 B  async generator
                              └ new hu(…)             20,624 B class, 24 members, 0 private
                                 └ hu.submitMessage   19,056 B async generator
                                    └ Kx(…)  querySource:"sdk"      ← the ONLY Kx call site
                                       └ yW() ? Djn (observer tap, 880 B) : DAt
                                          └ DAt                58,208 B async generator
                                             ├ pe = e.deps ?? aAt()   {callModel, autocompact, uuid, now}
                                             ├ pe.callModel → XN → yxe → HIt   67,028 B async generator
                                             │                             └ kQ (retry) → EIt (stream:false)
                                             ├ pe.autocompact → zRe  2,894 B → nKn / Tte / wFt
                                             ├ rr.streamingToolExecutor → ORe  6,837 B class
                                             ├ xo() / await pm()      the shutdown latch
                                             └ XCt  9,868 B           the Stop-hook / end-of-turn cluster
```

`Kx` itself is 720 B: it picks `Djn` or `DAt`, emits `command_lifecycle` frames for every queued
command, records subagent exit, and returns the terminal. `Djn` is the observer tap — it drives
`DAt` by hand (`await u.next(_)` in a `while(!0)`), forwarding every value into a capture object and
flushing on `stream_request_start`; its error string is the only place the engine names it
(`"queryWithObserverTap: missing terminal after completion"`).

### 1.2 The turn driver `DAt` — shape

| | |
|---|---|
| symbol | `DAt`, `chunk-fy12d89p.js`, offsets 2,675,054–2,733,262, chunk-rel pretty **@74,528** |
| size | **58,208 B** — the second-largest declaration in a 4.0 MB chunk |
| shape | `async function*DAt(e,t,r)` — an async generator, three positional params |
| state | one literal `Pe = {messages, toolUseContext, maxOutputTokensOverride, compactTracking, stopHookActive, stopHookBlockingCount, maxOutputTokensRecoveryCount, hasAttemptedReactiveCompact, thinkingOnlyNudged, turnCount, pendingToolUseSummary, transition}` plus `rr = rAt({createStreamingToolExecutor, onReset})` |
| callees | **265 resolvable** — 156 local, 109 imported across 28 chunks (top: `bsdtxcdc` 31, `yx9c8yaw` 19, `38213y7h` 17) |
| delegations | 17 distinct `yield*` targets; 5 `for await` loops; `PostToolBatch` referenced 8× |
| private fields | none — it is a function, and every class it touches is fully public |
| exported | **no** — reachable only through `Kx` |

`rAt` (521 B) is the per-turn accumulator: `{assistantMessages, toolResults, toolUseBlocks,
needsFollowUp, toolRequestedEndTurn, shouldPreventContinuation, toolWasDeferred,
streamingToolExecutor, reset({clearAssistantMessages}), rebuildStreamingToolExecutor()}`. It is an
object literal, not a class — the same shape W10 found for the Bash tool, and the same consequence:
no accessor adapter is needed.

### 1.3 The API transport and streaming assembler

| symbol | bytes | offset / pretty | what it is |
|---|---|---|---|
| `HIt` | **67,028** | 3,144,477 · @86,447 | the streaming request + SSE assembler. `async function*HIt(e,t,r,o,u,d)`. The **largest declaration in the engine chunk.** Its switch carries all 18 SSE arms (`message_start`, `content_block_start`, `text`/`thinking`/`tool_use`/`server_tool_use`/`connector_text`/`thinking_and_connector_text`, `content_block_delta`, `text_delta`/`input_json_delta`/`thinking_delta`/`signature_delta`/`citations_delta`, `content_block_stop`, `message_delta`, `message_stop`). Yields 5 event types: `stream_event` ×8, `server_fallback` ×5, `fallback_request` ×2, `refusal_no_fallback` ×2, `streaming_fallback_began` ×2. 6 `cache_control` sites, 19 `"1h"`, 10 `"5m"`, 13 `fallbackModel`, 71 `tengu_*` events. 299 resolvable callees (149 local, 150 imported) |
| `XN` | 153 | @86,117 | the transport entry `aAt()` injects as `callModel` — `yield* yxe(e, async function*(){ yield* HIt(…) })` |
| `sX` | 277 | @86,103 | the one-shot variant: drains `HIt` and returns the single assistant message. **Exported**, one importer (`chunk-211zp74w.js`) |
| `yxe` | 254 | 2,860,756 | the fallback-credit wrapper: buffers the stream, strips `creditCode` from `fallback_request` events when the credit arm is off |
| `kQ` | **7,939** | 1,105,879 · @34,113 | the **retry driver** — `async function*kQ(e,t,r)`, `for(let Be=1; Be<=o+1; Be++)`, carrying `initialConsecutive529Errors`, `noResponseRetryLedger`, stale-keep-alive detection, 401/407 auth refresh, OAuth-refresh exhaustion, host-auth recovery counters |
| `EIt` | 2,186 | 3,137,082 · @86,158 | the **non-streaming retry** — `M.beta.messages.create({...me, stream:!1}).withResponse()`. Two call sites in `HIt` (mid-stream cause; `404_stream_creation`) |
| `S2` | 1,299 | 3,211,599 · @87,677 | the **usage accumulator** — merges `cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens` and the four token counters |
| `Eie` | 2,268 | 3,111,870 · @85,260 | the **prompt-cache key discriminator** — assembles a prefix from `"L:"`,`"G:"`,`"F:"`,`"S:"`,`"P:"`,`"X:"`,`"C1:"` markers per model/provider/tool/effort |
| `P8n` | 1,238 | 3,142,806 · @86,394 | messages → wire shaping with betas and tool-search folding |
| retry classifiers | 3,394 total | 1,116,754 and nearby | `odn` 1,310 · `RJn` 551 · `een` 415 · `FJn` 348 · `M3n` 302 · `YPe` 277 · `WZt` 191 — the `x-should-retry` / `"overloaded_error"` predicates |

Region B (offsets 3,100,000–3,228,765, 255 declarations) totals **126,308 B**, of which **`kOe`
(39,498 B) is the autonomous-security-monitor prompt and is NOT W13's** — it happens to be the next
declaration after the transport region ends. W13's transport slice is therefore **86,810 B**.

**§1.2 boundary.** The HTTP client itself is the vendored SDK: `chunk-zn7e9204.js` carries 9 of the
14 `x-should-retry` hits and the `retry-after` parsing, and `chunk-92vbp1ze.js` the SSE decoder.
Those are §1.2 "vendored libraries — engine-ts imports the real npm packages at assembly". What
stays in scope is exactly what §1.2 already says: *client-side formatting/policy over the server
boundary*, i.e. `kQ`'s attempt schedule, the classifiers, `EIt`'s fallback, `Eie`'s cache-key
policy, `S2`'s accounting, and `HIt`'s assembler.

### 1.4 The tool-use loop

The turn driver does not execute tools. It owns a **streaming tool executor** and drains it.

- `ORe` — `class ORe`, 2,599,319–2,606,156, **6,837 B, 27 members, 0 private**. Members that matter:
  `addTool` (1,017 B), `executeTool` (1,539 B async), `getCompletedResults` (generator),
  `getRemainingResults` (async generator), `waitForDrainable`, `discardAndAbortInFlight`,
  `createSyntheticErrorMessage` (1,093 B), `buildSameTurnToolUses`, `hasExecutingTools`,
  `hasUnfinishedTools`, `getUpdatedContext`. Constructed as
  `new ORe(ct.options.tools, _, ct, pe.now)` — the clock is injected.
- `DAt` drains it in three places: the abort path, the normal end-of-batch path, and the
  `PostToolBatch` hook path (`Fct(Ds.map(…))` over `{tool_name, tool_input, tool_use_id,
  tool_response}`).
- **`PostToolBatch` is the turn driver's**, not the hook wave's: 8 of the string's 23 bundle-wide
  occurrences are inside `DAt`.
- The **per-tool invocation** is `kUn` (26,716 B async, 13 params, offset 2,462,049, @69,108) —
  input validation, `InputValidationError`/`JSON_PARSE`, `tengu_tool_use_error`, result shaping.
  That is `ToolRuntimePort`'s far side and belongs to **C15/W12**, not here.
- The **permission consult** is `Gx` = `checkRuleBasedPermissions` (1,431 B, @32,683) — **C9's,
  already spliced**. The tool-dispatch belt at offsets 1,040,000–1,120,000 (71,292 B / 208
  declarations) is mostly already owned or routed: `Tye` = `executePreToolHooks` (C8), `Gx` (C9),
  `mQ` (4,272 B, the PreToolUse consumer) and `dQ` (1,889 B, the tool-failure dispatcher) are W5's
  measured pair. **W13's share of that belt is `kQ` and its classifiers only** (18,525 B in
  1,100,000–1,120,000).

### 1.5 The compaction drivers, the context accounting, and `sdk_status`

| symbol | bytes | offset · pretty | role |
|---|---|---|---|
| `zRe` | **2,894** | 2,832,570 · @77,743 | `async function*zRe(e,t,r,o,u,d,_)` — the autocompact **decision and routing** generator. Returns a 6-value union: `not_needed`, `failure_breaker_open`, `rapid_refill_breaker_tripped`, `compacted`, `hook_blocked`, plus `GRt(...)`'s failure record. Opens with `if(Me(process.env.DISABLE_COMPACT))return{kind:"not_needed"}`. Injected as `aAt().autocompact`; **zero direct call sites** |
| `nKn` | 270 | 2,832,300 · @77,731 | the trigger predicate — **C7-owned, spliced** |
| `Tte` | **3,224** | 1,696,686 · @49,131 | the reactive driver: runs `tz` (PreCompact hooks), emits `compact_progress{hooks_start}` → `sdk_status:"compacting"` → `compact_start` → `compact_end` → `sdk_status:null`, calls `wan`/`hFt` (the summarizer), and reports `{result, hookBlocked, failure}`. **Two callers: `DAt` (offset 2,717,492) and `zRe`** |
| `wFt` | 5,508 | 2,808,347 · @77,314 | the full-compaction producer. Exported; one importer (`chunk-2phb3yw1.js`) |
| `E4n` | 4,710 | 2,813,855 · @77,380 | the **segment** producer — see §2.2 |
| `jRt` | 7,925 | 2,819,309 · @77,449 | the compaction message-assembly belt |
| `Z1n` · `GRt` · `UG` · `eKn` · `rKn` · `m4e` | 571 · 456 · 529 · 49 · 248 · 40 | @77.7k, 750,646 | fixed-prefix overflow warn, failure record, post-compaction session restate, strip policy, spinner hint, threshold source |
| `Ih` · `Nee` · `iSe` · `eF` | 101 · 253 · 46 · 90 | 755,139 / 751,950 / 751,904 / 750,686 | **the context accounting**: token count, level classifier (`"compact"`/`"blocked"`), threshold, effective window. `nKn` is `Ih(e,If(t)) - u` then `Nee(…)`. C7's edge "the query loop owns the context accounting" is confirmed and it is **490 B of pure arithmetic**, not a subsystem |
| `G3` · `IYe` · `qRt` | 91 · 5 · 5 | 752,466 | the rapid-refill breaker and its two constants |

Region C (2,800,000–2,836,500, 68 declarations) totals **34,945 B**; the `Tte` belt
(1,690,000–1,706,000, 38 declarations) another **15,100 B**.

`sdk_status` is emitted at 14 sites in the engine chunk; the `"compacting"`/`null` pair is `Tte`'s,
reaching the wire through `toolUseContext.onCompactEvent` — 39 references in `fy12d89p`, 1 in
`dvbbv89q`. **`onCompactEvent` is a port, and it is the loop's**, because `zRe`'s hook-blocked and
early-compact-start arms fire it directly.

### 1.6 The frames the loop emits, and where they are built

The frame layer is **shared between headless and interactive and lives in `chunk-g461tywa.js`**,
which `chunk-dvbbv89q.js` imports 42 names from. Those 42 total **40,564 B out of `g461tywa`'s
301,820 B / 198 exports** — so W13's share of the "302 KB grab-bag the W11 scout refused to
S-chunk" is 13 % of it, and it is nameable:

| symbol | bytes | frame |
|---|---|---|
| `zve` | **23,757** | the session factory — `zve({run: Kx, queryParams, commands, models, agents, tools, skills, plugins, mcpServers, hostOwnsPermissionMode, sdkResultVerdict, onCommandLifecycle, onTurnThrow})`. Carries `num_turns`, `total_cost_usd`, `sdk_status`, `stream_request_start` |
| `Gve` | 2,089 | **`system:init`** — the only `subtype:"init"` construction bundle-wide. Emits `tools`, `mcp_servers`, `model`, `permissionMode`, `slash_commands`, `apiKeySource`, `betas`, `claude_code_version` (with the literal `VERSION:"2.1.251"`, `BUILD_TIME:"2026-08-28T14:51:3…"`) |
| `KC` | 157 | **the `result` frame** — `{type:"result", duration_ms, uuid, ...common, ...variant}`. **12 call sites in `dvbbv89q`**: `hu` ×8, `bu` ×3, `ea` ×1 |
| `FZe` | 376 | the cost/usage patch over `result` — `total_cost_usd`, `duration_api_ms`, `modelUsage`, `usage`, `subagent_stats`. 2 call sites, both in `ky` |
| `vie`·`wme`·`Uvt`·`O$e`·`xIn`·`Evt`·`kPn`·… | 3,527·1,985·1,295·862·789·684·667 | the rest of the shared belt (35 more names, 8,463 B) |

Task and notification frames (the W8 scout's deferral, §2.6) are split: `Op` (1,352 B) and `ay`
(1,069 B) in `dvbbv89q` carry `"task_started"` and `background_tasks_changed`; `ys`
(`emitTaskNotification`, 290 B) is in `chunk-bsdtxcdc.js` and `W3e` (`emitTaskProgress`, 332 B) at
offset 1,845,948 of `fy12d89p`.

### 1.7 The row, priced

| where | bytes | notes |
|---|---|---|
| `fy12d89p` turn-driver core (`ORe`…`DAt` end, 2,594,086–2,733,262, 197 decls) | **138,830** | includes `XCt`, `WRe`, `YCt`, `Xh`, `ZCt`, `nAt`, `Mjn`, `PAt`, `rAt`, `aAt`, `Kx`, `Djn` |
| `fy12d89p` transport + assembler (region B minus `kOe`) | **86,810** | `HIt` is 67,028 of it |
| `fy12d89p` compaction producers (region C) | **34,945** | `nKn` (270 B) already C7's |
| `fy12d89p` reactive driver belt (`Tte` region) | **15,100** | |
| `fy12d89p` retry driver belt | **18,525** | `kQ` 7,939 + classifiers |
| `fy12d89p` `TWn` ShutdownCoordinator | **8,919** | |
| `chunk-29shcjw2.js` shutdown latch | **780** | ~120 B of code; 10 importers |
| `dvbbv89q` loop slice (`GH`+`ky`+`hu`+`ku`+`bu`+`Uy`) | **204,534** | `ky` gross; its 52 ladder arms belong to W7/W10/W11 by arm. **`cs` (11,020 B) is excluded**: `class cs extends Rme{isRemoteTransport(){return!0}…}` with `isBridge`, `ccrClient` and an attestation-drop writer — the remote-control/bridge transport, §1.2 peripheral |
| `g461tywa` shared frame layer (42 of 198 exports) | **40,564** | |
| **total** | **≈ 549,007 B** | before subtracting other waves' arms inside `ky` |

For comparison: W10's row measured ~354 KB and was cut into six children; W9's 172 KB into four.
**W13 as chartered is 1.55× W10.**

---

## 2. Each deferral, measured and placed

### 2.1 (C7) the compaction drivers `zRe` and `Tte` — **W13's, confirmed, and cheaper than feared**

`zRe` 2,894 B + `Tte` 3,224 B = 6,118 B of driver. The reason they are "query-loop-shaped" is now
exact rather than intuitive: **`zRe` is a member of the loop's own deps object** (`aAt().autocompact`)
and has no other call site in the bundle, and **`Tte`'s two callers are `DAt` and `zRe`**. They
cannot be owned by the compaction wave because the compaction wave has no object to hang them on.
Verdict: **W13's, as the spec's C7 Revision Note already recorded.** Grading: `zRe` returns a
6-value union and calls 8 distinct helpers, so it is the exact shape C7's port-trace lesson was
written for — compare which ports ran, with what, how often, plus the answer; the two arms that
refuse before any effect (`DISABLE_COMPACT`, `failure_breaker_open`) need their **guard** graded, not
their trace.

### 2.2 (W7.5) segment compaction `E4n` — **W13's by routing; permanently REPL-only, with a third guard**

The W7.5 note ruled it OPEN on two guards (the headless command filter refuses `/rewind` because
`supportsNonInteractive: !1`; the headless query-event sink is
`if (e.type === "open_message_selector") return;`). This scout adds a **third, structural** guard
that does not depend on reading any dispatcher:

- `E4n` is exported from `chunk-fy12d89p.js` and has **exactly one importer bundle-wide**:
  `chunk-6thm48px.js`.
- It has **exactly one call site bundle-wide**, at offset 240,020 of that chunk, inside a method
  whose first statement is `const {…, onNotification} = this._requireHost()`.

So the module graph itself says the producer is host-mounted. Verdict: **W13's to OWN (a clean
4,710 B exported async function with no terminal dependency in its own body), never W13's to
SCENARIO.** Grade it the way C7 graded microcompaction and W3 graded the unrendered prompt paths:
extract the pinned body, stub the ports, compare the cross-product — which §2.4's "contract test
where the domain is wider than the corpus" now has a third instance of. **Once owned, exposing it as
a control subtype costs one arm** — the W7.5 note's own point, and the cleanest ownership-pays-rent
case in the campaign.

### 2.3 (W9) the resume LOOP half in `chunk-dvbbv89q.js` — **W13's**

- `Uy` = `loadInitialMessages`, **8,974 B async**, 34 `resume` references and 22 `forkSession`
  references — the largest single concentration of resume logic outside W9's storage layer.
- `GH` (`runHeadless`) carries 24 more `resume` references and 5 `forkSession` — the argument
  plumbing and the two symmetric call sites W9 measured.
- `Jd` holds the `"Resume rejected by --resume-drops-turn:"` message.
- `ky` carries 10 more, including the `CLAUDE_CODE_RESUME_IN…` env branch adjacent to the `Wn` fork.

Verdict: **W13's**, exactly as W9's "Not W9's" list routed it. Note the interlock: `m2/cross-resume.ts`
already grades the store contract across engines, so W13 inherits a working oracle for the storage
side of resume and owes only the *loop* side (which messages are loaded, in what order, and what the
turn does with a resumed tail).

### 2.4 (C10) the headless dispatch `ky` — **split by arm, and the split is already made**

`ky` is 140,599 B, a **plain function of 20 parameters**, re-exported as
`_runHeadlessStreamingForTesting`. Its 52-arm control ladder is not a separable block: the
`subtype===` comparisons run from +2,835 to +131,388 of its body (91.4 % of it), interleaved with
the drain loop and the outbound frame writer `Re`. **That is precisely why W7 could own five
handlers without owning `ky`** — the arms' *bodies* are separate top-level declarations (`Ey`
2,948 B, `km` 2,052 B, `Sf` 222 B, `Tf` 485 B, …) and the ladder only dispatches to them. The
strangled build confirms it: `chunk-dvbbv89q.js` carries 5 module imports and 5
`globalThis.__reforge` call sites.

Verdict: **W13 owns `ky`'s drain loop, its SIGINT/SIGTERM handlers, its frame writer and the `Wn`
fork; it does NOT own the ladder's arms.** The ladder is a dispatch table whose rows belong to W7
(control protocol), W10 (`backgroundedByUser`), W11 (the ten MCP arms, 13,051 B) and W8 (task
arms). The C16 cut should say this in the ledger as edges, or the wave will re-litigate 52 arms.

### 2.5 The turn driver itself — measured in §1.2–§1.6

Summarising placements: the **API call loop** (`kQ`, classifiers, `EIt`, `Eie` cache policy, the
`cache_control` ttl arms) is W13's, with the HTTP client and SSE decoder §1.2-excluded to the
vendored SDK; the **streaming assembler** is `HIt`'s 18-arm switch, of which **exactly one arm
(`text_delta`, 234 B) is owned today** — C1's mechanism spike, ledger footprint
3,182,489–3,182,723, which sits inside `HIt`; the **tool-use loop** is `ORe` + `DAt`'s three drains
+ `PostToolBatch`, with per-tool execution (`kUn`) routed to C15/W12 and the permission consult
already C9's; the **context accounting** is 490 B (`Ih`/`Nee`/`iSe`/`eF`); `sdk_status:"compacting"`
is `Tte`'s; `system:init` is `Gve`; the `result` frame is `KC` + `FZe`; cost/usage accounting is
`S2` plus 45 accessors in `chunk-38213y7h.js`.

### 2.6 (W8) the task/notification frames — **shared, and mostly not W13's**

`ys` (`emitTaskNotification`, 290 B, `chunk-bsdtxcdc.js`) and `W3e` (`emitTaskProgress`, 332 B,
`fy12d89p`) are single-anchor free functions the W8 scout already sized and routed to C11c. What
**is** W13's is the fact that these frames *ride the loop's stream*: `Op` (1,352 B) and `ay`
(1,069 B) in `dvbbv89q` are where `task_started` and `background_tasks_changed` enter the drain, and
the ordering guarantee between a task frame and the surrounding assistant/user frames is a property
of `ky`'s writer, not of the emitters. Verdict: **emitters stay C11c's; the interleaving contract is
W13's**, and it needs the differ's `canonicalizeLanes` (root / async-task / per-subagent) to stay
exactly as it is, because that scrub is what stops the ordering from being a false contract.

### 2.7 The process lifecycle — **W13's, and it is 780 bytes plus a coordinator**

`chunk-29shcjw2.js` is the whole shutdown latch, and it is small enough to quote:

```js
class t{committed=!1}var e=new t;
function xo(){return e.committed}
function S8e(){e.committed=!0}
var n=new Promise(()=>{});function pm(){return n}
export{xo,S8e,pm};
```

780 B of file, ~120 B of code, **10 importers**. `xo()` is the hook design's
`SchedulingPort.isShuttingDown()`; `pm()` is its `hang()`. Three `S8e()` call sites bundle-wide:
`TWn.shutdown()` and `TWn.shutdownSync()` (which also `await`s `executeSessionEndHooks`), and the
SIGTERM handler inside `ky` (`process.on("SIGTERM", br)` → `S8e(), nct(), Rn.abort(), On(143)`; the
SIGINT sibling aborts and calls `On(0)`). **`DAt` reads the latch itself** at offset 2,692,267, and
so does `XCt`'s first line. `TWn` is 8,919 B / 44 members / 0 private, with `install` (3,869 B),
`shutdown` (1,096 B async), `armShutdownFailsafe`, `armOrphanCheck`, `recordUncaughtAndCheckBreaker`,
`recordHttp2RecoveryAndCheckBudget`, `runBeforeInteractiveShutdown`.

Verdict: **W13's**, and it settles the hook-executor design's open question: the executor wave does
not need to invent a shutdown port — it needs W13 to own `xo`/`pm` and expose them, at which point
`jy` and `AE`'s shutdown guard really do become two-line owned predicates as that design predicted.
**This is a hard ordering edge: C10.6–C10.8 consume what C16 owns.** Today they can stub it; the
ledger should record the edge either way.

### 2.8 (C3) the retries and `PINNED_ENTRYPOINT`

- **The `stream:false` retry** — see §0 correction 10. Two arms, one accidentally recorded, one not.
  `src/faults.ts:117–127` already pushes a `{...asked, stream:false}` duplicate entry for
  `truncated-stream` and `malformed-event`, with `repeat: true`, so the *cassette* machinery exists;
  what is missing is a scenario that reaches the mid-stream arm on the real transport rather than a
  post-hoc rewrite.
- **`PINNED_ENTRYPOINT`** is `src/env.ts:290`, `"sdk-cli"`, written into `CLAUDE_CODE_ENTRYPOINT` on
  every spawn and asserted in `env.test.ts:215/217` (including that an operator's value is
  overridden). The tech-debt entry says it should become `"sdk-ts"` at the next pin bump. **This is
  W13's to decide, not to defer again**: the value goes into every request body, so it is graded on
  the request surface, and the inversion milestone is the moment an engine that is not the SDK CLI
  starts driving. Either the value stays `sdk-cli` and engine-ts lies about what it is, or it
  changes and the whole corpus re-records. Recommendation: **keep `sdk-cli` through C16, change it
  in C17 with the re-record C17 already owes**, and record the reason on the row rather than in the
  debt tracker.

### 2.9 (W5) the model-switch pair `mdt`/`gdt` — **NOT W13's, and the deferral's premise is wrong**

W5 deferred them as "stateful", implying the decision holder might be the loop's. Measured:

- `mdt` = `executePreModelSwitchHooks`, 1,494 B; `gdt` = `executePostModelSwitchHooks`, 1,390 B.
  Both run through `jy` — the hook wave's shutdown wrapper — so they are **hook-executor calls**,
  not loop calls.
- The decision holder is **session-scoped, in the store family W9 owns**:
  `Kvt = new Ln(() => new qvt)` where `class qvt{pending=[]; landedOn=null; inFlight=new Set}`, and
  `Vle = new Ln(() => ({registry: undefined}))`. `Ln` is the `.of(session)` host-scoped store
  constructor W9 measured.
- **They are reachable headlessly, and the corpus already drives the arm.** `chunk-9gqmx4zx.js`
  (11,506 B, imported by `dvbbv89q`) exports `CS` (737 B), which calls `mdt` at offset 7,437 and
  implements the re-validation loop (`if(Av(t())!==s)` → recurse with `revalidating:true`, else
  block with *"the session model changed while a PreModelSwitch hook was running; pick again"*).
  `CS` is called at offset 157,662 of `dvbbv89q` — **inside `km`, the `set_model` control handler**,
  as `CS(t.session, S, k, "sdk")`, and a non-`proceed` decision becomes the control error text
  `Yge(B)`. `tg` (79 B) fires the post-switch side.

Verdict: **route the executors to the hook-executor wave (C10.6–C10.8) with `jy`; route the holder
to W9's store family; route the arm to W7's ladder.** W13 owns none of it. The correction worth
generalising: **"stateful" is a reason to find the holder, not a reason to defer** — W5 deferred a
pair whose holder was two `Ln` stores away and whose arm the corpus was already recording
(`runtime-setters`, plus `set_model` in `m2/raw-protocol.ts`).

---

## 3. The inversion milestone, concretely

§2.4 defines the flip as *"engine-ts runs the protocol shell and query loop, delegating only
not-yet-owned subsystems back to extracted modules behind ports"*, ledger-triggered *"when the owned
set can carry the shell + loop end-to-end"*. Measured distance:

### 3.1 What exists

- **The skeleton boots and does three things.** `engine-ts/main.ts` (59 lines): `--version` prints
  the pin; `--owned` prints `{engine, targets_engine_version, owned_modules, owned_subsystems,
  unowned_subsystems}`; anything else reads one stdin line and emits a namespaced refusal frame
  (`type:"reforge_engine_ts_error"`, `subtype:"unowned"`, three triggers) and exits 3.
  `protocol.ts` (101 lines) can read one line and emit that one frame. **It cannot emit or consume
  `system`, `user`, `assistant`, `result`, `stream_event`, `control_request` or `control_response`.**
- **X7's registry is two strings per module.** `OwnedModule = {name, subsystem}`;
  `register`/`ownedSet`/`lookup`/`ownedSubsystems`/`unownedSubsystems`/`resetRegistryForTests`.
  **76 modules registered across 9 subsystems** — `hook-dispatch` 24, `environment-and-system-prompt`
  13, `permissions` 11, `tool-result-formatters` 10, `control-protocol` 7, `compaction` 5,
  `tool-descriptions` 4, `session-storage` 1, **`query-loop` 1** (`text-delta` →
  `appendTextDelta`). The registry stores no callable: `modules/index.ts` type-checks the entry is a
  function and then discards it. **A loop cannot invoke an owned module through X7 as it stands.**
- **Dual-wiring works and has two mechanisms.** 75 splices install a flat namespace of 75 function
  keys on `globalThis.__reforge` (150 adapter files: 75 reference + 75 sabotage); the built graph
  carries exactly 75 distinct `globalThis.__reforge.<fn>` call sites across 6 chunks (`fy12d89p` 62,
  `dvbbv89q` 5, `g1qrzvef` 5, `hdmehzg7`/`hx5r9amq`/`qe0j59w7` 1 each). The S-chunk replacement
  (`chunk-y30v0ja7.js`, 1,575 B) uses **no `__reforge` at all** — it is regenerated wholesale and
  imports the owned code directly. W13 must reason about both.
- **Ports exist as a manifest capture class, not as a type.** `CaptureClass = "primitive" |
  "pure-helper" | "effectful-port"`; **303 `effectful-port` captures declared across the 75
  splices**. The most-required, in order: `cwd` ×24, `createBaseHookInput` ×22, `executeHooks` ×14,
  `uuid` ×8, `hasHookForEvent` ×8, `executeHooksAwait` ×6, `log` ×5, `toolPermissionContext` ×4,
  `leanPrompt` ×4. **No `*Port` interface exists in `reforge/` that production code implements** —
  the only two hits are test-local aliases in `hooks-parity.test.ts`, backed by ~24 `__p_<name>`
  forwarder globals.

### 3.2 What the inversion requires of the loop

**The port is `zve`'s `run` argument** (§0 correction 3). Concretely, engine-ts must present a
`QueryLoopPort` whose single member has `Kx`'s call shape, measured from the one live call site:

```
run({ messages, systemPrompt, promptRenderEpoch, userContext, systemContext,
      canUseTool, toolUseContext, fallbackModel, querySource, maxTurns,
      taskBudget, stopHookActive })  -> AsyncGenerator<frame, {reason}>
```

and whose implementation consumes, in turn, three ports upstream already declares as a literal:
`callModel` (`ModelTransportPort` — this is `aAt().callModel`, i.e. `XN`), `autocompact`
(`CompactionDriverPort` — `zRe`), and `uuid`/`now` (the clock). Plus, from the measurement above:
`onCompactEvent` (the `sdk_status`/`compact_progress` sink), `streamingToolExecutor` (a factory, not
an object — `DAt` calls `rebuildStreamingToolExecutor()` on the refusal-decline path), the shutdown
latch (`xo`/`pm`), and the 105 accessors in `chunk-38213y7h.js` grouped into a
`LoopStatePort`/`CostLedgerPort` pair.

**What the loop consumes from earlier waves** (these are the *blocking* edges, and today the ledger
records **none** of them — `subsystem/query-loop`'s `edges` array is empty):

| the loop needs | owner | state today |
|---|---|---|
| `canUseTool` / rule matching | C9 permissions | spliced |
| PreToolUse / PostToolUse / Stop / PreCompact / SessionEnd execution | C8 + C10.6–C10.8 hook executors | dispatchers spliced; **executors not implemented** |
| per-tool execution (`kUn`), subagent dispatch | C15/W12 `ToolRuntimePort` | not dispatched |
| system-prompt assembly | C6 | spliced |
| the summarizer prompt + boundary emit | C7 | spliced |
| session load/append, resume tail | C12a–d | not dispatched |
| the control ladder's arms | C10 (5 owned) + W10/W11 | partly |
| the shutdown latch | **W13 itself** | — |

**The delegation route does not exist and is currently forbidden.** `check-reachability.ts`'s
`FORBIDDEN_ROOTS` includes `reforge/build/`, the bundle tree and the versions directory, resolved
through `realpathSync` (because `build/real-binary` is a symlink); a computed dynamic `import()` is
rejected outright (`DYNAMIC`). So "engine-ts with extracted compatibility islands" needs a
**deliberate, declared route** — and §3.6's four negative controls are precisely the four routes it
must not be. The only shape that satisfies both is an **out-of-process delegate**: engine-ts speaks
to a supervised `engine-extracted` over a declared channel, the checker keeps its static ban, and
the hermetic profile allows exactly that one channel. That is a design decision C16 must make, and
it is the reason the substrate and the inversion cannot be separated (§8).

### 3.3 What the negative controls need from the loop

§3.6's four controls are *per delegation route*, and each must FAIL the gate:

1. **direct exec of the real binary** — needs exec auditing over the descendant tree.
2. **shell trampoline via a workload child** — needs the same, plus the workload/reference
   distinction, which only a filesystem policy can draw.
3. **dynamic `import()` of an extracted chunk** — has a static analogue today
   (`reachability.test.ts:73` and `:105`), reusable as a shape template.
4. **read-plus-eval of extracted source** — needs file-open auditing; `check-reachability.ts:39–43`
   says so in its own header.

All four are executed *by engine-ts*, so the loop is what must be instrumentable: a delegation route
that engine-ts legitimately uses (the out-of-process delegate above) has to be distinguishable from
the four illegitimate ones **by policy**, which means the route must be a declared, single,
auditable channel rather than "whatever the loop happens to call".

---

## 4. The hermetic substrate (§3.6)

### 4.1 What §3.6 promised for W13

An **OS-enforced** boundary in which the real binary, the extraction bundle, `build/` and every other
engine wrapper are *genuinely unreadable and unexecutable* (deny-by-default filesystem policy — a
sandbox-exec profile or an environment where those paths do not exist), with **exec and
file-open/import activity audited across the whole descendant tree**, plus the four negative
controls. Bash scenarios still spawn user commands; *the isolation policy, not an env allowlist, is
what distinguishes workload children from reference-artifact access*.

### 4.2 What exists

**Nothing OS-enforced.** A repo-wide grep for `sandbox-exec`, `seatbelt`, `sandbox_profile`,
`unshare`, `bwrap`, `chroot`, `DYLD_*`, `LD_PRELOAD`, `ptrace`, `dtrace`, `fs_usage`, `landlock`,
`pledge` over `reforge/**` returns zero hits in executable code. What exists is four *adjacent*
things:

- **The env allowlist** (`src/env.ts`, 374 lines): `PLATFORM_PASSTHROUGH` 9 names
  (`PATH HOME TMPDIR SHELL TERM LANG LC_ALL USER LOGNAME`), `HARNESS_SET_VARS` 11
  (`CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL CLAUDE_CODE_MAX_RETRIES DISABLE_TELEMETRY
  DISABLE_ERROR_REPORTING CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_GROWTHBOOK BUN
  CLAUDE_CODE_ENTRYPOINT CLAUDE_AGENT_SDK_VERSION CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`),
  `CREDENTIAL_VARS` 2, `FORBIDDEN_VARS` 2. `assertSchema()` throws on anything else. **One engine
  spawn bypasses it**: `engine-ts/skeleton.test.ts:34` uses `spawnSync(WRAPPER, args, {input,
  encoding, timeout})` with **no `env`**, so the engine-ts wrapper inherits the operator's whole
  environment — and it is a gate phase (`strangle/gate.ts:165`). That is an X6 hole in the exact
  wrapper the inversion makes primary.
- **`CLAUDE_CONFIG_DIR`** → `reforge/config`, set at `env.ts:345`. `m2/probe-isolation.ts` (114
  lines) proved containment of **writes** by replaying `bash-tool` twice through `engine-real` with
  and without the redirect, asserting the isolated run added zero session files to `~/.claude` and
  that transcripts and scrubbed request bodies were byte-identical. It probes no reads, no exec, no
  bundle paths, and it is not a gate phase.
- **`resetSandbox()`** (`harness.ts:127–131`) wipes `reforge/sandbox/` and `config/plans` and
  nothing else.
- **The static reachability checker** (`check-reachability.ts`, 298 lines; `reachability.test.ts`, 30
  controls) — the cheap continuous half, which its own header says is not the proof.

### 4.3 What remains, measured against the two carry-overs

**(a) W9's config-dir accumulation, re-measured this session:** `reforge/config/` is **19 MB**;
`projects/` holds **426** transcript files (410 top-level + 16 subagent), up from W9's 412;
`tasks/` **1,085** entries; `session-env/` **3,943**. W9's finding stands verbatim: *"the harness has
exactly one primitive today (`resetSandbox`, which wipes `sandbox/` and `config/plans` and nothing
else)"*, and *"'the corpus happens to have left 396 files there' is the opposite of a controlled
input."* For W13 the consequence is sharper than for W9: **a hermetic boundary that denies the
bundle but admits a 19 MB accumulated config directory is not a controlled environment**, and every
long-horizon loop trace (§5) will read it.

**(b) W10's child-process supervision gap, verbatim:** *"An engine that leaks a child, or kills one
it should have detached, is invisible to every diff surface the campaign has… W9 named process
supervision as its carry-over; W10 is the wave that cannot be graded without it."* And its W13
sentence: *"the harness has no notion of a host capability that a scenario can require. §3.6's
isolation substrate lands at W13 and will need the same notion."* C13c owns the descendant-set
snapshot; **§3.6's exec audit is the same enumeration one level stricter**, so C16 must either
consume C13c or build it.

### 4.4 The concrete deny/allow list, derived

A boundary must make unreadable and unexecutable: `~/.local/share/claude/versions/` (**four**
binaries on this host — 2.1.251, 2.1.252, 2.1.257, 2.1.258 — not one), `~/claude-code-bundle/`
(211 MB, 2,074 module files, a 130 MB `payload.bin`, a 39.5 MB `cli.pretty.js`),
`reforge/build/graph/`, `reforge/build/strangled/`, `reforge/build/real-binary` **and its realpath**,
and the three sibling wrappers `engines/engine-real`, `engines/engine-extracted`,
`engines/engine-strangled`. It must still allow `toolchain/bun`, `engine-ts/**`,
`strangle/modules/*/reference.js`, `sandbox/`, `config/`, and whatever a Bash workload child
legitimately touches. `/usr/bin/sandbox-exec` exists on this host (102,560 B) and is unused.

**Verdict: the substrate is a build, not a hardening.** Nothing in `reforge/` is a starting point
except the negative-control *shape* of the dynamic-import test.

---

## 5. The grading surface

### 5.1 What already grades here

More than any prior wave inherited, which is the good news:

- **§3.4 strict replay** — `proxy.ts:288–299`: exact canonicalized-body hash first, then per-(method,
  path) FIFO; `strictReplay(engineB) = engineB !== "engine-extracted"`, so a positional fallback is
  **fatal for engine-ts**. `assertNoKeyCollisions` refuses to start if two different raw bodies
  canonicalize to one key.
- **The fault cassettes (H2)** — five kinds (`overloaded` 529, `rate-limited` 429, `server-error`
  500, `truncated-stream`, `malformed-event`), replayed into both engines with a bounded
  `CLAUDE_CODE_MAX_RETRIES=1`, grading the surfaced outcome string, the attempt count, and a
  substance gate that the engine saw the injected fault rather than the proxy's own 500.
- **Partials (H3)** — `m2/partials.ts` grades the ordered `stream_event` **type** sequence and the
  reassembled `text_delta` text; explicitly not raw delta boundaries.
- **The raw driver (H5)** — `m2/raw-protocol.ts` drives ten control subtypes on the bare wire.
- **The `result` and `system:init` frames are graded field-by-field with no special casing.** On
  `result`: 9 fields scrubbed (`duration_ms`, `duration_api_ms`, `total_cost_usd`,
  `modelUsage.*.costUSD`, `ttft_ms`, `ttft_stream_ms`, `time_to_request_ms`, `session_id`, `uuid`)
  and **48 graded**, including `num_turns`, `stop_reason`, `terminal_reason`, `permission_denials`,
  all 14 `subagent_stats.*`, and the **entire token accounting** (`input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, both `ephemeral_1h`/`ephemeral_5m`
  splits, `output_tokens_details.thinking_tokens`, `server_tool_use.*`, `service_tier`,
  `inference_geo`, `speed`, and ten `modelUsage.<model>.*` members). On `system:init`: 2 scrubbed,
  **103 graded**. So **`S2`'s arithmetic is graded to the token; USD and wall-clock are not.**
- **Cache breakpoints are already counted.** `canonicalizeToolResultOrder` strips `cache_control`
  and re-adds `{type:"reforge-cache-breakpoints", count:N}` — so the breakpoint **count** survives
  the scrub even though placement does not.

### 5.2 The five capabilities no oracle has, that only this subsystem needs

Prior waves named three each. This one needs five, and two of them are the campaign's own
prerequisites arriving late.

1. **Mid-stream fault injection with byte-exact resumption.** Today faults are *cassette rewrites*
   (`deriveFaultCassette` mutates a whole entry before the run). Nothing can drop the Nth SSE event,
   stall between events, or destroy the socket mid-body. The one control point is
   `proxy.ts:307–315`, the replay writer's `for (const block of entry.responseBody.split("\n\n"))`
   loop; `ProxyHandle` exposes no stream control at all. **Without this, `HIt`'s 18-arm assembler and
   `kQ`'s attempt schedule cannot be graded on any arm the model did not happen to take**, and the
   mid-stream `EIt` arm — C3's finding — stays unreachable.
2. **The `stream:false` retry as a graded arm.** The 404 arm is recorded by accident; the mid-stream
   arm is not. This is capability 1's first consumer, and it needs the request-surface diff to
   distinguish "same body, `stream` flipped" from a positional fallback — which today it does, but
   only because `bodyHash` includes the flag.
3. **Cache-breakpoint accounting, positionally.** The differ deliberately reduces breakpoints to a
   count so that tool-result ordering is not a false contract. A wave that owns `Eie`'s cache-key
   discriminator and `HIt`'s six `cache_control` sites needs the **placement and the ttl** graded,
   which means a second, opt-in comparison over the unscrubbed request body for the scenarios that
   own those splices — not a weakening of the existing scrub.
4. **Multi-turn streaming input on the raw wire.** `m2/raw-protocol.ts` closes stdin immediately
   after one user frame under `--max-turns 1`. Streaming input exists only through `sdk.mjs`
   (`harness.ts:150` `pushable`, `:178` `converse`). **The inversion makes engine-ts the thing that
   reads the wire**, so the driver that grades it must be able to hold the session open, interleave
   control requests with user frames, and observe ordering. Today it cannot.
5. **A synthetic response corpus.** §3.2 makes it *mandatory from W9 and required for W13/W14*, and
   it does not exist. Measured need, from the corpus: `stop_reason` takes exactly **two** values
   across the whole corpus (`end_turn` ×96, `tool_use` ×54) — **zero** `max_tokens`,
   `stop_sequence`, `refusal`, `pause_turn`, `model_context_window_exceeded`; there are **zero** SSE
   `event: error` frames; there is exactly **one** 529 and it is derived, not recorded. `HIt` has
   arms for all of them.

Plus two the substrate needs, from §4: **descendant-set enumeration** (C13c's) and **a host-capability
declaration** a scenario can require.

### 5.3 The dirty-state and edge matrix (the §3.1 S-module obligation)

Written as partitions over the loop's inputs, not over its code:

| # | partition | how it is created | graded by |
|---|---|---|---|
| L1 | zero tools in the batch; text only | `plain` | existing |
| L2 | one tool; sequential | `bash-tool` | existing |
| L3 | N tools in one assistant message | `parallel-tools` (3), `hooks-batch` (2), `search-tools` (2) | existing |
| L4 | a tool that never settles; turn aborted mid-batch | `interrupt` | existing (the only non-`completed` `engineOutcome`) |
| L5 | tool result arrives after abort (`getRemainingResults` drain) | needs a scenario | **missing** |
| L6 | `stop_reason: max_tokens` → the `maxOutputTokensRecoveryCount` arm | synthetic corpus | **missing** |
| L7 | `stop_reason: refusal` → `refusal_no_fallback` / `fallback_request` | synthetic corpus | **missing** |
| L8 | 529 cascade with `initialConsecutive529Errors > 0` | synthetic + fault | partial (1 derived 529, attempt count 2) |
| L9 | mid-stream truncation → `EIt` (cause-classified) | capability 1 | **missing** |
| L10 | 404 at stream creation → `EIt` (`404_stream_creation`) | `api-error`, `search-tools-lean` | existing, accidental |
| L11 | 401 → auth refresh → retry (`kQ`'s OAuth arm) | needs the record-mode proxy to 401 once | **missing** |
| L12 | auto-compact fires mid-turn (`zRe` → `Tte` → summarizer → continuation) | `auto-compact-threshold` (two summarizer calls), `compact-continue` (8 requests) | existing |
| L13 | PreCompact hook blocks (`Tte`'s `hookBlocked` arm) | `hooks-precompact` variant | partial |
| L14 | compaction rapid-refill breaker trips (`G3` → `IYe` turns) | needs `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` plus a long trace | **missing** |
| L15 | `DISABLE_COMPACT` set (`zRe`'s first guard) | env var not in the allowlist | **OPEN**, guard cited |
| L16 | resumed tail with a `compact_boundary` in it | `cross-resume` + a seeded transcript | partial |
| L17 | shutdown during a turn (`xo()` true → `await pm()`) | SIGTERM mid-turn | **missing** — and it never settles, so it must be graded as "produced no further yields within N ms" |
| L18 | `maxTurns` exhausted → `error_max_turns` | `maxTurns` is 1–10 across the corpus but never hit | **missing** (`result.subtype` is `success` ×91, `error_during_execution` ×1) |
| L19 | model switch mid-session (`set_model` → `CS` → `mdt` revalidation) | `runtime-setters`, raw driver | existing, ungraded on the hook arm |
| L20 | the `Wn` fork's other side (`createHeadlessSession`) | gate-dead + env not allowlisted | **OPEN**, guard cited (§0.4) |

Ten of twenty cells are missing or partial, and **eight of those ten need capability 1 or capability
5**. That is the wave's real blocker, and it is not a code blocker.

---

## 6. Coverage and budget

### 6.1 What the 59 scenarios + m2/m3 reach

The corpus is **59 scenarios** across nine files (`m1` 9, `m2c` 8, `m3` 5, `w1` 2, `w2` 1, `w3` 4,
`w4` 2, `w5` 15, `w6` 13), plus five acceptance suites in `m2/all.ts` (corpus, faults, partials,
cross-resume, raw protocol). Measured over the 65 primary cassettes:

- **49 of 65** carry more than one `/v1/messages` request; the deepest real tool loop is
  **8 requests** (`compact-continue`), then four at 7 (`auto-compact-threshold`, `slash-compact`,
  `hooks-precompact`, `task-family`).
- **3 cassettes** carry parallel `tool_use` in one assistant message.
- **2 stop reasons** corpus-wide.
- **7 cassettes** carry an HTTP ≥400 on `/v1/messages`; all statuses: 200 ×239, 404 ×4, 500 ×2,
  400 ×1, 529 ×1, 429 ×1.
- `system:api_retry` has **never been recorded** — zero occurrences in 66 A-side transcripts, though
  `docs/parity/03-query-engine.md` 03.3 names it as the retry surface.
- `rate_limit_event` frames exist (60 of them) and are **deleted before diffing**
  (`DROP_MESSAGE_TYPES`).
- The **gate is 110 summary phases today**, not the 107 the campaign quotes — 107 was exact at
  commit `f4ca219`; W7.6a added two splices and one determinism phase. Blocks: 17 determinism, 3
  mechanism, 7 contracts, 1 derivation, **78 per-target liveness**, 1 attestation, 1 equivalence, 2
  auxiliary.
- `attestation/coverage.md`: 60 modules, 442 branch sites / 871 outcomes, 436 executed, 435 reviewed
  exclusions, 0 un-adjudicated. **None of the 60 is a query-loop module.**

### 6.2 Firing conditions and honest cost, per unreached arm

| arm | condition | cost |
|---|---|---|
| mid-stream `EIt` | a stream that starts and dies | **capability 1** (proxy per-event control), then free forever |
| `kQ` 401/OAuth refresh | one 401 on a live record | a record-mode injector arm (`RecordInjector` already exists, `proxy.ts:169`); ~1 recording |
| 529 cascade depth | ≥2 consecutive 529s | synthetic corpus; zero recordings |
| `max_tokens` recovery | a truncated-by-budget response | synthetic corpus; zero recordings |
| refusal / fallback family (`server_fallback`, `fallback_request`, `refusal_no_fallback`, `streaming_fallback_began`) | a refusal + a `fallbackModel` option | synthetic corpus + one option; the four yield types are all `HIt`'s and none is recorded |
| `error_max_turns` | a scenario whose model keeps calling tools past `maxTurns` | 1 recording, cheap, and it is the only way `result.subtype` error paths get any coverage |
| shutdown-during-turn (L17) | SIGTERM mid-turn | harness capability: send a signal to the engine child; ~30 lines, no recording |
| rapid-refill breaker | ≥2 compactions within `IYe` turns | 1 long recording with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` already allowlisted |
| cache-breakpoint placement | already in every request | **no recording** — an opt-in unscrubbed comparison |
| raw-wire multi-turn | hold stdin open | driver change in `m2/raw-protocol.ts`; 1 cassette |

**Recording budget: 3–4 new live recordings** (`error_max_turns`, a rapid-refill long trace, a
401-refresh, optionally a raw-wire multi-turn), against **two harness capabilities** (per-event
proxy control; signal delivery) and **one corpus generator** (synthetic responses). The ratio is the
opposite of every prior wave: W13 is cheap in recordings and expensive in machinery.

### 6.3 OPEN by construction, with the guards cited

- **`createHeadlessSession` (`bu`, 15,648 B) + `zve`'s headless arm.** Gate
  `tengu_print_engine_loop`, committed default `false`, 1 site; env override
  `CLAUDE_CODE_PRINT_ENGINE_LOOP` is outside the X6 allowlist. **OPEN**, and it is the one arm whose
  condition reforge could create by a one-line allowlist addition — which makes it the best
  flip-liveness candidate in the campaign.
- **Segment compaction (`E4n`).** Three guards (§2.2). **OPEN**, permanently at this seam.
- **`DISABLE_COMPACT`** (`zRe`'s first line). Env var outside the allowlist. **OPEN.**
- **The security-monitor prompt `kOe` (39,498 B)** sits inside the transport region and is not the
  loop's; it belongs to the auto-mode classifier surface W6 touched.
- **`sX`'s consumer** (`chunk-211zp74w.js`) is the only non-streaming entry; whether it is headless
  is unmeasured here and should be settled before C16 budgets it.

---

## 7. Parent-impact list

### 7.1 Campaign spec (`docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`)

- **§1.1 query-loop row**: replace *"module-level (long async generator) · `fy12d89p` @75–80k"* with
  *"one exported entry (`Kx`) over a 58 KB async generator (`DAt` @74.5k), a 67 KB streaming
  assembler and transport (`HIt` @86.4k), a 7.9 KB retry driver (`kQ` @34.1k), three compaction
  drivers (@49.1k and @77.3–77.8k) and a 780 B shutdown latch chunk; cross-turn state is 105
  accessors in `chunk-38213y7h.js` (895 importers), NOT in the generator; the headless half is
  `chunk-dvbbv89q.js` (`GH`/`ky`/`hu`/`ku`, 205 KB gross) and the frame layer is 42 of
  `g461tywa`'s 198 exports (40.6 KB). ~549 KB total."*
- **§3.3**: add that the defaults fixture cannot see a per-gate env override read *ahead of* the gate
  call (`Im`/`CLAUDE_CODE_PRINT_ENGINE_LOOP`, `bT`/`MCP_SDK_GENERATION`), and that the override
  inventory is a second extraction.
- **§6 W13 row / C16 child section**: widen per §8 and record the three-way question (loop ·
  inversion · substrate).
- **Deferred section**: mark deferrals (1), (2), (3), (7), (8) as W13-confirmed; **move (9)
  `mdt`/`gdt` out of W13** to the hook-executor wave + W9's store family + W7's ladder, with the
  measurement in §2.9.
- **§2.4**: record that upstream's own inversion seam is `zve({run: Kx, …})` and that the port W13
  presents is that parameter.

### 7.2 Census (`reforge/research/2026-08-31-engine-census.md`)

Row *"Agent query loop / turn driver … `fy12d89p` @75–80k; `dvbbv89q` (375 KB) headless driver ·
~250 KB · medium"* → the size is **~549 KB** and the seam quality is **high, not medium**: four
exported symbols, zero private fields in any class, and an injected deps object. The line
*"`@75–80k` is a long async generator with heavy closure capture across…"* should gain the four
missing regions.

### 7.3 Ledger (`reforge/ledger.json`) — read clean at 15:36, not modified

`subsystem/query-loop`, wave C16, state `spliced`, **`edges: []`**, one footprint
(3,182,489–3,182,723, the `text_delta` arm inside `HIt`). Three rows point *in*
(`tool-descriptions`, `environment-and-system-prompt`, `compaction`); **nothing points out.** C16's
first ledger act is to record the eight outbound edges in §3.2's table, plus the new inbound edge
from the hook-executor children (they consume `xo`/`pm`). Also: the row's title *"(retry, 529, model
fallback, compaction driver)"* is right and incomplete — add the transport, the assembler, the
frames and the process lifecycle.

### 7.4 W5–W7 anchor scout / W7 subtype matrix

The model-switch pair's deferral reason ("stateful") is superseded by §2.9. The matrix's 52-arm
ladder count is confirmed from a second direction (60 distinct `subtype===` literals inside `ky`,
of which 54 are control subtypes and 6 are frame subtypes the writer also tests).

### 7.5 W8 / W9 / W10 / W7.5 scouts

- W8: the interleaving contract for task frames is W13's; the emitters stay C11c's (§2.6).
- W9: *"the resume LOOP half in `dvbbv89q` (C16/W13)"* — sized at `Uy` 8,974 B plus `GH`'s branches
  (§2.3). Config-dir accumulation re-measured (426/1,085/3,943).
- W10: its §5.2 capability 3 (descendant-set snapshot) is a **shared dependency**, not a parallel
  one — §3.6's exec audit is the same enumeration.
- W7.5: the segment-compaction verdict gains a third guard (module-graph edge = 1, call site = 1,
  behind `_requireHost()`).

### 7.6 `reforge/src/env.ts` and `reforge/engine-ts/skeleton.test.ts`

`skeleton.test.ts:34` spawns the engine-ts wrapper with **no `env`**, inheriting the operator's
environment, and it is a gate phase. That is an X6 violation in the wrapper the inversion makes
primary; C16 (or sooner) should route it through `engineEnv({mode:"replay", …})`.

### 7.7 `docs/parity/`

`coverage.md` §2 row 1 claims **~88 %** for *"Turn execution & streaming — query() loop, streaming
I/O, partial messages, thinking/effort, maxTurns/maxBudgetUsd/taskBudget, compaction"*. Measured
against the corpus, five of its named sub-features have **zero** coverage
(`03.3` retry/backoff, `03.12` fallback model, `22.9` 529 cascade, `07.5` reactive-on-413,
`07.11` compaction circuit breaker), one has accidental coverage (`22.10`), and one has count-only
coverage (`22.12`). The percentage describes what the SDK exposes, not what reforge grades; the two
should not be read as the same number, and C16's landing note should say so.

---

## 8. A proposed cut for C16 — advisory

### 8.1 Is it one wave or three? — **Three, and the order is forced.**

The loop, the inversion and the substrate are not three views of one job:

- **The loop** is a 549 KB S-module with a four-symbol export surface, zero private fields, and an
  injected deps object. It is ownable the day its oracle capabilities exist, and it consumes eight
  earlier waves' ports.
- **The inversion** is an *architecture decision plus a delegation route* — it needs the loop owned
  and it needs a route that survives §3.6's four negative controls, which today's static checker
  forbids by construction. Its hardest question (out-of-process delegate vs allowlisted in-process
  route) is answerable before the loop lands and should be, because the answer changes the port
  shapes.
- **The substrate** shares *nothing* with either: no file, no oracle, no port. It is a sandbox
  profile, an exec/open audit, a host-capability declaration and four executable controls. It also
  **gates nothing until an engine-ts-primary artifact exists** — which is precisely §3.6's own
  stated reason for putting it at W13 rather than W0.

They are one wave only in the sense that they land in the same season. Fusing them repeats the
mistake W9 and W10 avoided: putting the cheapest high-yield unit behind the hardest.

### 8.2 What must land BEFORE the loop can be owned

Blocking, in the sense that the loop calls them:

1. **C10.6–C10.8 (hook executors)** — `DAt` runs PreCompact, Stop and PostToolBatch through them.
   Reciprocally they need W13's `xo`/`pm`; the clean break is **W13 owns the 780 B latch chunk
   first, as a standalone deliverable, and the executor children consume it**.
2. **C15/W12 (`ToolRuntimePort`)** — `ORe.executeTool` → `kUn`. Without it the tool-use loop's far
   side is a stub.
3. **C12a (storage oracle machinery)** — the resume half needs the config-directory precondition
   primitive and the flush-schedule decision.
4. **C13c (descendant-process snapshot)** — for L17 and for §3.6's exec audit.
5. **The synthetic response corpus** — spec-mandated since W9, still absent, and eight of the
   twenty matrix cells depend on it.

Non-blocking but load-bearing: C9 (permissions, spliced), C7 (compaction prompt/boundary, spliced),
C6 (prompt assembly, spliced), C10 (five control arms, spliced).

### 8.3 The children

**C16a / W13a — the loop oracle machinery** *(controlled, opus-tier; cut NOW, blocked-by nothing)*
The five capabilities of §5.2 that are harness work, not engine work:
(i) **per-event stream control in the replay proxy** — extend `ProxyHandle` with a per-entry event
policy (drop after N, delay, destroy, inject a malformed frame), implemented at
`proxy.ts:307–315`, with the existing `assertNoKeyCollisions` and strict-fallback rules untouched;
(ii) **the synthetic response corpus** generalising `src/faults.ts` per §3.2 — protocol-valid SSE
over the case matrix, deterministic seeds, an explicit oracle expectation per case, and the
non-vacuity contract §3.1 fixes (empty or token case set fails);
(iii) **signal delivery to the engine child** plus the "no further yields within N ms" verdict shape
the shutdown arm needs;
(iv) **raw-wire multi-turn** in `m2/raw-protocol.ts` (hold stdin open, interleave control frames);
(v) **opt-in unscrubbed request comparison** for cache-breakpoint placement and ttl.
*Acceptance*: each capability has a negative control (a synthetic case that must FAIL if the
generator emits nothing; a per-event policy that must change the engine's observed behaviour; a
signal that must produce a distinguishable verdict); the existing 110 gate phases stay green.
*Why first*: it is the only child with no dependency on any other wave, and every later child is
blocked on it.

**C16b / W13b — the process lifecycle** *(autonomous, opus-tier; cut NOW; disjoint files)*
Own `chunk-29shcjw2.js` outright (an S-chunk of 780 B / ~120 B of code, 10 importers, 3 exports) and
splice `TWn`'s shutdown pair. Deliverables: `LifecyclePort` with `isShuttingDown()`, `hang()`,
`claimShutdown()`, `releaseShutdownClaim()`; the SIGINT/SIGTERM handler pair in `ky`; the
`sealTranscriptAppendsForShutdown` edge to W9.
*Acceptance*: the hook-executor children can drop their `isShuttingDown` stub and consume this;
a SIGTERM-mid-turn scenario produces a named stable verdict on both engines.
*Why early and separate*: it unblocks C10.6–C10.8, it is 780 bytes plus one class, and it is the
campaign's smallest whole-chunk ownership by two orders of magnitude.

**C16c / W13c — the transport and the streaming assembler** *(fable-tier; blocked-by C16a)*
`HIt` (67,028 B) + `XN`/`sX`/`yxe` + `kQ` (7,939 B) + the seven retry classifiers + `EIt` + `S2` +
`Eie` + `P8n`, behind `ModelTransportPort` (`callModel`, the shape `aAt()` already declares) and a
`RetryPolicyPort`. The 18-arm assembler switch absorbs C1's existing `text_delta` splice rather
than sitting beside it. §1.2 line: the HTTP client and SSE decoder stay vendored.
*Acceptance*: the synthetic corpus drives every one of the 18 arms and all five yield types; the
mutation battery kills dropped events, reordered deltas, duplicated emissions and a swallowed
`message_stop`; both `EIt` arms graded; token accounting byte-identical on `result`.

**C16d / W13d — the turn driver and the compaction drivers** *(fable-tier; blocked-by C16c, C10.6–8,
C15)*
`Kx`/`Djn`/`DAt` (59,808 B) + `rAt`/`aAt` + `ORe` + `XCt`'s loop-owned half + `zRe`/`Tte`/`wFt`/
`E4n` + the 490 B of context accounting + `PostToolBatch`, behind `QueryLoopPort` (= `zve`'s `run`),
`CompactionDriverPort`, `ToolExecutorPort` and the `LoopStatePort`/`CostLedgerPort` pair over
`chunk-38213y7h.js`'s 105 accessors.
*Acceptance*: the §5.3 matrix fully green or adjudicated; the port trace compares which ports ran,
with what, how often, across all of them (C7's lesson); the two `zRe` arms that refuse before any
effect are graded by guard; `E4n` graded by contract test with its three guards cited.

**C16e / W13e — the headless half and the frame layer** *(fable-tier; blocked-by C16d)*
`GH` + `ky`'s drain loop and writer + `hu` + `ku` + `Uy` (resume) + the 42 shared exports of
`g461tywa` (`Gve` `system:init`, `KC`/`FZe` the `result` frame, `zve`). Explicitly **not** the 52
ladder arms — those stay W7/W10/W11 rows, recorded as edges.
*Acceptance*: `system:init`'s 103 graded fields and `result`'s 48 reproduce exactly; the `Wn` fork
recorded as OPEN with its gate cited, or FIRED if C16a's flip-liveness adds
`CLAUDE_CODE_PRINT_ENGINE_LOOP` to the allowlist with a negative control.

**C16f / W13f — the hermetic substrate** *(controlled, fable-tier; parallel with C16c/d, blocked-by
C13c)*
The sandbox-exec profile (deny list in §4.4, resolved through realpaths), exec **and**
file-open auditing over the descendant tree, the host-capability declaration a scenario can require,
the `resetSandbox()`/config-dir policy decision W9 left open, and the four negative controls.
*Acceptance*: each of the four routes FAILS the gate from inside the boundary; a Bash workload child
still passes; the audit distinguishes them by policy, not by env.
*Why parallel*: it shares no file with any other child and it gates nothing until C16g.

**C16g / W13g — the inversion** *(controlled, fable-tier; blocked-by C16b–f)*
The decision and the flip: engine-ts's stream-json shell (a real line reader/writer for `system`,
`user`, `assistant`, `result`, `stream_event`, `control_request`, `control_response`), X7 extended
from `{name, subsystem}` to a dispatchable registry, the declared delegation route (recommendation:
**out-of-process supervised delegate**, so `check-reachability.ts` keeps its static ban and the
hermetic profile allows exactly one channel), and the ledger flip.
*Acceptance*: engine-ts drives the corpus as `engineB` under strict replay for the scenarios whose
subsystems are owned, delegating the rest, inside C16f's boundary; the four negative controls fail;
`--owned` reports the flip.

### 8.4 Track hints and tiers

| child | tier | track | blocked-by |
|---|---|---|---|
| C16a oracle machinery | opus | controlled | — (cut now) |
| C16b process lifecycle | opus | autonomous | — (cut now) |
| C16c transport + assembler | fable | controlled | C16a |
| C16d turn + compaction drivers | fable | controlled | C16c, C10.6–8, C15, C12a |
| C16e headless half + frames | fable | controlled | C16d |
| C16f hermetic substrate | fable | controlled | C13c (parallel with c/d) |
| C16g inversion | fable | controlled | C16b–f |

**Not C16's**: `mdt`/`gdt` (§2.9); `kUn` and the Agent tool object `Ane` (C15/W12); the 52 ladder
arms (W7/W10/W11); `ys`/`W3e` (C11c); `kOe`, the security-monitor prompt (39,498 B, W6's classifier
surface); `cs` in `dvbbv89q` (11,020 B, the remote-control/bridge transport, §1.2 periphery); the
vendored HTTP client and SSE decoder (§1.2); `chunk-38213y7h.js` as a chunk (895 importers — ports
only).

---

## 9. Method notes worth keeping

1. **Attribute every literal to its enclosing declaration, not to its chunk.** A bisect over
   top-level declaration spans turned "`PostToolBatch` appears 23 times in the engine chunk" into
   "8 of them are inside the turn driver", which is what made the tool-batch hook placeable. Every
   count in this document that says "in X" was produced this way.
2. **Read the deps object before designing the port.** `aAt()` is 94 bytes and it named three of the
   four ports this wave needs. The campaign spent three review rounds designing
   `ModelTransportPort`; upstream declares it as a property name. **Before writing a port design,
   grep the target for a literal whose values are the target's own effects.**
3. **An importer count is a guard.** "Nothing headless reaches `E4n`" was already established from
   two dispatcher guards; a third, cheaper and independent, was `E4n` has one importer and one call
   site. Module-graph edges are evidence about reachability that needs no dispatcher reading, and
   they survive minification better than any anchor.
4. **When the engine logs which branch it took, quote the log.** The `Wn` fork was nameable in one
   grep because the engine prints `"[print] turns run on the engine session (createHeadlessSession)"`
   versus `"[print] turns run on legacy per-turn ask()"`. Debug strings are the bundle's own
   documentation of its forks and are under-used by this campaign.
5. **A gate-default fixture measures the gate, not the decision.** Two waves have now found an env
   override sitting *in front of* a gate call (`MCP_SDK_GENERATION`, `CLAUDE_CODE_PRINT_ENGINE_LOOP`).
   The extraction that answers "what does this pin do by default" has to walk the *predicate*, not
   the gate call.
6. **"Stateful, therefore deferred" is an unfinished measurement.** §2.9's pair was deferred for two
   waves on that phrase; the holder was two `Ln` stores away and the arm was already in the corpus.
   The finishable form is: name the holder, name its lifetime, name its owner.
7. **Chunk-relative pretty lines are worth publishing alongside byte offsets.** The census speaks
   `@Nk`; the AST speaks bytes. Every locator in this document carries both, produced by slicing
   `cli.pretty.js` to the chunk's line range once and grepping declarations inside it.
