# W11 MCP / slash-commands / skills scout — the generation fork, the headless command surface, and what the campaign has wrong (pin 2.1.251)

Scope: C14 / W11 ("MCP adapter + slash commands + skills loading"). READ-ONLY: no build, no gate, no
recording, no scenario was run; nothing outside this file was written.
Method: substring counts over the **1,802-file** module set (`cli` + every `.js`, the set
`strangle/prepare.ts:textModules()` builds); TypeScript-parser spans and top-level declaration
inventories over the owning chunks; export-alias harvesting (three of this wave's chunks name their own
API in their `export{… as …}` statement); `import.meta.require` graph walks; the committed fixtures read
as artifacts; and the live harness config (`reforge/config/.claude.json`) read as an artifact.
Scratch scripts in `/tmp/w11scout/`.
Grounding: campaign spec §1.1/§1.2/§1.3/§2.1–§2.4/§3.1/§3.3/§6-W11 + the C10, C10.5 and W8/W9 Revision
Notes; `2026-08-31-engine-census.md`; `2026-09-02-w8-moat-tools-scout.md` and
`2026-09-02-w9-session-storage-scout.md` (format and doctrine); `2026-09-02-w7-control-subtype-matrix.md`;
`reforge/ledger.json`; `research/fixtures/*.json`; `docs/parity/coverage.md`.

---

## 0. Seven corrections, before anything is budgeted

Every scout so far corrected the census it was handed. This one corrects the **census**, the **spec**,
the **ledger**, the **W8 scout** and one **fixture** — and its first correction changes the wave's
anchor mechanism, not just its size. Full list with evidence in §7; the seven that change what W11
must do:

1. **The MCP layer is FORKED into two complete generations, and the campaign has been reading the fork
   as one adapter.** `chunk-4mp04j81.js` and `chunk-1bxday80.js` — the two chunks §1.1 and the census
   both name as "the MCP adapter" — are not two halves of one layer. They are **v2 and v1 of the same
   module**: 112 of `1bxday80`'s 112 exports are a strict subset of `4mp04j81`'s 121, both are consumed
   by exactly one file, and that file (`chunk-6rdsq6fw.js`, 6,549 B) is a **runtime accessor** that
   picks one at `import.meta.require` time and throws a named tripwire if the loaded module's
   `MCP_TREE_ID` disagrees. The fork is not limited to the client: **eight module pairs** fork this way
   (client, auth, elicitation, task-watcher, SDK-error-classification, directory-read,
   is-list-auth-error, xaa-idp-login). (§1.1)

2. **v1 is the live arm at this pin and v2 is dead — but the lever that opens v2 is an env var the gate
   fixture cannot see.** `bT()` (`chunk-cr9f4adc.js`, 1,427 B) reads `MCP_SDK_GENERATION` **first** and
   only consults `I("tengu_brindle_causeway", !1)` when the env var is absent, so this is not a gate
   with an override — it is an env arm that **bypasses** the gate. `research/tools/extract-gate-defaults.ts`
   looks for a gate call whose then-branch returns the env identifier; this shape has no such branch, so
   `perGateEnvOverrides` misses it. This is the **second** instance of the W8 scout's "an extractor that
   requires an exact syntactic form will miss the variants" finding, and the second one that hides a
   whole-subsystem switch. (§1.1, §7.5)

3. **Every prose anchor in the MCP surface counts exactly 2× bundle-wide, because the dead twin carries
   the same string.** Measured over all 1,802 files: `"SDK servers should be handled in print.ts"` 2×,
   `"is blocked by managed policy"` 2×, `"which the Anthropic API does not accept"` 2×,
   `"MCP endpoint not found at "` 2×, `"Failed to connect SDK MCP server: "` 2×,
   `"Received elicitation completion notification: "` 2×. **W11's MCP half has no unanchorable
   functions and no uniquely-anchorable ones either** — every splice needs a `coLiteral` or file-scope
   selector, and the tie is systemic rather than incidental. This is a different failure shape from
   C6's structural anchors: those were weak *per pin*, these are ambiguous *today*. (§5.1)

4. **`k0t`'s predicate is twice what W7.5 recorded, and the missing half is the larger, default-admit
   population.** The measured body is
   `function k0t(e){return e.type==="prompt"&&!e.disableNonInteractive||e.type==="local"&&e.supportsNonInteractive}`.
   W7.5 recorded only the `local` clause. The `prompt` clause admits **by default** — a project
   `.claude/commands/*.md` file, a plugin command, a bundled skill and an **MCP prompt** all pass the
   headless filter unless they opt out, and exactly one shipped command opts out (`statusline`). The
   headless slash surface is not a handful of survivors; it is everything except an opt-out list plus
   an opt-in list. (§2.2)

5. **There is a deliberate, first-class headless slash-command surface, selected by `Le()`, and nobody
   has counted it.** `Le()` is `!host.launchOptions.isInteractive()` — TRUE headlessly. Twenty commands
   ship **two implementations**: a `local-jsx` one gated `!Le()` and a `local` one gated `Le()`, each in
   its own lazily-imported chunk. `/model`, `/config`, `/context`, `/usage`, `/mcp`, `/effort`,
   `/rename`, `/fast`, `/color`, `/import`, `/skill-doctor`, `/stop`, `/goal`, `/extra-usage`,
   `/usage-credits`, `/ultrareview`, `/auto-mode-setup`, `/autocompact`, `/exit`, `/version` are all in
   this shape. Twenty-eight of the 104 statically-resolvable registry entries pass `k0t`; the corpus
   reaches **two** of them. (§2.1, §2.2)

6. **`skillUsage` in `.claude.json` is not skill telemetry. It is the shared invocation counter for
   prompt-type slash commands AND the `Skill` tool, and it is a live determinism hazard for W9's config
   snapshot.** The writer is `Ndt` (`chunk-fy12d89p.js`, 301 B): a 60-second per-session debounce, then
   a read-modify-write of the global config. Its three call sites are two slash-command execution paths
   in `chunk-304awr1a.js` and the `Skill` tool's `call`. The harness config records
   `skillUsage.reforgeprobe.usageCount: 155` — and `reforgeprobe` is a **project markdown slash
   command** (`reforge/w5/probe-hook-events.ts`, `reforge/w5/scenarios.ts`), not a skill. Because
   `resetSandbox()` does not touch `.claude.json`, the counter is **monotonic across the corpus**: engine
   A's run leaves N and engine B's leaves N+1, so any config-store diff over `.claude.json` diverges on
   every slash/skill scenario unless the field is normalized. (§3.4, §4.1)

7. **Ten MCP control-protocol subtypes were routed to W11 as one — `mcp_message`, 58 bytes.** The
   committed `control-protocol-2.1.251.json` carries `mcp_call` (4,289 B of arm), `mcp_authenticate`
   (2,646), `mcp_toggle` (1,676), `mcp_reconnect` (1,197), `set_mcp_permission_mode_override` (1,158),
   `mcp_clear_auth` (874), `mcp_oauth_callback_url` (617), `mcp_set_servers` (455), `mcp_message` (108)
   and `mcp_status` (31) — **13,051 B**, plus `reload_skills` and `register_repo_root`'s `reload_skills`
   leg. W7's probe already measured eight of the ten FIRED (on refusal arms) and two OPEN. The spec's
   Deferred section says "`mcp_message` … is one line into the MCP transport and belongs with W11",
   which is true of `QKn` and misleading about the routing: the MCP control surface is 120× that line.
   (§1.7, §7.1)

---

## 1. The MCP adapter, measured

### 1.1 The generation fork — the shape the census does not describe

`chunk-6rdsq6fw.js` (6,549 B, 10 exports, 1 consumer path) is the **MCP runtime accessor**. It exports
nine module getters and one telemetry emitter; eight of the nine getters branch on `bT()`:

| accessor export | v2 chunk | v2 B | v1 chunk | v1 B |
|---|---|---|---|---|
| `mcpClientModule` | `chunk-4mp04j81.js` | 135,736 | `chunk-1bxday80.js` | 131,432 |
| `mcpTaskWatcherModule` | `chunk-df9a0y7y.js` | 22,325 | `chunk-pnav63ra.js` | 21,772 |
| `mcpAuthModule` | `chunk-tztwbj80.js` | 12,883 | `chunk-9khyjsx2.js` | 12,765 |
| `mcpElicitationHandlerModule` | `chunk-g0spnr0c.js` | 12,000 | `chunk-b1w5hbt4.js` | 11,922 |
| `mcpDirectoryReadModule` | `chunk-w8edrx5a.js` | 5,441 | `chunk-pmvnvs7j.js` | 5,360 |
| `mcpXaaIdpLoginModule` | `chunk-a7e8rrm7.js` | 2,603 | `chunk-dfqwsbhe.js` | 2,603 |
| `mcpSdkErrorClassificationModule` | `chunk-etgxpk62.js` | 1,248 | `chunk-2j7vqw1p.js` | 1,170 |
| `mcpIsListAuthErrorModule` | `chunk-1987dkht.js` | 851 | `chunk-wesbtbpq.js` | 853 |
| `mcpSkillsListModule` | `chunk-x2zggfer.js` (**not forked**) | 1,809 | — | — |
| | **v2 total** | **193,087** | **v1 total** | **187,877** |

The selector, in full (`chunk-cr9f4adc.js`, 1,427 B — a module-level latch class `u`, one instance `o`,
one function):

```js
function bT(){ if(o.latched!==void 0) return o.latched;
  let e=a.MCP_SDK_GENERATION, t=e==="v1"||e==="v2"?e:void 0;
  if(e!==void 0&&t===void 0) n(`MCP_SDK_GENERATION=${e} is invalid; expected 'v1' or 'v2' — ignoring`,{level:"warn"});
  let i=t===void 0&&I("tengu_brindle_causeway",!1)===!0, r=t??(i?"v2":"v1"),
      d=t!==void 0?"env":i?"growthbook":"default";
  return o.latch(r), n(`mcp runtime arm: ${r} (source: ${d})`),
    s("tengu_mcp_sdk_generation",{generation:c(r),source:c(d)}), r }
```

`tengu_brindle_causeway`'s compiled-in default is `false` (1 site, `gate-defaults-2.1.251.json`), so
under §3.3 the arm is **v1** and `source:"default"`. The accessor's tripwire — `"MCP runtime accessor
tripwire: resolved generation is v2 but the loaded client module does not carry MCP_TREE_ID v2"` — is
the loudest failure surface any wave in this campaign has been handed for free, and it is the natural
model for what an owned adapter's generation check should look like.

**Ownership consequence.** W11 owns v1 and records v2 as an exclusion with the guard cited; the
exclusion is *conditional*, because `MCP_SDK_GENERATION=v2` is a declared-override knob `src/env.ts`'s
`knobs.gateOverrides` accepts today (it is not in `ALLOWED`, so `engineEnv` will pass it as a declared
override and `assertSchema` will accept it). Whether the campaign spends a flip-liveness cell on it is a
budget decision, not a reachability one — and it is the cleanest flip-liveness target in the bundle,
because the two arms are byte-different implementations of one interface.

### 1.2 Client lifecycle

All spans from `chunk-1bxday80.js` (v1; the v2 twin's are within ±4 % throughout).

| piece | ident | semantic name (upstream's own export alias) | B | @offset |
|---|---|---|---|---|
| connect | `Ae` | `connectToServer` | **17,560** | 56141 |
| ensure-connected | `Ot` | `ensureConnectedClient` | 1,194 | 76705 |
| reconnect | `nr` | `reconnectMcpServerImpl` | 1,809 | 100609 |
| SDK in-process setup | `wc` | `setupSdkMcpClients` | 1,777 | 125973 |
| release/detach | `xe`/`Bo` | `detachAndCloseConnection` / `disposeServerConnectionDetached` | — | in `Ae`'s teardown |
| MCP client class | `tt` | (the vendored `Client` subclass) | 9,894 | 16587 |
| SSE transport class | `rt` | — | 3,409 | 26574 |
| auth provider | `ft` | — | 1,935 | 30422 |

`chunk-1bxday80.js` has **189 top-level declarations, 112,891 B of them** in a 131,432 B file, and its
export statement names all 112 in readable form (`connectToServer`, `ensureConnectedClient`,
`callMCPTool`, `hydrateToolsFromListing`, `processMCPResult`, `onMcpElicitRequest`, …). This is the
same gift `chunk-e6cn1914.js` gave W9: **upstream has already named this subsystem's whole API**, and
unlike W9's case it is in the module itself, so a pin bump re-derives it for free. None of the 112 names
is in `research/fixtures/symbol-map-2.1.251.json` for this chunk.

`ensureConnectedClient` is where the wave's headless story starts:

```js
async function Ot(e,t){
  if(e.type==="connected"&&e.config.type==="sdk") return e;                 // SDK servers never re-dial
  if(As(e.name,e.config)) throw new R(`MCP server "${e.name}" is blocked by managed policy`, …);
  if(Ho()&&_i(e.name)&& (await wr(...))?.type!=="connected")
     throw new R(`MCP server "${e.name}" is disabled — re-enable it via /mcp to use its tools`, …);
  let o=Ae(e.name,e.config); …                                              // memoized per identity epoch
  if(d.type==="needs-auth") throw … "needs authentication" (mcpErrorSource:"user_auth")
  if(d.type!=="connected")  throw … "is not connected"
```

### 1.3 Transports — the else-if chain, in order

Extracted from `connectToServer`'s body:

| # | `t.type` | what it builds | headless status |
|---|---|---|---|
| 1 | `sse` | `rt` (SSE transport) + auth provider `g6e`, first-party auto-auth (`tengu_mcp_first_party_auto_auth`), `headersHelper` | live |
| 2 | `sse-ide` | `rt` against the IDE URL | IDE-dead |
| 3 | `ws-ide` | `globalThis.WebSocket` + `rhe`, `X-Claude-Code-Ide-Authorization` | IDE-dead |
| 4 | `ws` | `globalThis.WebSocket` + `rhe`, `Authorization: Bearer` | live |
| 5 | `http` | `aPt` (streamable HTTP); logs Node version, `NODE_OPTIONS`, `UV_THREADPOOL_SIZE`, `HTTP_PROXY`; probes `127.0.0.1`/`localhost` reachability first | live |
| 6 | `sdk` | **`throw Error("SDK servers should be handled in print.ts")`** | never taken |
| 7 | `claudeai-proxy` | requires `pr()`; "claude.ai MCP proxy is not available on third-party providers" | server boundary, §1.2 |
| 8 | — (`OH(e.name)`) | in-process **Chrome** MCP server (`chunk-mz606v8h`, `chunk-4eeb239y`, `chunk-ys6q6n60`) | §1.2-excluded periphery |
| 9 | — (`C6(t)&&F6(e)`) | in-process **Computer-Use** MCP server (`chunk-2k8dh1ab`) | §1.2-excluded periphery |
| 10 | `stdio` **or absent** | child process; `CLAUDE_CODE_SHELL_PREFIX` wraps command+args; stderr piped with a **64 MiB** accumulation cap (`67108864`); SIGINT-then-wait teardown; `AAe("mcp_stdio", pid)` registers the child | **live and the only externally-driveable one** |
| 11 | else | `throw Error(\`Unsupported server type: ${t.type}\`)` | — |

Two facts that decide the wave's probe design:

- **The `sdk` transport never enters `connectToServer` at all.** `setupSdkMcpClients` builds its own
  in-process transport (`u6e`), its own `Client` (`tt`), connects, reads `getServerCapabilities()` /
  `getInstructions()` (capped by `capMcpInstructions`), stamps `config.scope="dynamic"`, and returns
  `{clients, tools, commands}`. The corpus's only MCP scenario runs entirely on this path.
- **Every dial is memoized per identity epoch** (`lr()` / `getMcpIdentityEpoch`, `evictAllMcpMemosOnIdentityChange`,
  `takeSettledCachedDialFailure`, `discardMemoizedConnectResult`). This is module-level state with a
  documented eviction protocol — §2.3 port territory, not a free function.

### 1.4 Discovery and the MCP → tool-catalog projection

`hydrateToolsFromListing` (`kr`, **9,980 B**) is the single largest pure-ish function in the wave and
the place the campaign's tool-catalog story actually happens.

**Naming.** `xc(serverName, toolName)` → `mcp__<server>__<tool>` — *unless*
`e.config.type==="sdk" && process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX`, in which case the bare tool name
is presented. A second env-driven catalog axis, undocumented anywhere in the campaign.

**Schema translation, two stages, both gated.**
`Wrt(inputSchema)` returns `unchanged | normalized | drop`; normalization flattens top-level
`anyOf`/`oneOf`/`allOf` ("…which the Anthropic API does not accept") and prepends a note to the
description, and is applied only when `isSchemaNormalizeEnabledFor(config)` holds. `qrt(schema)` then
validates, with `check ∈ {meta, property-key}`, and drops the tool only when
`isSchemaApiValidateEnabledFor(config)` holds. The refusal line is
`Skipping tool "<name>": <reason>. Other tools from this server remain available.` Seven distinct
`tengu_mcp_degraded` reasons are emitted across the two stages
(`connected_zero_tools`, `tool_schema_normalized`, `tool_schema_normalize_gated`,
`tool_schema_unsupported`, `tool_schema_invalid`, `tool_property_key_invalid`,
`tool_schema_invalid_gated`, `tool_property_key_invalid_gated`) — an eight-cell behavioural partition
that an owned module must reproduce and that a single round-tripping scenario grades none of.

**The `_meta` keys the engine reads**, all four:
`anthropic/maxResultSizeChars` (clamped to `QDe`, and sets `persistenceThresholdCeiling`),
`anthropic/requiresUserInteraction` (→ `requiresUserInteraction()` and `suppressesAlwaysAllowRule`),
`anthropic/searchHint`, `anthropic/alwaysLoad`.
**The `annotations` it reads**: `title`, `readOnlyHint` (drives both `isConcurrencySafe` and
`isReadOnly`), `destructiveHint`, `openWorldHint`.

**`mcpInfo`**, the object W6's plan-mode pre-check keys on (the C9 Revision Note's "guarded on
`e.mcpInfo`"), is constructed here: `{serverName, scope, serverType, pluginTelemetry?, displayName,
iconUrl, serverInfoName, cliOwned?, toolName, title, execution, role, effectiveMaxPermission}`.

**`checkPermissions`** on a projected tool: design-consent interception first, then
`if(requiresUserInteraction) return {behavior:"ask", message:"MCPTool requires permission.", suppressAlwaysAllowRule:true}`,
else `{behavior:"passthrough", message:"MCPTool requires permission.", suggestions:[addRules …localSettings]}`.
This is the "MCP ask ceiling" the C9 Revision Note put at rung eight of the pre-check; W6 owns the
chain, W11 owns the rung's producer.

### 1.5 The tool-call path

`X.call` on a projected tool, wrapped twice:

1. Outer wrapper sets `B.options.activeMcpServer` / `activeMcpTool`, records plugin provenance, then
   calls the inner with `rpt(input, toolName, serverName, …, I("tengu_mcp_strip_trailing_xml_tags",!1), …)`.
2. Inner emits `{type:"mcp_progress", status:"started"|"completed"|"failed", serverName, toolName, elapsedTimeMs}`
   progress frames, sends `_meta:{"claudecode/toolUseId": …}` to the server, calls
   `ensureConnectedClient` then `callMCPToolWithUrlElicitationRetry` (`tn`, 3,687 B) → `callMCPTool`
   (`Lt`, **6,880 B**), and retries **once** on a session-expired error (`isMcpSessionExpiredError`,
   telemetry `mcp_session_recovery` / `session_retry_exhausted`).
3. Result shape: `{data: content, urlElicitationDeclined?, mcpMeta:{_meta?, structuredContent?}}`.
   Errors are re-shaped: a bare `Error` becomes `new R(msg, msg.slice(0,200))` with `mcpErrorSource`;
   an `McpError` with a numeric code becomes `new R(msg, "McpError <code>")`.
4. **Auto-backgrounding is on by default.** `getMcpAutoBackgroundMs(config, {isNonInteractiveSession})`
   sits behind `tengu_mcp_auto_background`, whose compiled-in default is **`true`**; when it returns
   `>0` the call is handed to `callMcpToolWithAutoBackground` with a `hasPendingElicitation()` probe.
   This is a live-by-default behaviour on the headless seam that no scenario exercises, and it is the
   MCP half's equivalent of the cross-session finding W8 made: a moat behaviour that survives §3.3.

Result post-processing lives in `processMCPResult` (`Qo`, 1,669 B), `transformMCPResult` (`Xo`, 952 B),
`transformResultContent` (`Rt`, 972 B) — the image-limit / content-block marshalling the corpus's
`mcp-tool` scenario does traverse.

### 1.6 Elicitation — both OPEN hook events, and where they actually fire

The `mcpElicitationHandlerModule` chunks are **re-export barrels** (11,922 B of which ~99 % is import
statements). The implementation is `chunk-5ww6p4vy.js` (v1, 4,473 B, **3,427 B of code in 7
declarations**) / `chunk-9hmmefv0.js` (v2, 4,524 B):

| export | ident | B | role |
|---|---|---|---|
| `handleElicitationRequest` | `Idr` | 1,175 | interactive request handler; pushes onto `appState.elicitation.queue` and awaits a `respond` only a TUI supplies |
| `runElicitationResultHooks` | `Ixt` | 729 | calls `QSe` (**`ElicitationResult`**), then emits `EE` (**`Notification`**) with `notificationType:"elicitation_response"` |
| `registerElicitationHandler` | `LEr` | 717 | installs the request handler + the completion notification handler; the latter emits `EE` with `notificationType:"elicitation_complete"` |
| `runElicitationHooks` | `xxt` | 526 | calls `JSe` (**`Elicitation`**); `blockingError` → `{action:"decline"}`, a response → `{action, content}`, else fall through |
| `parseRelatedTaskMetadata` | `OEr` | 90 | reads `_meta` for a related `taskId` |

**The four `Notification` call sites per generation** the brief asked about are exactly these: one in
`LEr` (completion), three in `Ixt` (blocked / normal / catch). They are duplicated in `9hmmefv0`, which
is why the count reads ×4 in each chunk.

**Reachability, with the mechanism rather than the absence.** `registerElicitationHandler`'s only two
call sites are in `chunk-v4j6c888.js`, a React-hooks module (`useEffect`-shaped `A(()=>…,[…])`, `.current`
refs) — the TUI. That reading would make both events dead, **and it is wrong**: the headless print loop
has its own registration path. `chunk-dvbbv89q.js` `ns(clients)` (1,480 B, @207651) registers
`onMcpElicitRequest` per connected client and calls `Zm().runElicitationHooks(...)` then
`t.handleElicitation(...)` then `Zm().runElicitationResultHooks(...)`, logging
`Elicitation request received in print mode: …` (**1× bundle-wide**). `ns` is called unconditionally
from the headless loop's setup and again on every MCP client-list change and on `mcp_reconnect` /
`mcp_toggle` / `mcp_set_servers`.

**But `ns` skips SDK servers:**

```js
function ns(u){ for(let T of u){ if(T.type!=="connected"||Xl.has(T.client)) continue;
                                if(T.config.type==="sdk") continue;   /* ← the guard */ … } }
```

So: **an eliciting SDK MCP server cannot fire `Elicitation`, `ElicitationResult`, or the two
`Notification` types. An eliciting *stdio* MCP server can.** That single line decides the probe design
in §6.2 and is the reason the obvious cheap probe (extend `m2c`'s `createSdkMcpServer`) would have
produced a clean-looking negative — the exact shape C8's boundary round named.

Two further guards worth recording: during `connectToServer` the client installs
`setRequestHandler(voe, async()=>({action:"cancel"}))`, so an elicitation arriving *before* `ns` runs is
auto-cancelled; and `t.handleElicitation` routes through the SDK's declared dialog kinds
(`Ey`'s `supportedDialogKinds` → `declared_dialog_kinds`, bounded by `MAX_DECLARED_DIALOG_KINDS`), so a
host that declares none cannot answer.

### 1.7 The MCP control-protocol surface, and the SDK registration path

`Ey` (`handleInitialize`, `chunk-dvbbv89q.js`, 2,948 B — C10-owned) does **not** consume
`sdkMcpServers`. Its **caller** does, in the `initialize` arm of the control loop:

```js
else if(d.request.subtype==="initialize"){
  let A=d.request.sdkMcpServers, x=d.request.webSearchIsolationExemptMcpServers;
  if(<either is a non-array-of-strings>) Ge(d,"initialize: sdkMcpServers and webSearchIsolationExemptMcpServers must be arrays of strings"), continue;
  let ye=d.request.sdkMcpServerConfigs, X=He(ye)?ye:void 0;
  if(ye!=null&&X===void 0) n("initialize: ignoring sdkMcpServerConfigs (not an object keyed by …)");
  let ue=d.request.skills; if(<not array of strings>) Ge(d,"initialize: skills must be an array of strings"), continue;
  if(d.request.sdkMcpServers?.length>0){ for(let Fe of d.request.sdkMcpServers){
      let tt=Td(P,Fe), Ze=…timeout, At=Fge(Ze);
      if(Ze!==void 0&&At===void 0) n(`initialize: ignoring invalid timeout for SDK MCP server '${Fe}'`);
      if(tt){ if(tt.timeout!==At) n(`initialize: SDK MCP server '${Fe}' is already registered; its timeout change is ignored until the server is removed and re-added`); continue }
      P[Fe]={type:"sdk",name:Fe,...At!==void 0&&{timeout:At}} } Fs() }
  if(d.request.webSearchIsolationExemptMcpServers) zqn(Io,d.request.webSearchIsolationExemptMcpServers);
  let We=await Ey(...);
}
```

`P` is the live `mcpServers` config map; the SDK server enters as `{type:"sdk"}` — the very type
`connectToServer` throws on — and `Fs()` triggers reconciliation. `zqn`
(`chunk-fy12d89p.js`, 147 B) applies the web-search isolation exemption; `Ey` itself only reads
`j().mcp` for the `tengu_sdk_init_handshake` telemetry (`mcp_client_count`, `mcp_pending_count`,
`mcpNonBlocking`). **`initialize` also carries `skills`** → `Cxn(e.skills)` (117 B), which is the
session skills allowlist `qdt` enforces (§3.3). So the `initialize` handshake configures all three of
W11's surfaces and C10 owns only the handler, not the arm's MCP/skills prologue.

The ten MCP subtypes and their arm sizes are in §0.7. Three more headless-only pieces sit beside them in
`chunk-dvbbv89q.js`, all self-named by its export aliases:
`headlessMcpPrewaitPolicy` (`by`), `waitForPendingMcpBeforeFirstCommand` (`ff`),
`explicitMcpConfigRequestsWait` (`zH`), `reconcileMcpServers` (`Ky`), `handleMcpSetServers` (`Vy`),
`mergeMcpClientLists` (`hf`), `redactMcpSetServersErrorsForPersistedLane` (`Wy`),
`passedMcpStatusText` (`Nf`), `STATIC_MCP_REFUSALS` (`Lf`), `MCP_ERROR_ACCOUNT_CHANGED` (`Ff`).
`mcp_message`'s delegate is one line: `QKn(e,n){ Yi(e.client)?.transport?.onmessage?.(n) }`
(`chunk-h4hvhzbw.js`, 7,976 B, 58 B for `QKn`) — and its arm **answers `success` even when the named
server is not found**, which is a refusal that leaves no refusal and therefore a scenario worth one line.

### 1.8 The three MCP resource tools — catalog rows that do not exist

`Y0()` builds them (`UA`/`ListMcpResourcesTool` 1,415 B, `zA`/`ReadMcpResourceTool` 2,453 B,
`yD`/`ReadMcpResourceDirTool` 2,004 B; aliases `ListMcpResources`, `ReadMcpResource`,
`ReadMcpResourceDir`) — and `bE` immediately **removes them from the native catalog**:

```js
let r=new Set([UA.name, zA.name, yD.name, qs]);      // qs = "StructuredOutput"
let o=Y0().filter((x)=>!r.has(x.name));
```

They re-enter only through the MCP tool list, and only when a connected client advertises
`capabilities.resources` — `setupSdkMcpClients` ends with
`if(clients.some(c=>c.type==="connected"&&c.capabilities?.resources)) d.push(UA,zA,yD)`.
`ReadMcpResourceDir` additionally needs `mu()` = `I("tengu_mcp_skills", !1)` — **gate-dead**.
A fifth MCP tool, `RefreshMcpTools` (`xAe`, `V9`), is in `Y0()` behind
`process.env.CLAUDE_CODE_ENABLE_REFRESH_MCP_TOOLS`.

**This corrects `SD` as the W8 scout described it.** Measured:

```js
function SD(e,t,r){ let o=bE(e,r);                       // natives, minus the four filtered names
  let u=E$t(hI(t,e),t), d=r?.skillTools??[];
  let _=d.length>0 ? u.concat(hI(d,e)).sort(tre) : u.sort(tre);
  return pu(o.toSorted(tre).concat(_),"name") }
```

Natives are sorted **and MCP + skill tools are sorted separately and appended** — not merged into one
sort. The `mcp-tool` cassette confirms it: 23 tools, `mcp__reforge__echo_token` last, after `Write`.
`skillTools` is a **third catalog contributor** the campaign has never named.

### 1.9 OAuth and the first-party surface

`mcpAuthModule` (`chunk-9khyjsx2.js`, 12,765 B, 21 exports) plus the client's own
`isMcpAuthCached`, `markMcpClientNeedsAuth`, `removeMcpAuthCacheEntry`, `createClaudeAiProxyFetch`,
`createCliOwnedBearerFetch`, `createFirstPartyApiMcpFetch`, `createCcrProxyFetch`. The two control arms
(`mcp_authenticate` 2,646 B, `mcp_oauth_callback_url` 617 B) are the only entry points, and W7's probe
recorded both **OPEN** ("starts an MCP server's OAuth flow, which needs a real server and a browser
redirect"). §1.2 already excludes OAuth endpoints as server boundary; what stays in scope is the
client-side *policy* (cache lookup, needs-auth classification, the 401/403 → `claudeai-proxy` fallback
in `connectToServer`, `isMcpSessionExpiredError`) — measurable against a local stdio server that
returns 401, which is the cheapest way to reach it.

The first-party **design-consent** family (`buildFirstPartyDesignConsentAsk`, `withFirstPartyDesignConsentIntercept`,
`denyTokenlessFirstPartyDesignWrite`, `suppressDesignWriteAddRules`, `GRANT_ELIGIBLE_DESIGN_WRITE_OPS`,
and the `/design`, `/design-consent`, `/design-revoke` commands) is ~8 KB of the client and is
**server-coupled product periphery** — §1.2, not W11's.

### 1.10 The MCP feature-gate population

Twenty-five gates in the committed fixture carry `mcp` or `skill` in their name. The ones that change
behaviour on the headless path at their compiled-in defaults:

| gate | default | effect |
|---|---|---|
| `tengu_mcp_auto_background` | **true** | MCP calls may background themselves (§1.5) |
| `tengu_mcp_connect_timeout_retry` | **true** (3 sites) | connect retry |
| `tengu_mcp_listen_reopen_park` | **true** (2) | v2-only listen reopen |
| `tengu_mcp_proxy_needs_approval_retry` | **true** (3) | ccr approval retry |
| `tengu_mcp_server_policy_bypass_exempt` | **true** | policy bypass exemption |
| `tengu_mcp_singleton_unwrap` | **true** (2) | result unwrapping |
| `tengu_mcp_startup_policy_seed` | **true** | policy seeding at startup |
| `tengu_mcp_stateless_skip_init` | **true** | skips `initialize` for stateless servers |
| `tengu_surface_failed_mcp_servers` | **true** | failed servers surface to the model |
| `tengu_brindle_causeway` | false | the v2 arm (§1.1) |
| `tengu_mcp_skills` | false | MCP resources → skills, and `ReadMcpResourceDir` |
| `tengu_mcp_strip_trailing_xml_tags` | false | input munging |
| `tengu_mcp_directory_bff`, `…_issuer_strict_echo`, `…_claudeai_eligibility_gate`, `…_protocol_negotiation_{ccr,claudeai,http}`, `…_subagent_prompt` | false | negotiation / first-party |
| `tengu_mcp_discovery_cache_enable`, `…_listen_reopen_park_tuning` | *no literal default* | the fixture records `null` |

Nine gates whose default is TRUE is the largest live-by-default gate cluster any wave has been handed;
each is a branch an owned module must implement in its on state and the parity oracle must assert.

---

## 2. Slash commands, enumerated from the artifact

### 2.1 The registry, and how it is assembled

`frr()` (`chunk-fy12d89p.js`, 777 B, @3470805) returns the builtin command table, memoized as
`To().builtinCommandTable` behind `xae()` (85 B). Its array has **133 elements**: 104 identifiers that
resolve statically to command object literals, 20 spreads, 2 calls, 7 dynamic sources. Resolving all of
them:

- **`E0(<key>)`** picks `whenOpen`/`whenClosed` lists from `_0t()`, six keys with their open predicates:
  `fleetFork` (`cy()&&!IS_DEMO`), `fleetBackground` (`cy()`), `daemon` (`TV()`), `skillDoctor` (`gk()`),
  `logout` (`!I6()||qC(mi())`), `pluginTypes` (`ww.hooksModulesRolloutOn()`).
- **Nine chunks contribute commands through `import.meta.require(...).default`**: `chunk-3v8tyh0z`
  (`remote-control`), `chunk-z2xj2wnb` (`recap`), `chunk-69q2z08k` (`list-agents`), `chunk-y6tgejmf`
  (`workflows`), `chunk-e79mq6g4` (`team-onboarding`), `chunk-zh67ztkc` (`goal` + `goalNonInteractive`),
  `chunk-h0hpb2vm` (`background`), `chunk-189ymtzr` (`daemon`), `chunk-z5qtz0sc` (`stop`), plus
  `chunk-sjxhmb42` and `chunk-rvajqfry` (`brief`).
- **`T0(...)`** manufactures six Claude-for-Enterprise upsell commands (`ultraplan`, `ultrareview`,
  `teleport`, `remote-control`, `schedule`, `autofix-pr`), all `type:"local"`,
  `supportsNonInteractive:!1`, gated `HLt()` which includes `!Le()` — interactive-only by construction.
- **`gDt(name, label)`** manufactures the two "moved to /config" tombstones (`vim`, `output-style`).
- **`VDt({...})`** manufactures `security-review` as a `type:"prompt"` builtin whose body is `Ker`
  (10,779 B of frontmattered markdown embedded in the engine chunk).

Bundle-wide, **142 command-shaped object literals** exist: **83 `local-jsx`** (17,287 B), **45 `local`**
(11,119 B), **14 `prompt`** (13,459 B, of which four are *factories* for MCP prompts, project/bundled
files and plugin commands rather than fixed commands).

Three post-processing passes run over the assembled list and all three are W11's:
`krr` (381 B) strips plugin aliases that collide with shipped names, honouring `k0t` when `Le()`;
`sz` (531 B) resolves `plugin`/`bundled`/**`mcp`** namespace shadowing by trailing segment after the
last `:`; `prr`/`b0t`/`oI`/`bte` build the reserved-spelling and shipped-name sets.

### 2.2 The headless filter, exactly

```js
function Rce(e){ if(Eg()) return []; return e.filter(k0t) }
function k0t(e){ return e.type==="prompt" && !e.disableNonInteractive
                     || e.type==="local"  &&  e.supportsNonInteractive }
```

`Eg()` is `host.launchOptions.disableSlashCommands()` — **one host switch that empties the entire
headless slash surface**, and the same switch that disables the `Skill` tool
(`aht(){ if(Eg())return!1; return!0 }`, `chunk-yqtkbd2c.js`). That shared gate is the strongest single
argument for treating MCP-prompts, slash commands and skills as one wave (§8).

`isEnabled` is a **second, independent filter** applied downstream, and the two together — not `k0t`
alone — define the headless population. Twenty-eight of the 104 resolvable registry entries pass `k0t`
(7,641 B of object literal):

| command | ident | aliases | `isEnabled` | headless verdict |
|---|---|---|---|---|
| `clear` | `uae` | reset, new | — | **live** (corpus: `hooks-session-end`) |
| `compact` | `yae` | — | `!DISABLE_COMPACT` | **live** (corpus: `slash-compact`) |
| `model` | `dFe` | — | `Le()` | live |
| `config` | `IDe` | settings | `Le()` | live |
| `context` | `DDe` | — | `Le()` | live |
| `usage` | `kLe` | cost, stats | `Le()` | live |
| `mcp` | `Sae` | — | `Le()` | live |
| `effort` | `wFe` | — | `Le()` | live |
| `fast` | `ILe` | — | `Le()` | live |
| `color` | `gDe` | — | `Le()` | live |
| `rename` | `QDe` | name | `Le()` | live |
| `autocompact` | `_ae` | — | `Le()\|\|$n()` | live |
| `goal` | (`zh67ztkc`) | — | `Le()\|\|$n()` | live |
| `agents` | `CLt` | — | — | live |
| `reload-skills` | `wae` | — | — | live |
| `recap` | (`z2xj2wnb`) | — | — | live |
| `stop` | (`z5qtz0sc`) | — | `wt` | live if a background session |
| `list-agents` | (`69q2z08k`) | peers | `Yo()` = `tengu_harbor_kite` **true** | live (W8's cross-session switch) |
| `skill-doctor` | `bae` | — | `E0("skillDoctor")` + `Le()` | live if `gk()` |
| `plugin-types` | `hnr` | — | `E0("pluginTypes")` | live if plugin hooks rollout |
| `init` | `wDt` | — | — (prompt) | live |
| `insights` | `drr` | — | — (prompt) | live |
| `security-review` | `YDt` | — | — (prompt) | live |
| `__remote-workflow` | `YLt` | — | hidden | live |
| `workflow-launch-exec` | `XLt` | — | hidden | live |
| `heapdump` | `xLt` | — | `Mt("allow_heap_dump")` | managed-policy-gated |
| `design` / `design-consent` / `design-revoke` | `CDt`/`vDt`/`EDt` | — | `_z()` | first-party, §1.2 |
| `auto-mode-setup` | `uDe` | — | `lDe()&&Le()` | onboarding-gated |
| `import` | `bDt` | — | `nX()&&Le()`; `nX()=I("tengu_import",!1)` | **gate-dead** |
| `pause-memory` | `NDe` | memory-pause, toggle-memory | `()=>!1` | **dead** |
| `extra-usage` / `usage-credits` | `bFe`/`yFe` | — | `eb()&&Le()` | account-gated |
| `ultrareview` | `BDt` | — | `Le()&&YR()` | config-gated |

`/rewind` (`PLt`) has `supportsNonInteractive:!1` — W7.5's reading holds for that one command, and it is
the reason `rewind_files` has a control arm but no slash route.

**The registered set is not the reachable set, in both directions.** Two `local` headless twins are
*declared* but absent from `frr()`'s array (`ZLe` = `/version`, `KLt` = `/exit`) — dead declarations at
this pin. Conversely, the `prompt` factories mean the population is unbounded from the filesystem.

### 2.3 The expansion path

`chunk-304awr1a.js` (35,905 B, 9 exports, 4 consumers) is the slash/skill **expansion** chunk and the
campaign has never named it. Its `xBn` is the hook call site:

```js
async function xBn(e,o,t){
  let l = o ? `/${e.name} ${o}` : `/${e.name}`;
  for await (let u of Ldt(e.source==="mcp" ? "mcp_prompt" : "slash_command",
                         e.name, o, e.source, l, he(t).mode, t)) {
    if(u.blockingError){ let S=`UserPromptExpansion operation blocked by hook:\n${…}`;
      return {blocked:{ … shouldQuery:!1 …}} } … } }
```

and `Re(e,o)` is the rendering rule:

```js
function Fe(e,o){ return [`<${bp}>${e}</${bp}>`, `<${Sg}>/${e}</${Sg}>`,
                          o?`<command-args>${o}</command-args>`:null].filter(Boolean).join("\n") }
function Re(e,o){ if(e.userInvocable!==!1) return Fe(e.name,o);
  if(["skills","syncedSkills","plugin","mcp","memoryStore"].includes(e.loadedFrom))
      return hpr(e.name, e.progressMessage);
  return Fe(e.name,o) }
```

**Five `loadedFrom` layers** — `skills`, `syncedSkills`, `plugin`, `mcp`, `memoryStore` — plus the
`source` axis (`builtin`, `bundled`, `plugin`, `mcp`, `project`, `user`). The `hooks-slash` scenario
covers exactly one cell (`slash_command` / `project`); `mcp_prompt` is uncovered and needs an MCP server
that advertises prompts.

`Ndt` (the usage counter, §3.4) fires from two of this chunk's paths, before the command runs.

### 2.4 What the corpus reaches

| scenario | what it drives | what it grades |
|---|---|---|
| `hooks-slash` (w5) | project `.claude/commands/reforgeprobe.md` via `settingSources:["project"]` | `UserPromptExpansion` payload: `expansion_type`, `command_name`, `command_args`, `command_source`, `prompt` |
| `slash-compact` (m2c) | `/compact` after six filler turns | `compact_boundary` and the compaction chain (W4's) |
| `hooks-session-end` (w5) | `/clear` | SessionEnd; W9 §2.5 measured the storage sequence |
| `hooks-memory` (w5) | `#`-memory, not a slash command | `InstructionsLoaded` |

That is **two builtin commands out of ~28 admitted, one of five `loadedFrom` layers, and zero of the
`prompt` factories other than `project`**. Nothing grades `krr`, `sz`, `oX`, the reserved-spelling
sets, or the alias resolution.

---

## 3. Skills

### 3.1 The loader

`grr()` (`chunk-fy12d89p.js`, 1,005 B) is `getSkills` — it fans out four sources and logs
`getSkills returning: ${d.length} skill dir commands, ${_.length} plugin skills, ${C.length} bundled skills, ${A.length} builtin plugin skills`
(**1× bundle-wide**), returning `{skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills, trustedNamesFailedToLoad}`
and degrading each source independently (`cmd_load_skill_dir_failed`, `cmd_load_plugin_skills_failed`).

| source | fn | B | discovery |
|---|---|---|---|
| skill directories | `uqe` (memo, 128) → `RMn` (2,631) | 2,759 | `<config>/skills`, `<managed>/.claude/skills`, and every project root from `vG("skills", …)`; logs `Loading skills from: managed=…, user=…, project=[…]` (**1×**) |
| plugin skills | `dpt` | 2,433 | `t["skills"\|"skillsV5"] ??= …` over enabled plugins |
| bundled skills | `One` in `chunk-vtkm0ky0.js` | 138 (chunk 5,721, 12 exports) | the embedded `.md`/`.md.zst` assets |
| builtin plugin skills | `hNt` | 168 | — |
| MCP skills | `fetchMcpSkillsForClient` in `chunk-43sxxg48.js` | chunk 11,674, 5 exports | MCP **resources** become skills, behind `mu()` = `tengu_mcp_skills` (**default false**) |
| synced skills | `Fzn` class | 19,611 | a watcher + per-scope (`team`/`user`) store with resync/delete-confirm timers |

The memo key is `` `${Pz()}:${Iw()}:${c5()}:${Uj()}:${e}:${raw|v5}` `` — five axes, so a contract test
has a defined invalidation surface.

### 3.2 The `Skill` tool

`q4e` (`chunk-fy12d89p.js`, **7,284 B**, @2050322), `name: Do` where `Do = "Skill"`
(`chunk-bqw67h0a.js`), `isEnabled(){ return aht() }` = `!Eg()`. It is the **largest single tool object
in the wave** and about as large as `Workflow`'s.

Its refusal surface is a numbered error-code matrix — thirteen codes across `validateInput` and `qdt`:

| code | reason | condition |
|---|---|---|
| 1 | empty name | `skill` trims to `""` |
| 2 | not found | plus a Levenshtein-2 "Did you mean …?" via `Gee` |
| 2′ | directory-scoped variants | `Directory-scoped variants exist: … — invoke the variant whose directory contains the files you are working on.` |
| 4 | `disable_model_invocation` | frontmatter opt-out, unless the user typed it this turn |
| 5 | `not_prompt_type` | "`X` is a **UI** / **built-in CLI** command, not a skill" |
| 7 | `override_disabled` | `skillOverrides` setting, `disableBundledSkills`, or `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`; carries `killSwitchOnly` |
| 8 | `not_allowlisted` | the session skills allowlist — set by `initialize`'s `skills` field (§1.7) |
| 9 | fork recursion | already executing in this forked context |
| 10 | not materialized | download failed |
| 11 | `deny_rule` ×2 | a permission rule on `Skill` or `Skill(<name>)` |
| 12 | `mcp_prompt` | "`X` is an MCP prompt, not a skill" |
| 13 | sync vetoed | `syncedSkills` + `kG()` |

`qdt` (1,793 B) holds codes 4/5/7/8/11/12; `validateInput` holds 1/2/9/10/13. Every one of them is a
single-turn, single-session, deterministic recording, and **none is covered today**.

Beyond validation, `eIn` (3,685 B) is the invocation/telemetry path (`W1({rawName, canonicalName, isMcp,
isBuiltIn, isBundled, isOfficial})` produces the sanitized name + hash used in every skill event), and
`$Ft` (2,677 B) is the **forked-skill subagent dispatch** — a skill with `context:"fork"` runs as a
subagent, which is a real edge into C15/W12.

### 3.3 The region, measured

Two dense, contiguous regions in the engine chunk:

- **Skills belt**: offsets **2,019,000–2,058,000** — 95 top-level declarations, **37,960 B declared,
  97.3 % density**. Contains `uqe`/`RMn` (discovery), `Yne`/`ua` (resolution), `qdt` (gating), `eIn`
  (invocation), `$Ft` (fork dispatch), `q4e` (the tool), `Ndt`/`Tqn`/`WIe`/`xft`/`Yx` (usage + session
  state).
- **Command / plugin-loading belt**: offsets **3,310,000–3,495,000** — 585 declarations, **181,873 B
  declared, 98.3 % density**. Contains the whole command registry, `frr`/`xae`/`oI`/`bte`/`prr`,
  `krr`/`sz`/`Rce`/`k0t`/`oX`, `grr`, plugin command/skill loading (`RSe` 3,440 B, `dpt` 2,433 B), the
  synced-skills store (`Fzn` 19,611 B), and two large **embedded prompt assets** (`her`, the 21,895 B
  `/init` prompt; `Ker`, the 10,779 B `security-review` markdown) that are data, not logic.

### 3.4 The usage counter, and why W9 needs to know

```js
class xft{ commandMatcherIndex=null; internalOnlyCommandNames=void 0; directoryScanCache=Pft();
           pathScanCache=Pft(); shellHistoryCommands=null; shellHistoryLoadedAt=0;
           slackChannelsByQuery=new Map; knownSlackChannels=new Set; knownSlackChannelsVersion=0;
           knownSlackChannelsChanged=Ue(); skillUsageLastWriteAt=new Map; skillInvoked=Ue() }
var Yx=new Ln(()=>new xft);  var DMn=60000;
function Ndt(e,t,r){ let o=Yx.of(e); o.skillInvoked.emit(t);
  let u=Date.now(), d=o.skillUsageLastWriteAt.get(t);
  if(d!==void 0&&u-d<DMn) return;                      // 60 s per-session debounce
  o.skillUsageLastWriteAt.set(t,u),
  Ae((_)=>({..._, skillUsage:{..._.skillUsage,[t]:{usageCount:(_.skillUsage?.[t]?.usageCount??0)+1,lastUsedAt:u}}}), r) }
function Tqn(e,t){ … {usageCount, daysSinceUse} }
function WIe(e){ let r=oe().skillUsage?.[e]; if(!r) return 0;
  let o=(Date.now()-r.lastUsedAt)/86400000, u=Math.pow(0.5,o/7); return r.usageCount*Math.max(u,0.1) }
```

`xft` is **W11's module-level state** (§2.1's declaration requirement): a per-session holder behind
`Ln`, carrying a command matcher index and two scan caches as well as the usage bookkeeping. `WIe` is
the 7-day half-life ranking score with a 0.1 floor — `docs/parity/parity.json` row 17.11 calls this
"internal CC ranking telemetry … out of scope for headless parity", which was true of the *ranking* and
is not true of the *write*: the write lands in `.claude.json` on the headless path, on every prompt-type
slash command and every `Skill` call.

---

## 4. Shared cores and edges

### 4.1 Pre-sorted per §2.4

| edge | direction | evidence |
|---|---|---|
| `subsystem/session-storage` (C12/W9) | **W11 → W9** | `Ndt` writes `skillUsage` into `.claude.json` through the same config writer W9 owns; the counter is monotonic across runs (measured: `reforgeprobe.usageCount: 155`) and **must be normalized or reset** before the config half of the state-surface diff can grade any slash/skill scenario. Also `/clear`'s command body (`BJt`, `chunk-ht7zfm7n.js`) is a slash command whose whole content is a storage sequence — W9 §2.5 already measured it. |
| `subsystem/permissions` (C9/W6) | **W11 → W6** | the projected MCP tool's `checkPermissions` produces the `ask`/`passthrough` pair W6's chain consumes at the MCP ask ceiling; `mcpInfo` is the field the plan-mode pre-check keys on; `qdt`'s code-11 reads `Skill` and `Skill(<name>)` deny rules; `set_mcp_permission_mode_override` is a per-server mode axis W6's mode matrix does not have. |
| `subsystem/hook-dispatch` (C8/W5) | **W11 → W5** | W5 owns `Ldt` (`UserPromptExpansion`), `JSe` (`Elicitation`), `QSe` (`ElicitationResult`) and `EE` (`Notification`); **W11 owns all four call sites**. Three of the four are unreached, and W5's ledger row cannot close on the two elicitation events without W11's probe. |
| `subsystem/control-protocol` (C10/W7) | **W11 ↔ C10** | ten MCP subtypes + `reload_skills` + `register_repo_root`'s `reload_skills` leg; the `initialize` arm's MCP/skills prologue sits *outside* the C10-owned `Ey`. |
| `subsystem/subagent-dispatch` (C15/W12) | **W11 → W12** | `$Ft` dispatches a forked skill as a subagent (`spawnedBySkill`, `spawnedByForkedSkill`, `context:"fork"`). |
| `subsystem/moat-tools` (C11/W8) | **W11 ↔ W8** | `/list-agents` and `ListAgents` share `Yo()`; `/plugin-types` writes a `.d.ts` of the connected MCP tools; C11d's cross-session route reaches `register_repo_root`, whose `reload_skills` leg is W11's. |
| `subsystem/environment-and-system-prompt` (C6) | **W11 → C6** | `capMcpInstructions` puts each server's `instructions` into the prompt; `npt(tools, serverName, …, instructions)` registers them; the skill catalogue renders into the `Skill` tool's `prompt()` via `ogt(gn())`. |
| §1.2 exclusions inside W11's chunks | — | the two in-process transports (Chrome, Computer-Use), the whole first-party design-consent family, `claudeai-proxy`, the OAuth endpoints, `sse-ide`/`ws-ide`. |

### 4.2 What W11 sits on that nobody owns

`chunk-25pekgrs.js` (317 KB, the vendored MCP SDK + ajv) and `chunk-h5an0epa.js` (107 KB, zod) are §1.2
vendored-library exclusions — engine-ts imports `@modelcontextprotocol/sdk` and `zod` directly, both of
which are **already in `reforge/node_modules`**. That is the single cheapest assembly story of any wave:
the adapter is genuinely thin over packages the harness already has.

---

## 5. Anchors and captures

All counts over the full **1,802-file** module set, `—` written in source-escape form per the W8
scout's rule (verified again here: `" — available with Claude for Enterprise"` counts **1** as an
escape and **0** as a character).

### 5.1 MCP — every candidate ties 2×, and this is the wave's mechanism finding

| count | anchor | target |
|---|---|---|
| 2 | `"SDK servers should be handled in print.ts"` | `connectToServer`'s `sdk` arm |
| 2 | `"is blocked by managed policy"` | `ensureConnectedClient` |
| 2 | `" is disabled — re-enable it via /mcp to use its tools"` | `ensureConnectedClient` |
| 2 | `"which the Anthropic API does not accept"` | `hydrateToolsFromListing`, normalize stage |
| 4 | `"Skipping tool \""` | `hydrateToolsFromListing`, both drop stages |
| 5 | `"MCPTool requires permission."` | the projected tool's `checkPermissions` (2 per generation + 1 elsewhere) |
| 2 | `"MCP endpoint not found at "` | `connectToServer`'s http 404 mapping |
| 2 | `"Failed to connect SDK MCP server: "` | `setupSdkMcpClients` |
| 2 | `"Received elicitation completion notification: "` | `registerElicitationHandler` |
| 2 | `"MCP server \"${t}\" confirmed elicitation"` | the completion `Notification` site |
| 3 | `"anthropic/requiresUserInteraction"` | the `_meta` read (+1 in `chunk-xjgqw3nt.js`) |

**Nothing in the MCP client, the elicitation implementation, or the auth module is uniquely anchorable
by prose.** Every splice needs a `coLiteral` scoped to `chunk-1bxday80.js` (or an equivalent file
selector), and the manifest's `coLiteral` must be checked to be *file*-scoping rather than
*node*-scoping before the wave is dispatched. The honest framing: this is not an anchor-weakness
finding, it is an **anchor-ambiguity** finding, and the failure mode is a splice landing in the dead
generation — silent, because the dead arm never runs and the gate stays green.

Uniquely-anchorable MCP targets exist only **outside** the forked chunks:

| count | anchor | target |
|---|---|---|
| 1 | `"mcp runtime arm: "` | `bT` (`chunk-cr9f4adc.js`) |
| 2 | `"MCP runtime accessor tripwire: resolved generation is"` | the accessor (both arms, one file — a `coLiteral`-free tie inside one chunk, so `signature` selection works) |
| 1 | `"Elicitation request received in print mode: "` | the headless elicitation registration `ns` |
| 1 | `"The permission prompt tool is no longer available"` | `pf` |
| 1 | `"initialize: sdkMcpServers and webSearchIsolationExemptMcpServers must be arrays of strings"` | the `initialize` MCP prologue |
| 2 | `"is already registered; its timeout change is ignored until the server is removed and re-added"` | same (+1 in `chunk-kje2nmp8.js`) |
| 1 | `"resources/read returned -32601 MethodNotFound"` | `ReadMcpResource.call` |
| 1 | `"advertises resource support but does not implement resource reads"` | same |
| 1 | `"Lists available resources from configured MCP servers."` | `ListMcpResources.description` |
| 2 | `"MCP tool requires user interaction; not supported via --permission-prompt-tool"` | `pf` (+1 in `chunk-af80z9sa.js`) |

### 5.2 Slash and skills — clean, all in one chunk

| count | anchor | target |
|---|---|---|
| 1 | `"Loading skills from: managed="` | `RMn`, skill discovery |
| 1 | `"getSkills returning: "` | `grr` |
| 1 | `" tool due to disable-model-invocation"` | `qdt` code 4 |
| 1 | `"is not in this session's skills allowlist"` | `qdt` code 8 |
| 3 | `"by the disableBundledSkills setting or CLAUDE_CODE_DISABLE_BUNDLED_SKILLS env var"` | `qdt` code 7 (three arms of one template — a same-node tie, `selectExcision`'s known wrinkle; use the longer `"and by an explicit skillOverrides entry"` variant, or `signature`) |
| 1 | `"Directory-scoped variants exist: "` | `Skill.validateInput` |
| 1 | `"is already executing in this forked context"` | `Skill.validateInput` code 9 |
| 1 | `"is an MCP prompt, not a skill."` | `qdt` code 12 |
| 1 | `"Skill directory commands failed to load ("` | `grr`'s degrade arm |
| 1 | `"skill_invoke_not_materialized"` | `Skill.validateInput` code 10 (structural, telemetry literal) |
| 1 | `"reserved for explicit user invocation"` | `qdt` code 4 tail |
| 1 | `"UserPromptExpansion operation blocked by hook:"` | `xBn` (`chunk-304awr1a.js`) |
| 1 | `"Start a new session with empty context; previous session stays on disk"` | `/clear`'s descriptor |
| 1 | `"Restore the code and/or conversation to a previous point"` | `/rewind`'s descriptor |
| 1 | `"Write claude-code-mcp.d.ts: the inputs of the connected MCP tools"` | `/plugin-types`'s descriptor |
| 1 | `"Pick up skills added or changed on disk during this session"` | `/reload-skills`'s descriptor |
| 2 | `"Show which loaded skills are unused and costing context"` | `/skill-doctor`, both twins in one chunk — `signature` selects |
| 1 | `" moved to /config"` | `gDt` |
| 1 | `" — available with Claude for Enterprise"` | `T0` |
| 1 | `"ask your admin about migrating from API-key access"` | `T0`'s upsell body |

**Genuinely unanchorable after enumeration**: `k0t` itself (111 B, no literals at all — it is pure
property reads; it must be taken by `signature` + `coLiteral` on its neighbour `Rce`/`oX`, or folded
into the module that owns the filter), `Rce` (54 B, same), `Xve` (100 B), `SD` (167 B), `Ndt` (301 B —
its only literals are property names), `Tqn`, `WIe`. Six of the seven are 50–300 B and all seven are in
`chunk-fy12d89p.js`; they are fold-ins to a single owned `command-filter` / `skill-usage` module rather
than seven separate rows.

### 5.3 Captures, per §2.4's taxonomy

Spot-checked on the targets a first increment would take:

- `k0t` — **zero free variables**. The cleanest splice in the wave.
- `Rce` — one (`Eg`, a host launch-option reader): `effectful-port`.
- `SD` — five (`bE`, `E$t`, `hI`, `tre`, `pu`), all with many in-chunk callers: five `pure-helper`.
- `Ndt` — three (`Yx` module state, `DMn` the 60 s constant, `Ae` the config writer): one
  `effectful-port` (→ W9's config port), one `primitive`, one `effectful-port`.
- `qdt` — nine, dominated by settings/permission readers (`Je`, `cle`, `QN`, `fz`, `_s`, `zS`, `UEe`,
  `Kjt`, `$Ee`): two ports (settings, permission context) + seven helpers. This is the wave's densest
  capture set and the reason `qdt` wants a port rather than a method splice.
- `bT` — two (`a` the env object, `I` the gate reader) + the module-level latch `o`: two
  `effectful-port` and a piece of state that **must** go behind the port, because the latch is the
  thing that makes the generation decision observable exactly once.

---

## 6. Coverage and budget

### 6.1 What the corpus reaches today

- **Executed**: `mcp__reforge__echo_token` end-to-end over the **SDK** transport (`mcp-tool`, 4
  cassettes, catalog of 23); `/clear` (`hooks-session-end`); `/compact` (`slash-compact`); a project
  markdown slash command with its `UserPromptExpansion` payload (`hooks-slash`).
- **Rendered but never executed**: the `Skill` tool's description and JSON schema are in **all 267
  recorded request bodies** (`Skill` is in the baseline 22). Its `prompt()` renders the whole skill
  catalogue. That is the same free-lunch surface W8 found for the moat tools, and it is available with
  zero new recordings.
- **Nothing reaches**: any non-SDK transport, discovery, schema normalization, any `_meta` key, the MCP
  ask ceiling, elicitation in any form, resources/prompts, the resource tools, auto-backgrounding,
  nine of the ten MCP control arms' success paths, 26 of ~28 admitted slash commands, four of five
  `loadedFrom` layers, and **every one of the `Skill` tool's thirteen refusal codes**.

### 6.2 Firing conditions and honest cost

| arm | firing condition | cost |
|---|---|---|
| `Skill` refusal codes 1, 2, 2′, 5, 12 | one turn asking for a nonexistent / UI-only / MCP-prompt skill name | **1 recording**, deterministic |
| `Skill` codes 4, 7, 8 | a `.claude/skills/<n>/SKILL.md` with `disable-model-invocation`; `skillOverrides` via `Options.settings`; `skills:[…]` on `initialize` | **1–2 recordings**; all three are settings/option axes, no filesystem write beyond the skill file |
| `Skill` code 11 | a `deny: ["Skill(foo)"]` rule | **1 recording** (and note C9's finding: a *whole-tool* deny removes the tool instead) |
| skill discovery + `getSkills` degrade arms | seed `.claude/skills/` with one good and one unparseable `SKILL.md` | **1 recording** |
| `/model`, `/context`, `/usage`, `/mcp`, `/agents`, `/reload-skills` | drive each as a prompt; all are `Le()`-gated and therefore **headless-only** | **1 recording** for a batch of three or four in one session |
| MCP schema normalization + the drop arms | an **SDK** server whose tool declares a top-level `anyOf` | **1 recording**, and it is the cheapest MCP behavioural cell in the wave |
| `_meta` keys | an SDK server tool with `_meta:{ "anthropic/requiresUserInteraction":true }` → forces the `ask` ceiling; `alwaysLoad`, `searchHint`, `maxResultSizeChars` are catalog-visible | **1 recording**, graded on the request body and the permission frame |
| MCP resource tools | an SDK server declaring `capabilities.resources` → `ListMcpResources` + `ReadMcpResource` appear in the catalog | **1 recording**; `ReadMcpResourceDir` stays gate-dead |
| MCP prompts-as-commands + `expansion_type:"mcp_prompt"` | an SDK server declaring prompts, then `/mcp__<server>__<prompt>` | **1 recording**, closes the second `UserPromptExpansion` cell |
| **Elicitation** (2 hook events + 2 `Notification` types) | a **stdio** MCP server that elicits — **not** an SDK one (§1.6's guard) | **probe first** (§6.3), then 1–2 recordings |
| `mcp_call`, `mcp_status`, `mcp_set_servers`, `mcp_toggle`, `mcp_reconnect`, `mcp_clear_auth` success arms | the raw-protocol driver with a live stdio server; W7's probe already reached all six refusal arms | **1 probe + 1–2 recordings**, gated on the stdio probe |
| `pf` / `--permission-prompt-tool` | see §6.4 | **probe**, then 1 recording if it settles |
| OAuth (`mcp_authenticate`, `mcp_oauth_callback_url`) | a local stdio server returning 401 reaches the client-side classification; the redirect leg does not | **1 recording** for the classification, exclusion for the rest |

**Total: 11–14 new recordings**, of which 8 need no new harness capability, 3–4 are gated on the stdio
probe, and one is gated on the permission-prompt-tool probe.

### 6.3 Probe design — `reforge/w11/probe-mcp-transport.ts`

The wave's single unknown is whether a **stdio** MCP server is driveable under the harness. Everything
expensive in §6.2 hangs off it. Four phases, one session each, serialized through the orchestrator per
X5, three-valued verdict per phase (FIRED / DEAD / OPEN with a written reason), following the W7
control-subtype probe's shape:

1. **Phase A (dial).** Write a `.mcp.json` (or pass `mcpServers` with `{type:"stdio", command:"bun",
   args:[<fixture server>]}`) naming a tiny fixture MCP server committed under `reforge/w11/fixtures/`.
   Assert `connectToServer`'s stdio arm ran: the engine logs
   `Successfully connected (transport: stdio) in <n>ms` and registers the child under `mcp_stdio`.
   Verdict decides everything below. **The one live check that sizes this wave.**
2. **Phase B (elicitation).** The fixture server elicits on its first tool call. With an `Elicitation`
   hook registered, assert the hook fires and its return value becomes the elicitation response; with
   none registered, assert the `ElicitationResult` + `Notification` path runs against
   `t.handleElicitation`. **Also run the same phase with an SDK server and assert it does NOT fire** —
   that negative is the evidence for the `T.config.type==="sdk"` exclusion, and without it the
   exclusion is an assertion about code rather than a measurement.
3. **Phase C (discovery + schema).** The fixture declares one clean tool, one with a top-level `anyOf`,
   one with an invalid property key, one with each `_meta` key, and `capabilities.resources`. Grade the
   presented catalog and the `tengu_mcp_degraded` reasons. Most of this phase also runs on the SDK
   transport, so it should be *authored* SDK-first and re-run on stdio.
4. **Phase D (control arms).** Through the raw-protocol driver, send `mcp_status`, `mcp_toggle`,
   `mcp_reconnect`, `mcp_call`, `mcp_message`, `set_mcp_permission_mode_override` against the live
   server and classify each success arm. Note that `mcp_message` answers `success` for an unknown
   server, so its negative control must assert the *absence* of the transport push, not the response.

Normalization the probe owes the differ: MCP child pids, socket/stdio paths, `elicitationId`,
`connectionDurationMs`, `listDurationMs`, and `skillUsage.*.{usageCount,lastUsedAt}` (§0.6).

### 6.4 Probe design — `pf` / the permission-prompt tool

The brief's premise — "dead headlessly under the SDK" — is **half right, and the other half is a
scenario.** The guard is `Ty(e, …)`:

```js
function Ty(e,t,r,o,_){
  if(e==="stdio") return t.createCanUseTool(o);                     // ← the Agent SDK's own value
  if(!e) return async(…)=>{ … plain chain + emitPermissionDenied }  // ← no flag at all
  … v=pf(se, …)                                                     // ← a named MCP tool
}
```

So `pf` is unreachable **because the SDK passes `--permission-prompt-tool stdio`**, not because the
headless seam lacks the surface. `reforge/m2/raw-protocol.ts` already drives the engine over raw stdio
without the SDK wrapper; adding the flag there with a fixture MCP server that exposes a permission-prompt
tool reaches `pf`, its three startup refusals
(`PERMISSION_PROMPT_TOOL_NOT_FOUND{,_NO_MCP_TOOLS}_TELEMETRY_MESSAGE`, `…_NOT_MCP_…`, each of which
writes to stderr and `exit(1)`), the schema-invalid deny, and the
`requiresUserInteraction` deny. **Verdict to record: not dead, driver-gated.** Cost: 1 probe phase +
1 recording. Whether the campaign wants it is a scope call; the reachability claim should be corrected
either way.

### 6.5 OPEN-by-construction, with the guards

- **The v2 MCP generation** (193,087 B). `bT()` returns `"v1"` unless `MCP_SDK_GENERATION` is set or
  `tengu_brindle_causeway` (compiled-in default `false`, 1 site) is true. Reachable only through a
  declared env override; recorded as an exclusion *with a named lever*, not as dead code.
- **`ReadMcpResourceDir` and MCP-resources-as-skills.** `mu(){ return I("tengu_mcp_skills",!1) }`;
  default `false`; not among the fixture's 13 per-gate env overrides.
- **`/import`.** `nX(){ return I("tengu_import",!1) }`, and the command's own fallback string says so:
  "`claude import` is not yet available in this build."
- **`/pause-memory`, `/version`, `/update`.** `isEnabled: ()=>!1` — three commands that pass `k0t` and
  can never run.
- **The C4E upsell commands** (`ultraplan`, `teleport`, `remote-control`, `schedule`, …). `T0` sets
  `supportsNonInteractive:!1` **and** `HLt()` includes `!Le()`; doubly interactive-only.
- **Elicitation on an SDK MCP server.** `ns`'s `if(T.config.type==="sdk") continue` (§1.6). This is the
  one that must be *measured* rather than asserted — see Phase B's negative.
- **`sse-ide` / `ws-ide`.** Both require an IDE-supplied URL and auth token; `tengu_mcp_ide_server_connection_*`
  telemetry is their only trace.
- **The first-party design-consent family and `claudeai-proxy`.** `pr()` gates the proxy on a
  first-party base URL, which a run pointed at the record/replay proxy cannot satisfy — the same
  mechanism the README documents for `ToolSearch` and `CLAUDE_CODE_LUMINOUS_WHISTLE`.
- **The two in-process MCP servers** (Chrome, Computer-Use). §1.2 periphery; both behind
  `OH(name)` / `C6(config)&&F6(name)`.

---

## 7. Parent-impact list

### 7.1 Campaign spec (`docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`)

| claim | measured |
|---|---|
| §1.1: "MCP adapter (thin layer over the vendored MCP SDK) · high · `4mp04j81`, `1bxday80`" | Those are **v2 and v1 of one module**, selected at runtime by `bT()`. The layer is **8 forked module pairs + 1 unforked**, 187,877 B live / 193,087 B dead, plus the accessor (6,549), the selector (1,427), the MCP-skills fetcher (11,674) and the client helpers (7,976). "Thin over the vendored SDK" survives and is the wave's best news (§4.2); "high seam quality" does not — every prose anchor ties across the fork (§5.1). |
| §1.1: "Slash commands + skills loading · high · `fy12d89p` @10–12.5k + `g461tywa`" | Both halves wrong. The offsets that correspond to pretty-lines 10–12.5k are ≈295–363 KB, which is prompt-expansion and LSP-plugin code, not commands. The real belts are offsets **2,019–2,058 KB** (skills, 37,960 B declared) and **3,310–3,495 KB** (commands + plugin/skill loading, 181,873 B declared), plus `chunk-304awr1a.js` (35,905 B, the expansion path, never named anywhere). `chunk-g461tywa.js` is a **302 KB / 198-export / 32-consumer** grab-bag — not an S-chunk candidate and not primarily a commands chunk. |
| §1.3: "the engine presents 31 native tools headlessly" (as corrected by W8 to "22 baseline, 32 union") | Still incomplete. Three further catalog tools exist — `ListMcpResourcesTool`, `ReadMcpResourceTool`, `ReadMcpResourceDirTool` — which `bE` filters out of the natives and `setupSdkMcpClients` re-adds via the MCP list when a server advertises resources; plus `RefreshMcpTools` behind `CLAUDE_CODE_ENABLE_REFRESH_MCP_TOOLS`; plus the unbounded `mcp__*` projection; plus `skillTools`. The catalog has **three contributors**, not one, and `SD` sorts them in two groups. |
| Deferred section: "`mcp_message` (`QKn`, 58 B) is one line into the MCP transport and belongs with W11" | True of `QKn`, and it routed 1/120th of the surface. Ten MCP control subtypes total **13,051 B** of arm; `reload_skills` and `register_repo_root`'s `reload_skills` leg are W11's too. |
| §6 W11 row: "S-method/S-chunk · mcp/skills scenario families" | S-chunk is available (`chunk-vtkm0ky0.js`, 5,721 B / 12 exports, bundled skills; `chunk-x2zggfer.js`, 1,809 B / **1 export**, the MCP skills page — a smaller single-export target than W8's `ListAgents`). S-method is **blocked on a `coLiteral` decision** for every MCP splice (§5.1). And the wave has a stateful core (`bT`'s latch, the dial memo, `xft`) that is §2.3 shaped. |
| §3.3's override inventory as "the measure of the operator-steering surface" | Misses `MCP_SDK_GENERATION`, which is not a gate override at all but an env arm that **precedes and bypasses** the gate. The W8 scout found the same extractor blind spot from the other side (`return Me(e)`); this is a second, structurally different miss. |
| C9 Revision Note: "the pre-check's plan refusal is guarded on `e.mcpInfo` and a built-in file tool never reaches it" | Confirmed and now sourced: `mcpInfo` is constructed in `hydrateToolsFromListing` and exists only on projected MCP tools. |

### 7.2 Census (`reforge/research/2026-08-31-engine-census.md`)

| claim | measured |
|---|---|
| L53 "MCP integration … `4mp04j81` (136 KB **transports**), `1bxday80` (131 KB **call+validate**)" | The split is fictional: the two chunks are the same module, one generation apart, and each contains transports *and* call *and* validate. This is the reading the spec inherited. |
| L58 "Slash commands … `fy12d89p` @10–12.5k, @35.9k; `q4xe0m2r`; `4k4029wq`; `ym91g959` · ~120 KB" | `q4xe0m2r` is the sandbox chunk (W12's, per §1.1's own sandboxing row). The offsets are wrong (above). The expansion chunk `304awr1a` is absent. |
| L59 "Skills … `fy12d89p` @23.5k, @52k, @56–58k, @100k; `g461tywa` (302 KB) · ~300 KB" | The skills belt is one contiguous 39 KB region at 2,019–2,058 KB, not four scattered ones; `g461tywa` is a grab-bag; the "60 embedded `.md`/`.md.zst` skill assets" observation is right and is the only part that should survive verbatim. |
| No row for the MCP **elicitation** layer, the **runtime accessor / generation fork**, the **MCP control-protocol arms**, or the **MCP resource tools** | ~30 KB of load-bearing client logic and the switch that selects between two 190 KB implementations are uncounted. |

### 7.3 W8 scout (`reforge/research/2026-09-02-w8-moat-tools-scout.md`)

- §1.1: "`SD` (@2433745, 167 B) **merges MCP tools and sorts by name**." Measured: `SD` sorts natives
  and MCP+skill tools **separately** and concatenates, and `bE` first **removes** four names
  (`ListMcpResourcesTool`, `ReadMcpResourceTool`, `ReadMcpResourceDirTool`, `StructuredOutput`) from the
  natives. The `mcp-tool` cassette's ordering is evidence for the two-group shape.
- §1.1: "`Y0()` … 67 top-level array elements". Confirmed; adding that four of them are MCP tools and
  one is `skillTools`-adjacent would make the proposed `tool-catalog-2.1.251.json` fixture complete.
- Its "Not W8's" list routes `Skill` to C14 — correct, and now sized: 7,284 B with a thirteen-code
  refusal matrix, not a formatter.

### 7.4 W9 scout / C12a (`…w9-session-storage-scout.md` §4.2)

The config-snapshot include-list names `.claude.json`. **`skillUsage` must be normalized or the
snapshot will never be byte-stable across two replays** — the counter increments once per prompt-type
slash command and once per `Skill` call, is 60 s-debounced per session but *not* reset between runs, and
stands at 155 today from the W5 probe alone. Either add it to the differ's value-scrub list or have
`resetSandbox()` clear it; C12a's acceptance criterion "the config snapshot is byte-stable across two
replays" cannot pass otherwise once any slash/skill scenario is in the corpus.

### 7.5 Ledger and fixtures

- `subsystem/mcp-adapter` and `subsystem/slash-commands-and-skills` both have **empty `edges`**. §4.1
  lists eight measured edges between them.
- **No rows for** `tool/ListMcpResources`, `tool/ReadMcpResource`, `tool/ReadMcpResourceDir`,
  `tool/RefreshMcpTools`, or the `mcp__*` projection family. X2 says one row per headless catalog tool;
  three of these reach the catalog under a condition an SDK scenario can create today.
- `research/fixtures/gate-defaults-2.1.251.json` — see §7.1's last row. Hand the extractor widening to
  whoever owns C3's fixture, as W8 did; do not patch it inside a wave.
- `research/fixtures/symbol-map-2.1.251.json` has **no entry for `chunk-1bxday80.js` / `chunk-4mp04j81.js`**
  despite both carrying 112–121 self-declared semantic names, and none for `chunk-dvbbv89q.js`'s 63.
  Three chunks in this wave name their own API; `research/tools/symbol-map.ts` should harvest
  `export{X as Name}` aliases, which is a strictly larger and more reliable source than whatever it
  uses today.

### 7.6 `docs/parity/coverage.md`

Row 17.11 ("Per-skill usage tracking (7-day half-life ranking signal)", verdict `not-possible`,
targetPhase `non-goal`) is right about the *ranking* and wrong about the *write*: `recordSkillUsage`
lands in `.claude.json` on the headless path from two slash-command sites and the `Skill` tool. The
verdict should stay `non-goal` for the ranking and gain a note that the persistence side is in scope as
a storage-determinism concern.

---

## 8. A proposed cut for C14 (advisory)

**One wave or two?** **One family, three children — and the reason is measured, not aesthetic.** The
three surfaces are not adjacent by topic; they are wired together in four places: `Eg()` is a single
host switch that disables both the slash surface (`Rce`) and the `Skill` tool (`aht`); MCP prompts enter
the *command* registry as `loadedFrom:"mcp"` and are expanded by the same `xBn` with only
`expansion_type` differing; MCP *resources* enter the *skill* list through `fetchMcpSkillsForClient`;
and `initialize` configures `sdkMcpServers`, `skills` and the command surface in one arm. A cut that
put MCP in one wave and slash/skills in another would split `xBn`, split `SD`, split the `initialize`
prologue, and split `qdt`'s `mcp_prompt` refusal. What *should* be separated is not the topics but the
**mechanisms**: one child that needs no new machinery, one that owns the probe, one that owns the
stateful adapter.

### C14a / W11a — the command-and-skill filter belt (autonomous, opus-tier)

**Purpose.** Take the part of the wave that is pure, uniquely anchorable, and inside one chunk.
**Scope.** (1) The **artifact-derived enumeration**: `research/tools/extract-slash-commands.ts` →
`research/fixtures/slash-commands-2.1.251.json`, one row per registry element with name, aliases, type,
`supportsNonInteractive` / `disableNonInteractive`, `isEnabled` source text, `isHidden`, load thunk
chunk, and the `k0t` verdict — the eighth pin-keyed fixture, gate-checked per run, derived from `frr()`
rather than hand-listed (this is C8's "derive the enumeration from the artifact" applied to the
campaign's next "what is the complete set of X"). (2) The filter core as one owned module:
`k0t` (0 captures), `Rce`, `Xve`, `SD`, `krr`, `sz`, `oX` — seven functions, ~1.6 KB, all fold-ins
rather than seven rows. (3) The skill-usage module: `Ndt`, `Tqn`, `WIe`, with `xft`'s usage fields
behind a port to W9's config writer.
**Observable acceptance.** Every splice solo-sabotaged RED on a named scenario; the fixture's row count
gated; a contract test over `k0t` × the fixture population (this is the wave's cheapest non-vacuity
instrument — a filter with a complete enumeration is exactly the shape C9's branch attestation wanted);
the `skillUsage` normalization landed and C12a's byte-stability criterion re-checked.
**Edges.** → C12/W9 (the config write). **Anchors.** All §5.2, all 1×. **Recordings.** 1 (a batch
session driving three or four `Le()`-gated commands, which converts the "headless-only slash surface"
from a reading into a graded fact).

### C14b / W11b — reachability probes and the recordings they justify (controlled, opus-tier)

**Purpose.** Settle stdio, settle elicitation, and buy the eleven behavioural cells that depend on them.
**Scope.** (1) `reforge/w11/probe-mcp-transport.ts` per §6.3, four phases, three-valued verdicts, with
the **SDK-negative** in Phase B. (2) A committed fixture MCP server under `reforge/w11/fixtures/`
(stdio and SDK builds of the same server: clean tool, `anyOf` tool, invalid-property-key tool, all four
`_meta` keys, `capabilities.resources`, `capabilities.prompts`, an eliciting tool). (3) The `pf` probe
per §6.4 through the raw-protocol driver. (4) The 11–14 recordings §6.2 justifies, in probe-ranked order.
**Observable acceptance.** Every MCP ledger row gains a verdict with a cited guard; the two OPEN hook
events in `research/fixtures/hook-registry-2.1.251.json` resolve to FIRED-with-stdio /
MEASURED-DEAD-with-SDK, each with its measurement; W7's two OPEN OAuth arms get a written boundary.
**Edges.** X5 (recordings serialize), → C8/W5 (the hook rows close here, not there).
**Track.** Controlled: it records and it adds a fixture server to the harness.

### C14c / W11c — the MCP adapter behind `McpClientPort` (fable-tier; cut when C14b lands)

**Purpose.** Own the live generation of the client, behind a designed port, with the fork made explicit.
**Scope.** `McpClientPort` over `chunk-1bxday80.js`'s lifecycle (`connectToServer`'s stdio + http + sse
arms, `ensureConnectedClient`, the dial memo with its identity-epoch eviction, `reconnectMcpServerImpl`,
`setupSdkMcpClients`); `hydrateToolsFromListing` as the **projection** — the highest-value single
function in the wave, and the one whose eight `tengu_mcp_degraded` cells give the mutation battery real
targets; the call path (`callMCPTool`, the retry, the error shaping, `processMCPResult` /
`transformMCPResult` / `transformResultContent`); the elicitation implementation (`chunk-5ww6p4vy.js`,
3,427 B, five functions — small enough to take whole); and a **generation guard** in the owned module
that reproduces the accessor's tripwire.
**Observable acceptance.** §3.1's S-module bar. Behavioural-partition matrix: transport × (clean /
normalized / dropped-schema / invalid-key) × (`_meta` present / absent) × (resources advertised / not) ×
(elicitation answered by hook / by host / cancelled) × (session expired once / twice). Mutation battery
per §3.1. **And one contract the other waves have not needed**: every splice's `coLiteral` must be
proven to select `chunk-1bxday80.js` and not `chunk-4mp04j81.js`, with a negative control that a
`coLiteral` pointed at the dead generation FAILS the build — because a splice that lands in v2 is green,
silent and wrong.
**Edges.** → C9/W6 (the ask ceiling), → C8/W5 (four dispatcher call sites), → C10/W7 (ten control arms),
→ C15/W12 (forked-skill dispatch), → C12/W9 (config).
**Dependency.** Needs C14b's probe and fixture server. **Risk to state plainly.** If Phase A says a
stdio MCP server cannot be driven under the harness, this child narrows to the SDK transport plus the
projection, and the transport matrix becomes an exclusion with the probe as its evidence.

### Also W11's, unplaced until C14b reports

The ten MCP control arms (13,051 B) — they are C10's *shape* and W11's *subject*, and the honest
placement is C14b for the probe and C14c for whichever arms turn out to have gradeable success paths.
The `Skill` tool object (7,284 B) and `qdt` (1,793 B) belong with C14a's fixture work by anchor quality
but with C14b by coverage, since twelve of the thirteen refusal codes need one recording each; recommend
they ride with C14b so the splice and its scenario land together.

### Not W11's

`chunk-25pekgrs.js` / `chunk-h5an0epa.js` (vendored SDK + zod, §1.2) · the two in-process MCP servers
(Chrome, Computer-Use — §1.2 periphery) · `claudeai-proxy` and the OAuth redirect leg (server boundary)
· the first-party design-consent family and `/design*` (product periphery) · `sse-ide` / `ws-ide` (IDE
integrations, §1.2) · the v2 generation (exclusion with a named env lever) · `chunk-g461tywa.js` (a
302 KB grab-bag; whichever wave needs one of its 198 exports takes that export, not the chunk) ·
`Ldt` / `JSe` / `QSe` / `EE` themselves (W5 owns the dispatchers; W11 owns the call sites).

---

## 9. Method notes worth keeping

- **A chunk pair with a strict export-subset relation and one shared consumer is a version fork, not a
  decomposition.** The tell took one `comm` over two sorted export lists and one `grep -l`. Any future
  census row that names two chunks of similar size for one subsystem should be checked this way before
  the sizes are added together — the campaign has been carrying 193 KB of dead twin as live surface.
- **`export{X as SemanticName}` is a first-class enumeration artifact, and three chunks in this wave use
  it.** `chunk-1bxday80.js` (112), `chunk-4mp04j81.js` (121) and `chunk-dvbbv89q.js` (63) name their own
  API in the module, which is *better* than W9's separate barrel because a pin bump re-derives it in
  place. The symbol-map extractor does not harvest these.
- **A filter's predicate must be read, not quoted.** W7.5's `k0t` reading was the second clause of a
  two-clause disjunction, and the missing clause was the default-admit one — so a surface that reads as
  "a few opted-in commands" is really "everything except an opt-out list". The general form: when a
  predicate is a disjunction, quoting one disjunct inverts the population.
- **A registration guard one level below the feature is where reachability actually lives.** The
  elicitation hooks look TUI-only (both `registerElicitationHandler` sites are React), then look live
  headlessly (`ns` in the print loop), and are finally decided by one line inside `ns` that skips SDK
  servers. Three readings, two of them wrong, all consistent with the same grep. The rule that survives:
  follow the registration to the *loop that calls it*, and read the loop's `continue`s.
- **A persisted counter is a determinism hazard even when its value is meaningless.** `skillUsage` is
  ranking telemetry nobody grades, and it will still break a byte-stable config snapshot, because engine
  A and engine B write it in sequence into a store the harness does not reset. Any per-invocation
  persisted counter should be found *before* the snapshot it will break is turned on.
