# Claude Agent SDK — Technical Inventory (TypeScript, `@anthropic-ai/claude-agent-sdk`)

Produced 2026-09-03 by a source-inventory subagent for the lecture at `../index.html`.

**Pin under examination:** installed version **0.3.251**, bundling Claude Code **2.1.251** (commit `37534ac596d80cefb02d272f036adba4ba055d2c`, build date 2026-08-28). npm latest at time of writing is **0.3.259** (published 2026-09-02).

The SDK package root is `CC-to-SDK/harness/node_modules/@anthropic-ai/claude-agent-sdk/` (abbreviated `<SDK>/`). Repo parity docs live under `CC-to-SDK/docs/parity/`.

Throughout, **declared** (present in `sdk.d.ts` or the public docs) is distinguished from **verified-reachable** (proven by a live headless probe in this repo). The repo's governing rule (`CC-to-SDK/CLAUDE.md:33-39`): *"every 'the SDK can / can't do X' premise must be VERIFIED against the real SDK before you design or build on it… **Declared ≠ reachable. Don't trust `sdk.d.ts` alone.**"*

---

## 1. Architecture

### What the SDK actually is

A thin JavaScript wrapper that spawns a **closed, precompiled Claude Code executable as a child process** and exchanges newline-delimited JSON over its stdin/stdout. The wrapper is ~1.4 MB of minified ESM (`<SDK>/sdk.mjs`, 1,475,586 bytes) whose header reads: *"Want to see the unminified source? We're hiring!"*

The child's argv is built in `ProcessTransport.initialize()`. Base flags:

```
["--output-format","stream-json","--verbose","--input-format","stream-json"]
```

Everything else in `Options` becomes a CLI flag. Flags verified emitted by the bundle: `--thinking`, `--thinking-display`, `--max-thinking-tokens`, `--effort`, `--max-turns`, `--max-budget-usd`, `--task-budget`, `--model`, `--agent`, `--betas`, `--json-schema`, `--debug`, `--debug-file`, `--permission-prompt-tool` (value `stdio` when `canUseTool` is set), `--continue`, `--resume=`, `--allowedTools`, `--disallowedTools`, `--tools`, `--mcp-config`, `--setting-sources=`, `--strict-mcp-config`, `--permission-mode`, `--allow-dangerously-skip-permissions`, `--fallback-model`, `--include-hook-events`, `--include-partial-messages`, `--session-mirror`, `--add-dir`, `--plugin-dir` / `--plugin-dir-no-mcp`, `--fork-session`, `--resume-session-at=`, `--resume-drops-turn=`, `--session-id=`, `--no-session-persistence`, `--managed-settings`. The wrapper sets `CLAUDE_CODE_ENTRYPOINT="sdk-ts"` and deletes `NODE_OPTIONS`.

Repo statements: `docs/parity/01-entrypoint-bootstrap.md:5` — *"The SDK IS this entrypoint: `query()` spawns the CLI in `--print`/`stream-json` mode and yields SDKMessage."*; `docs/parity/clone-roadmap.md:34` — *"The SDK is not the product boundary. `query()` spawns the real `claude` CLI as a subprocess. Everything the CLI does that the SDK does not expose — the interactive shell, the process registry, `--bg`, `attach`, worktree spawning — is invisible."*

### The engine is a native binary, not a JS bundle

`<SDK>/package.json` declares eight `optionalDependencies`, one per platform, pinned to the exact wrapper version: `@anthropic-ai/claude-agent-sdk-{linux-x64,linux-arm64,linux-x64-musl,linux-arm64-musl,darwin-x64,darwin-arm64,win32-x64,win32-arm64}`. Each ships a single file named `claude`. The installed darwin-arm64 copy is a **Mach-O arm64 executable of 197,171,680 bytes (188 MB)**, produced by `bun build --compile`. `<SDK>/manifest.json` lists all eight with SHA-256 and sizes (197–214 MB each), plus `"sdkCompat": { "testedWrapperVersions": [...], "harnessSchema": 1 }`.

There is **no `cli.js`** and no `bin` entry. Missing binary error: `Native CLI binary for ${platform}-${arch} not found. Reinstall … without --omit=optional, or set options.pathToClaudeCodeExecutable.` `Options.executable?: 'bun'|'deno'|'node'` applies only when the target path ends in `.js/.mjs/.ts`; with the native binary it is dead.

**Practical package size:** wrapper tarball ~5.0 MB; working install ~193 MB.

### In-process (parent) vs. in the child

| In the parent (your Node process) | In the child (`claude` binary) |
|---|---|
| `hooks` callbacks (dispatched over the control protocol) | The agent loop, model calls, retries |
| `canUseTool` (routed via `--permission-prompt-tool stdio`) | All built-in tool implementations |
| SDK MCP servers (`type:'sdk'`, in-memory transport) | stdio / SSE / HTTP MCP clients |
| `onElicitation`, `onUserDialog`, `stderr`, `sessionStore` | System prompt assembly, context assembly, compaction |
| `spawnClaudeCodeProcess` custom spawn | Settings resolution and migrations, plugin/skill/agent discovery, ~105-command slash registry |

Settings migrations run inside the child on every boot (`02-settings-schemas-migrations.md:19`); MDM/plist policy reads in the child (`:8`); settings validation errors only on stderr (`:21`); subagents run in-process within the CLI subprocess (`30-coordinator-multiagent.md:16`).

### The control protocol, measured

`StdoutMessage` (`sdk.d.ts:8171`): one JSON object per line — SDKMessages plus control requests/responses/cancellations/keep-alives. `SDKControlRequestInner` (`sdk.d.ts:4197`) enumerates 33 request kinds.

`coverage.md:764`: **54 control-request subtypes dispatched by the pinned engine; 37 sendable by the installed SDK. Measured 2026-09-02: FIRED 38, DEAD 0, OPEN 16 of 54.** *"The wrapper is the reason this was never measured before: `sdk.mjs` consumes control responses, so an initialize answer, a validation refusal and an unsupported-subtype error reach no surface an SDK-driven session can see."* `get_context_usage` is not free — it counts tokens through 21 further model-side calls.

**Runtimes:** `engines.node >= 18.0.0`, ESM only. Peer deps `@anthropic-ai/sdk >= 0.93.0`, `@modelcontextprotocol/sdk ^1.29.0`, `zod ^4.0.0`.

**Other entry points:** `./extract` (`extractFromBunfs`), `./browser` (WebSocket/SSE client to a **remote** session, no subprocess), `./bridge` (claude.ai remote-control bridge, `@alpha`), `./sdk-tools` (types only).

**Python SDK:** `claude-agent-sdk` on PyPI, latest **0.2.152**, `>=3.10`, MIT, deps `anyio`, `mcp`, `jsonschema`, `sniffio` — **no platform binary package**, so it does not bundle the engine. A full minor line behind TypeScript.

---

## 2. Model / provider layer

**Providers.** Anthropic API, Bedrock, Vertex, Foundry, Claude-Platform-on-AWS, Google Cloud Agent Platform, enterprise gateway — all selected by **environment variable passed to the child**, never by an SDK option. `AccountInfo.apiProvider` (`sdk.d.ts:23-33`): `'firstParty'|'bedrock'|'vertex'|'foundry'|'anthropicAws'|'anthropicGoogleCloud'|'mantle'|'gateway'`. Caveat: `full-potential.md:54` — third-party providers modeled but **never live-tested** in this repo.

**Non-Claude models: no.** No provider abstraction, no per-model base-URL routing. `Options.model` (`sdk.d.ts:1802`) is a free string resolved inside the child.

**Auth modes.** API key, `apiKeyHelper`, `/login`-managed key, pre-minted subscription token (`CLAUDE_CODE_OAUTH_TOKEN`), or cloud credentials. `Query.accountInfo()` (`sdk.d.ts:2729`) returns `{ email?, organization?, subscriptionType?, tokenSource?, apiKeySource?, apiProvider? }`.

`25-service-oauth-auth.md`: API key is *"the primary supported SDK auth path"* (`:7`). Six rows are **🚫 for contractual reasons**: claude.ai OAuth login (`:5` — *"Anthropic contractually forbids 3rd-party SDK apps from offering claude.ai OAuth login"*), Console OAuth, refresh-token rotation, 401-refresh recovery, trusted-device enrollment, approved-OAuth-base-URL override. Passing an already-minted token works (`:8`); verified by `probes/probes/28-oauth-subscription-auth.ts` → `{tokenSource:"CLAUDE_CODE_OAUTH_TOKEN", apiProvider:"firstParty"}`. `ANTHROPIC_API_KEY` shadows the OAuth token when both are set.

**Credential-tier finding (probe 55, `clone-roadmap.md:176-200`).** `usage().rate_limits` is auth-mode-coupled:

| Credential | `subscription_type` | `rate_limits_available` | `rate_limits` |
|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) | `null` | `false` | `null` |
| Interactive login (`~/.claude/.credentials.json`) | `"max"` | `true` | fully populated |

Mechanism: the interactive credential carries the `user:profile` scope; the `setup-token` credential does not. Exporting `CLAUDE_CODE_OAUTH_TOKEN` *degrades* this surface relative to letting the child fall back to the interactive credential.

**Model switching mid-session.** `Query.setModel(model?)` (`sdk.d.ts:2570`), streaming-input only. `Query.supportedModels()` (`:2663`). **`fallbackModel`** (`:1544`): comma-separated list; primary re-tried each user turn.

**Thinking / effort.** `thinking?: {type:'adaptive'}|{type:'enabled', budgetTokens?, display?}|{type:'disabled'}` (`:1740`, `:8323-8348`). `effort?: 'low'|'medium'|'high'|'xhigh'|'max'` (`:590`, `:1753`), default `'high'`; `xhigh`/`max` model-gated. `Query.applyFlagSettings({effortLevel})` (`:2616`).

**Prompt caching: automatic, not controllable.** No cache-control API. Levers: `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` sentinel (`sdk.d.ts:8272`) for `string[]` system prompts; `systemPrompt.excludeDynamicSections` (`:2116-2128`); settings keys `promptCacheTtl` / `subagentPromptCacheTtl` (`full-potential.md:154`).

**Cost reporting.** `SDKResultSuccess`/`SDKResultError` (`sdk.d.ts:4770-4862`): `total_cost_usd`, `usage` (**"MAIN AGENT LOOP ONLY"**), `modelUsage: Record<string, ModelUsage>` (main loop + subagents + sidechains + compaction; *"treat it as an estimate, not a billing statement"*). `ModelUsage` (`:1306`): `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `webSearchRequests`, `costUSD`, `contextWindow`, `maxOutputTokens`, `canonicalModel?`, `provider?`, `costBasis?: 'list'|'managed'|'unknown'`. Rate limits only from `Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` (`:2696`).

Budget caps: `maxBudgetUsd` → `error_max_budget_usd` (exceed path is throw OR empty result, timing-dependent, `coverage.md:102-104`); `taskBudget: {total}` (`@alpha`, opus-4-8-only).

Not given (`06-cost-token-tracking.md`): custom pricing math (`:6`), per-turn token-budget nudge (`:11`), session-end cost summary (`:12`), OTel cost counters (`:13`).

---

## 3. Agent loop & tools

**The agent loop is not yours.** `03-query-engine.md:5`: `query()` returns `AsyncGenerator<SDKMessage>`, *"No custom loop needed"* — which is simultaneously the ceiling. Retries *"internal and not separately configurable"* (`:7`). `coverage.md:679`: *"313 of 551 CC features are verdict `provided`."*

**Built-in tools.** `<SDK>/sdk-tools.d.ts` (162 KB, generated) declares **45 `*Input` interfaces** (`sdk-tools.d.ts:11-56`):

`Agent, Bash, TaskOutput, ExitPlanMode, FileEdit, FileRead, FileWrite, Glob, Grep, TaskStop, ListMcpResources, RefreshMcpTools, Mcp, NotebookEdit, ReadMcpResourceDir, ReadMcpResource, ReportFindings, TodoWrite, WebFetch, WebSearch, AskUserQuestion, SendFeedback, ClaudeDesign, Projects, EnterPlanMode, TaskCreate, TaskGet, TaskUpdate, TaskList, REPL, Workflow, CronCreate, CronDelete, CronList, ScheduleWakeup, RemoteTrigger, ShowOnboardingRolePicker, ReadNotifications, Monitor, ProposeSkills, ProposeGoal, Artifact, PushNotification, EnterWorktree, ExitWorktree`

`AgentInput` (`:658`): `subagent_type`, `model?: "sonnet"|"opus"|"haiku"|"fable"`, `run_in_background?`, `name?`, `isolation?: "worktree"|"remote"`. `Skill` has no static schema.

**Runtime list is smaller and model-dependent.** `probe-results/01-introspection.txt`: live `system/init` with `tools.count: 32`. `since-february.md:5-11` (probe 125): *"Claude Code 2.1.233 removed TaskCreate/TaskUpdate/TaskGet/TaskList/TodoWrite from Opus 4.8, Sonnet 5, Fable 5 and newer"* — engine-side, invisible to any type diff. `CORRECTIONS-2026-06-16-native-tools.md`: `sdk.d.ts` answers *"can my code call X?"*; `sdk-tools.d.ts` + runtime probe answers *"can the model do X?"*. Re-audit found 17 false premises, 18 needing probes, 83 legitimately build.

**Built-in tools cannot be modified or replaced.** Levers:
- `tools?: string[] | {type:'preset', preset:'claude_code'}` (`sdk.d.ts:1500`) — pool selection; `[]` disables all.
- `allowedTools` / `disallowedTools` (`:1444`, `:1464`) — permission gating, not implementation.
- `toolAliases?: Record<string,string>` (`:1490`) — redirect a model-emitted `tool_use` name to an MCP tool (`{ Bash: 'mcp__workspace__bash' }`). Single-hop; only affects name-based lookup.
- `toolConfig` (`:1564`) — one knob: `askUserQuestion.previewFormat`.

`08-tool-base-registry.md:6`: *"No SDK surface lets an author declare isReadOnly/isConcurrencySafe/isDestructive on a custom tool."* `:7`: *"Pipeline is engine-internal; the SDK exposes only the inputs."* `09-permission-system.md:16`: *"Built-in CC tools' baked-in checks (Bash classifier, file-path safety) are NOT individually overridable from the SDK."*

**Adding tools = MCP only.** Four config shapes (`sdk.d.ts:1109`): stdio, SSE, HTTP, `type:'sdk'` in-process. `createSdkMcpServer({name, version?, instructions?, tools?, alwaysLoad?, timeout?})` (`:510`); `tool(name, description, zodRawShape, handler, {annotations?, searchHint?, alwaysLoad?})` (`:8349`). Addressed as `mcp__<serverKey>__<toolName>`. Live-verified (`probe-results/02-sdk-mcp-tool.txt`). Runtime topology: `Query.setMcpServers()`, `reconnectMcpServer()`, `toggleMcpServer()`, `mcpServerStatus()`. Deferred loading knobs: `alwaysLoad`, `searchHint`.

---

## 4. Extension points, exhaustively

### Hooks

`HOOK_EVENTS` (`sdk.d.ts:853`), 33 members:

`PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded, CwdChanged, FileChanged, DirectoryAdded, MessageDisplay`

Registration: `hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>`, `HookCallbackMatcher = { matcher?, hooks: HookCallback[], timeout? }` (seconds). Callback `(input, toolUseID, {signal}) => Promise<HookJSONOutput>` (`:858`).

Return shape `SyncHookJSONOutput` (`:8248`): `{continue?, suppressOutput?, stopReason?, decision?:'approve'|'block', systemMessage?, terminalSequence?, reason?, hookSpecificOutput?}`; or `{async:true, asyncTimeout?}`. **22 of 33** events have a `hookSpecificOutput`:

- `PreToolUse` (`:2498`): `permissionDecision?: 'allow'|'deny'|'ask'|'defer'`, `permissionDecisionReason?`, **`updatedInput?`**, `additionalContext?`.
- `PostToolUse` (`:2421`): `additionalContext?`, **`updatedToolOutput?`**, `updatedMCPToolOutput?`, `classifierContext?` (≤2000 code units).
- Also: `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `Setup`, `PreModelSwitch`, `PostModelSwitch`, `SubagentStart`, `PostToolUseFailure`, `PostToolBatch`, `Stop`, `SubagentStop`, `PermissionDenied`, `Notification`, `PermissionRequest`, `Elicitation`, `ElicitationResult`, `CwdChanged`, `FileChanged`, `WorktreeCreate`, `MessageDisplay`.
- **Observe/block only**: `PreCompact`, `PostCompact`, `SessionEnd`, `StopFailure`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `ConfigChange`, `InstructionsLoaded`, `DirectoryAdded`, `WorktreeRemove`.

Default timeouts: 600 s most; 30 s `UserPromptSubmit`/`PreModelSwitch`/`PostModelSwitch`; 10 s `MessageDisplay`; `SessionEnd` under a 1.5 s shutdown budget.

### Declared vs. reachable: the headline finding

`CC-to-SDK/CLAUDE.md:39` ("only 8 fire headlessly") is stale. Current: **25 of 33 fire headlessly, 8 OPEN** (`coverage.md:762`). Revision history, every step upward:

| Date / source | Result |
|---|---|
| 2026-06-18, probes 09/10 | **8 of 30** |
| Wave 2, probes 42/43b (`full-potential.md:173`) | **17 of 30** |
| 2026-09-01 first re-measurement | **12** (wrong for a new reason) |
| 2026-09-01 second | **23 of 33** |
| 2026-09-02 | **24 of 33** — `PermissionDenied` closed |
| current (`coverage.md:762`) | **25 of 33** — `CwdChanged` closed |

`coverage.md:802-843`: *"the measuring turn had created none of the missing firing conditions, so its silence was the silence a working dispatcher also produces"*; *"the list of events being watched was still written by hand, so an event nobody thought of could not be measured as absent"*; enumeration now comes from *"upstream's own dispatcher registry… 33 events, not the SDK's declared 30"*; *"No created condition came back dead."* The 8 OPEN are absence of evidence, not negatives.

**"Structurally unreachable" reading withdrawn** (`coverage.md:836-843`): `Options.hooks` entries are pushed into a global store consulted unconditionally; **SessionStart's silence is registration timing** — dispatch precedes host-hook registration. SessionStart fires on the settings/command path. Practical rule: for some events a programmatic callback arms nothing; register via `Options.settings`.

Probe results: `PreModelSwitch`/`PostModelSwitch` alive with `from_model`/`to_model`/`context_tokens`/`prompt_cache_warm`/`estimated_cache_write_usd`; Pre-hook `deny` cancels the switch (`full-potential.md:176`). `SessionStart` resume-staleness fields unreachable via callbacks (`:177`). `includeHookEvents` produces no frames with programmatic hooks (`:174`).

Declared-in-registry (33) ≥ declared-in-types (33) > declared-in-docs (20) > verified-reachable (25).

### `canUseTool` and the permission surface

`CanUseTool` (`sdk.d.ts:209`): `(toolName, input, {signal, suggestions?, blockedPath?, decisionReason?, title?, displayName?, description?, toolUseID, agentID?, requestId, matchedAskRule?})` → `PermissionResult | null` (`:2260`): `{behavior:'allow', updatedInput?, updatedPermissions?, decisionClassification?}` or `{behavior:'deny', message, interrupt?}`. `PermissionUpdate` (`:2279`): `addRules|replaceRules|removeRules|setMode|addDirectories|removeDirectories` × `userSettings|projectSettings|localSettings|session|cliArg`.

`09-permission-system.md:5`: *"CC's `checkPermissions` can return `'ask'` directly; the SDK `canUseTool` callback returns only allow/deny."* The rule matcher is not exported (`:9`, `:11`).

**Probed behaviors:**
- Order: **`PreToolUse → canUseTool → PermissionRequest`**; `PermissionRequest` is informational, fires on allowed calls too (`full-potential.md:172`).
- **A bare `allowedTools` entry shadows `canUseTool` entirely** (`coverage.md:831`). Default mode auto-approves read-only shell before reaching it.
- `permissionDecision:'defer'` parks the call: no execution, no `canUseTool`, no `tool_result`.
- **`bypassPermissions` does not skip the rule engine** — a deny rule still bites (`coverage.md:829`).
- `AskUserQuestion` consults `canUseTool` in every mode incl. `bypassPermissions` (`coverage.md:723`).
- `PermissionDenied` never fires for callback/hook denials — only `decisionReason.type === "classifier"`.
- `CanUseTool` does not forward `default_to_no` (`full-potential.md:103`).

**`PermissionMode`** (`sdk.d.ts:2238`): `'default'|'acceptEdits'|'bypassPermissions'|'plan'|'dontAsk'|'auto'`. `bypassPermissions` requires `allowDangerouslySkipPermissions: true`. `plan` takes `planModeInstructions?` (`:1835`). **`Query.setPermissionMode()` is fallible** — `auto` off its model set and runtime `bypassPermissions` are refused (`coverage.md:763`). `'bubble'` not in the SDK enum (`09-permission-system.md:8`).

### System prompt, agents, settings, plugins, skills

**`systemPrompt`** (`:2163`): `string | string[] | {type:'preset', preset:'claude_code', append?, excludeDynamicSections?}`. **`append` is the only way to touch the built-in prompt.** At 2.1.251: **27 dynamic section records + six-element static head** (`coverage.md:765`, fixture `reforge/research/fixtures/prompt-sections-2.1.251.json`), none individually addressable.

**`agents`** (`:1436`, `AgentDefinition` at `:38`): `description`, `prompt`, `tools?`, `disallowedTools?`, `model?`, `mcpServers?`, `skills?`, `initialPrompt?`, `maxTurns?`, `background?`, `memory?`, `effort?`, `permissionMode?`, `observer?`, `criticalSystemReminder_EXPERIMENTAL?`. **No `hooks` field, no `isolation` field** (`14-tool-agent-team.md:20-21`). Built-in agents (Explore, Plan) not auto-shipped (`:14`). Probes 126/127: Agent-tool spawns carry `is_backgrounded: true` — *"a headless host must not assume a spawning tool call blocks on its subagent"* (`full-potential.md:136`).

**`settingSources`** (`:2056`): `'user'|'project'|'local'`; omitted = all; `[]` = isolation. Must include `'project'` for CLAUDE.md. Read **regardless**: managed policy, `~/.claude.json`, auto-memory, claude.ai MCP connectors — *"you should not rely on default `query()` options for multi-tenant isolation."* `managedSettings` (`:2045`) is filtered restrictive-only.

**`plugins`** (`:1860`): `{type:'local', path, skipMcpDiscovery?}` — **`'local'` is the only type.** Loads commands/agents/skills/hooks/MCP from `.claude-plugin/plugin.json`. Not reachable: built-in registry, marketplace GCS path, `/plugin` UI, install ledger (`28-service-plugins.md`).

**`skills`** (`:2079`): `string[] | 'all'` — *"a context filter, not a sandbox."* No programmatic registration; must exist as `.claude/skills/<name>/SKILL.md`. `context:'fork'` runs a skill as a subagent; `paths:` conditional skills.

### Output, streaming, sessions, transport

**`outputFormat`** (`:1815`): `{type:'json_schema', schema}`; result carries `structured_output`; draft-7 required. Only on final result.

**`sandbox`** (`:2003`, `SandboxSettings` at `:3057`): `enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, `network` (allow/deny domains, unix sockets, proxy ports), `filesystem` (allow/deny read/write), `credentials` (`files: [{path, mode:'deny'|'mask'}]`). bubblewrap on Linux, `sandbox-exec` on macOS.

**Streaming input.** `query({prompt: string | AsyncIterable<SDKUserMessage>})` (`:2839`); `Query.streamInput()` (`:2809`). `SDKUserMessage` (`:5158`): `priority?: 'now'|'next'|'later'`, `isSynthetic?`, `shouldQuery?`, `uuid?`. **Every `Query` control method except `interrupt` is streaming-input only.**

**`includePartialMessages`** (`:1720`) → raw `BetaRawMessageStreamEvent`s. Subagent deltas not forwarded; `forwardSubagentText` (`:1727`).

**`Query` methods** (`:2522-2837`), 26: `interrupt`, `setPermissionMode`, `setMcpPermissionModeOverride`, `setModel`, `setMaxThinkingTokens`, `applyFlagSettings`, `initializationResult`, `reinitialize`, `supportedCommands`, `supportedModels`, `supportedAgents`, `mcpServerStatus`, `getContextUsage`, `usage_EXPERIMENTAL_…`, `readFile`, `reloadPlugins`, `reloadSkills`, `accountInfo`, `rewindFiles`, `seedReadState`, `reconnectMcpServer`, `toggleMcpServer`, `setMcpServers`, `streamInput`, `stopTask`, `backgroundTasks`, `close`.

**File checkpointing / rewind.** `enableFileCheckpointing` (`:1553`) + `Query.rewindFiles(userMessageId, {dryRun?})` (`:2738`). Anchor UUIDs must come from `getSessionMessages()` (`coverage.md:790`).

**Session persistence.** `~/.claude/projects/<slug>/*.jsonl`, `CLAUDE_CONFIG_DIR`-relocatable, **cwd-scoped** (`full-use-checklist.md:397-401`). `persistSession: false`. Pluggable via `sessionStore?: SessionStore` (`:5394`, `@alpha`) as a **dual-write mirror**, not a replacement. Functions: `listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `renameSession`, `tagSession`, `deleteSession`, `forkSession`, `foldSessionSummary`.

**`spawnClaudeCodeProcess`** (`:2199`): `(options: SpawnOptions) => SpawnedProcess`; probed alive end-to-end (`full-potential.md:195`, probe 50). Exported `Transport` interface (`:8379`).

**Warm start.** `startup()` → `WarmQuery` (`:8163`): init 51 ms vs 602 ms one-shot (`full-potential.md:47`).

**`env` is replace-not-merge** (`:1520`).

---

## 5. What is NOT customizable (the ceiling)

1. **The agent loop.** Not exposed (`03-query-engine.md:5`); retries internal (`:7`).
2. **System prompt body.** Append-only or total replacement; 27 sections + 6 static head, none addressable. `<system-reminder>` injection internal (`05-context-assembly.md:13`).
3. **Context assembly.** Ordering internal (`05-context-assembly.md:11`).
4. **Compaction.** Thresholds internal (`07-context-compaction.md:5`); microcompaction untunable (`:8`); re-injection budgets internal (`:12`); circuit breaker internal (`:15`). Only `PreCompact`/`PostCompact` observation + env passthrough (`DISABLE_AUTO_COMPACT`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`).
5. **Tool implementations.** Sensitive-path list baked in (`09-permission-system.md:17`); `acceptEdits` classification internal (`:27`); `requiresUserInteraction` not exposed (`:38`).
6. **Permission-pipeline internals.** Auto-mode classifier server-side (`:23`); Bash classifier stub returns `matches:false` in external builds (`:24`); denial thresholds, multi-racer, shadowed-rule detection, bypass killswitch.
7. **Settings surface.** 157 top-level `Settings` keys (`sdk.d.ts:5541-8032`) — settable, semantics fixed.
8. **Feature flags / telemetry / DCE.** `26-service-analytics-flags.md`: no `logEvent` API (`:5`); Datadog hardwired (`:6`); GrowthBook server-side per account (`:8`); compile-time toggles depend on binary version (`:9`); Perfetto (`:11`). OTel is the one exception.
9. **TUI.** None. Six upstream TUI behaviours unreachable (`coverage.md:169-176`): *"Bash stdout is wire-silent, hooks execute invisibly, the auto-classifier annotates nothing."*
10. **Headless-dead floor** (`full-potential.md:321-327`): agent teams, native `CronCreate` firing, `PushNotification`, `includeHookEvents`, `promptSuggestions`, claude.ai-bridge-coupled surfaces, `/goal`. **58 parity items `not-possible`, ~77 non-goals** (`coverage.md:923-932`).
11. **Wrapper/CLI divergence.** Ctrl+B background: SDK reports success, CLI does not detach (`full-use-checklist.md:376-382`).

Envelope: realized-of-reachable **74% across 126 rows** (`full-potential.md:213-217`) — *"an SDK that ships faster than we probe lowers this score by existing."* Ten domains ~58% to ~98%; **Extensibility ~63%** (`coverage.md:718-740`).

---

## 6. Interfaces

**Headless only.** No TUI, no `bin`. `AskUserQuestion`, permission prompts, plan dialogs, `onUserDialog`, elicitation all arrive as **control requests you must render yourself** (`09-permission-system.md:39`).

**Wire format.** NDJSON both directions. `SDKMessage` is a **37-member union** (`sdk.d.ts:4498`).

**Relationship to `claude -p --output-format stream-json`.** Direct: the SDK is a typed driver for that command. `extraArgs` (`:1537`) forces unmodeled flags.

**Two SDKs.** TypeScript 0.3.259, Python 0.2.152. Python: 13 of 33 hook events TypeScript-only as callbacks; `can_use_tool` requires a dummy `PreToolUse` hook.

---

## 7. Ops / quality

**License — proprietary.** `<SDK>/LICENSE.md`: *"© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance."* `package.json`: `"license": "SEE LICENSE IN README.md"`. GitHub reports no license object. Third-party developers may not offer claude.ai login; may not name the product "Claude Code". Python package declared MIT (wrapper only).

**Telemetry.** Internal sinks opt-out only (`26-service-analytics-flags.md:14`). **OpenTelemetry is the one customer-controlled surface** (`:7`): `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_*` via `Options.env`; ~55 `OTEL_*` vars in the binary. Probe 51 (`full-potential.md:158`): metrics `claude_code.{session.count, cost.usage, token.usage, active_time.total}`; six log-event types; attributes `session.id`/`prompt.id`/`user.*`; **no traces**. `BaseHookInput.prompt_id` (`sdk.d.ts:167`) joins to OTel `prompt.id`.

**Versioning cadence.** **287 versions since 2025-09-27**; 0.1.0 (2025-09-29), 0.2.0 (2026-01-07), 0.3.259 (2026-09-02). **32 releases in trailing 30 days.** `drift-ritual.md:3`: *"The SDK moved 33 releases in one month; `coverage.md`/`full-potential.md` rot in weeks."* No published deprecation window.

**How it moves.** Four-surface diff (Options / Query / SDKMessage / exports) — *"No drift ≠ no change — bodies/jsdoc/semantics move without renames"* (`drift-ritual.md:14-15`). Three consecutive bumps with zero name-level drift but real changes (`:62-68`): 0.3.234 removed `get_plan`/`get_workspace_diff` control requests; 0.3.250 zero drift, 755 diff lines; 0.3.237→0.3.251 +1 Options field, +4 exports, 959 diff lines (two new hook events, `costBasis`, `default_to_no`, 9 settings keys). Settings-key advisory: *"by 0.3.237 it warned about 71 real upstream keys and blessed 9 upstream had dropped"* (`:21-24`).

**Recorded breaking changes.** 0.3.211 removed `runAssistantWorker`, `ConnectRemoteControl*`, changed `setMcpServers({})` (`coverage.md:959-960`). 0.3.234 removed two control requests. 0.2.142 removed v2 session API (zero `unstable_v2` in installed `sdk.d.ts`). Claude Code 2.1.233 removed five task/todo tools with **no SDK-type change**.

**Stability markers.** `sessionStore`, `sessionStoreFlush`, `loadTimeoutMs`, `importSessionToStore`, `resolveSettings`, `filterEscalatingDefaultMode`, `foldSessionSummary`, `InMemorySessionStore`, `taskBudget` all `@alpha`; `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`. `manifest.json` `sdkCompat.testedWrapperVersions` lists 16 versions (0.3.212–0.3.227), not 0.3.251 itself.

**Doc-vs-type gaps** (`_sdk-surface.md`, 0.3.178 snapshot): docs omitted 3 real Options fields and listed one phantom (`outputStyle`); 17 exported functions / 10 documented; 26 Query methods / 18 documented.

**Newer than this pin** (0.3.257–0.3.259): `permissionPrompts: 'none'`, `ModelUsage.thinkingTokens`.

---

## Notes on the evidence base

- **Two `coverage.md` files.** The SDK scorecard is `docs/parity/coverage.md` (1,013 lines). `reforge/attestation/coverage.md` is branch-coverage attestation for the reforge lane.
- **`_sdk-surface.md` is stale** (pinned 0.3.178, 6,567-line `sdk.d.ts`; installed is 8,562 lines). Newer docs win.
- **Internal contradiction.** `since-february.md:42-43` marks cron/push ✅ (declared surface); `coverage.md:727`, `:926`, `full-potential.md:323-324` mark them headless-dead (probed). Probed verdict describes what an agent can actually do.
- **Not independently verified:** the exact 32-item runtime tool list for a bare `query()` on a current default model.
