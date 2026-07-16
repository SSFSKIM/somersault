# The Full-Potential Map — every replicable SDK capability, and the road to all of them

> **Goal (2026-07-17, user-set):** replicate *everything* that can be replicated on the Claude Agent SDK.
> This document is the master map for that goal: an exhaustive, capability-by-capability layout of the
> SDK's surface (measured against `@anthropic-ai/claude-agent-sdk@0.3.211` — installed — plus all 30
> `code.claude.com/docs/en/agent-sdk/*` pages), each item's realization status, and a phased roadmap to
> 100% of the *reachable* envelope.
>
> **Relation to the other parity docs:** `parity.json`/`roadmap.md` score the inverse direction (551
> Claude-Code features → SDK, Feb-snapshot based); `coverage.md` is the running scorecard (10 domains,
> shipped-log, §7 drift record); `tui-ux.md` scores visual/interaction fidelity. THIS file is the
> forward plan. When something ships, update `coverage.md` (the log) and tick it here (the plan).

## Statuses

- ✅ **built** — shipped in `harness/` (or `tui/`/`app-server/`), unit + (mostly) live tested
- 🟢 **rely-on** — the SDK does it natively for every harness session; nothing to build, verified working
- 🟡 **partial** — a seam exists but the capability isn't fully realized
- ⚪ **unbuilt** — reachable (or believed reachable), not yet built
- 🔬 **needs-probe** — declared/documented only; reachability must be settled by a live probe FIRST
  (the A1 discipline: declared ≠ reachable)
- 🚫 **unreachable** — bridge-coupled, CLI-only, or deleted; excluded from the goal's denominator

---

## §1 — The map

Grouped by the docs' own capability themes. ~150 rows. "Evidence" cites probes
(`probes/probes/NN-*`), modules, or the docs page slug.

### A. Execution / agent loop / streaming

| Capability | Status | Evidence / what's left |
|---|---|---|
| `query()` streaming loop | ✅ | the core engine (`harness.ts`, `session/session.ts`) |
| Streaming input mode (AsyncIterable prompt, queued msgs, interrupts) | ✅ | `Session` engine; queued-while-busy in chat REPL |
| Single-message mode | ✅ | `harness.run()` one-shot |
| Partial/real-time output streaming (`includePartialMessages`) | ✅ | probe 12/20; `tui/liveTurn.ts` reducer |
| Turn loop semantics, result subtypes (`error_max_turns` etc.) | ✅ | consumed throughout |
| `maxTurns` / `fallbackModel` / model aliases | ✅ | `resolveOptions` |
| `effort` (low→max) | ✅ | probe 11; config + `/think` vocabulary |
| `thinking` (adaptive/enabled/disabled) | ✅ | probe 25; runtime `setMaxThinkingTokens` lever |
| Automatic compaction + `compact_boundary` + manual `/compact` | ✅ | `compaction/` (`cc-compact` tool, daemon+lib `compact()`) |
| `interrupt()` | ✅ | Session/daemon control op |
| `interrupt()` **receipt** (`still_queued`, 0.3.211) | ✅ | **Wave 1 (2026-07-17)**: `Session.interrupt()` returns it; bridge `interrupt` frame carries `receipt` (probe 38) |
| `reinitialize()` (0.3.211) | ✅ | **Wave 1**: probe 38 (fresh full init payload; parked can_use_tool DEDUPED in-process, so it's a capability-refresh lever, not permission recovery); `Session.reinitialize()` + `reinitialize` control frame |
| `startup()` / `WarmQuery` (pre-warmed CLI subprocess) | 🔬 | docs [hosting]; probe then Wave 3 warm pool for daemon spawn latency |
| `close()` | ✅ | teardown-liveness suite |
| Built-in tool set (Read/Write/Edit/Bash/Glob/Grep/Web*/Agent/Skill/Task*) | 🟢 | claude_code preset |
| `Monitor` tool (watch background script output) | 🔬 | never probed headlessly |
| Third-party providers (Bedrock/Vertex/Foundry env-gating) | 🟡 | `provider.ts` models the envs; never live-tested against a real alt provider |
| Result `stop_reason` / `error_during_execution` handling | ✅ | consumed in translator/app-server too |

### B. Structured output

| Capability | Status | Evidence / what's left |
|---|---|---|
| `outputFormat: json_schema` (validated, auto-retry) | ✅ | probe 36-output-format; `resolveOptions` + app-server `outputSchema` passthrough |
| Zod→JSON-schema round-trip ergonomics | ⚪ | small: a typed `runStructured<T>(schema)` convenience on `Harness`/`Session` |
| `error_max_structured_output_retries` surfacing | 🟡 | flows through as result subtype; no dedicated handling/docs |

### C. Tools / MCP / custom tools

| Capability | Status | Evidence / what's left |
|---|---|---|
| `tool()` + `createSdkMcpServer()` in-process servers | ✅ | 5 shipped: cc-tasks, cc-swarm, cc-brief, cc-context, cc-compact |
| Tool annotations (`readOnlyHint` → parallel exec, etc.) | ⚪ | our 5 servers don't declare them; cheap quality win |
| `mcpServers` passthrough (stdio/http/sse/in-process) | ✅ | + the D3 shadowing/permission lesson (memory) |
| Tool naming (`mcp__server__tool`) + allow/deny globs | ✅ | permissions module |
| **ToolSearch deferral** (10k-tool scaling; `ENABLE_TOOL_SEARCH`) | 🟢 | probes 35/35b/35c: our MCP tools are deferred (~11 tok/turn) |
| `ENABLE_TOOL_SEARCH` knob exposure (`auto:N` thresholds) | ⚪ | config passthrough + doc |
| Runtime MCP control: `mcpServerStatus()` | ✅ | capability method |
| Runtime MCP control: `reconnectMcpServer` / `toggleMcpServer` / `setMcpServers` | ⚪ | Wave 1/3: daemon ops for dynamic tool topology (note 0.3.211: `setMcpServers({})` keeps plugin servers) |
| `RefreshMcpTools` tool + `setMcpPermissionModeOverride()` (0.3.211) | 🔬 | probe first |
| MCP auth (HTTP headers / OAuth-token passthrough; `needs-auth` status) | 🟡 | passthrough works; no harness story for token refresh |
| MCP limits (`MCP_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`) | ⚪ | env knobs, expose in config docs |
| `onElicitation` handler | 🔬 | never probed; pairs with daemon permission-style parking |
| `toolAliases` | ✅ | config passthrough |
| `toolConfig` (e.g. `askUserQuestion.previewFormat`) | ⚪ | last unmodeled tool knob |
| `tools` allowlist / `{preset:'claude_code'}` / `toolPreset:"none"` | ✅ | `tools.ts` |

### D. Permissions / approvals / user input

| Capability | Status | Evidence / what's left |
|---|---|---|
| All 6 `permissionMode`s incl. model-gated `auto` | ✅ | probes 15/17/18*/24; auto model-gate centralized |
| 6-step evaluation order (hooks→deny→ask→mode→allow→canUseTool) | 🟢 | characterized in probe 17d mode/broker table |
| `allowedTools`/`disallowedTools` (incl. scoped `Bash(rm *)` deny) | ✅ | config + gate |
| `canUseTool` broker (allow/deny/updatedInput/updatedPermissions) | ✅ | `permissions/gate.ts`; daemon parked permissions; TUI dialogs |
| `updatedPermissions` persist-to-localSettings path | ⚪ | broker returns decisions; rule-persistence unexercised |
| `AskUserQuestion` end-user routing | 🟡 | flows through the broker; no dedicated multi-choice UX in TUI/daemon |
| `setPermissionMode()` runtime | ✅ | Tab ladder, console op |
| `allowDangerouslySkipPermissions` coupling | ✅ | centralized in `resolveOptions` |
| `planModeInstructions` | ⚪ | unmodeled Options field |
| Subagent mode inheritance rules | 🟢 | docs [permissions]; relied on |

### E. Sessions / persistence / checkpointing

| Capability | Status | Evidence / what's left |
|---|---|---|
| `resume` / `persistSession` / `forkSession()` / store CRUD (`list`/`messages`/`info`/`rename`/`tag`/`delete`) | ✅ | the complete 3-spec session cluster + closeout |
| `continue` (most-recent) Options field | 🟡 | capability delivered via `listSessions`+resume in TUI; the native field itself unused |
| **`resumeSessionAt`** (branch at message UUID) | ✅ | **Wave 1 keystone SHIPPED**: probes 37/37b (in-place = destructive truncation, same sid; fork = safe branch; user-uuid anchors accepted → one anchor drives conversation + `rewindFiles`); `resumeAt`/`forkSession` config + `rewindSession()` + daemon `rewind` op; live e2e green |
| `sessionId` (explicit UUID) / `title` | ⚪ | minor knobs (`renameSession` covers title) |
| External `sessionStore` (S3/Redis/Postgres mirror; cross-host resume) | 🟡 | seam + `InMemorySessionStore` probed; **no real external adapter shipped** — Wave 3: reference adapter + conformance suite + `mirror_error` handling |
| `sessionStoreFlush` / `loadTimeoutMs` (alpha) | ⚪ | knobs, pass through when adapter ships |
| File checkpointing (`enableFileCheckpointing` + `rewindFiles` + dryRun) | ✅ | default-on; `Harness.rewind` (user-prompt-UUID anchor lesson) |
| Daemon durable sessions + boot-rehydration | ✅ | beyond-SDK value-add (registry + revive-on-access) |
| Session forking (lib + daemon op) | ✅ | true-branch live-verified |

### F. Multi-agent / subagents / workflows

| Capability | Status | Evidence / what's left |
|---|---|---|
| Programmatic `agents` / `AgentDefinition` (incl. per-agent model/effort/tools) | ✅ | `agents.ts` + swarm teammates |
| Per-agent `skills`/`memory`/`mcpServers`/`background`/`initialPrompt` fields | ⚪ | newer AgentDefinition fields unmodeled |
| Filesystem subagents (`.claude/agents/*.md`) + built-ins | 🟢 | via `settingSources` |
| Fork subagent (transcript-inheriting, autonomous) | ✅ | probes 33/33b/33c/33d; default-on config |
| Background subagents (default since v2.1.198) + stall watchdog env | 🟢/⚪ | rely-on; watchdog knob undocumented in config |
| Nested subagents (5 levels) | 🟢 | rely-on |
| Subagent transcripts: `listSubagents` / `getSubagentMessages` / resume-by-agentId | ⚪ | observability gap (noted in coverage.md domain 4) |
| `parent_tool_use_id` attribution | ✅ | TUI nesting (probe 22) |
| `forwardSubagentText` / `agentProgressSummaries` | ✅/⚪ | text forwarded; progress summaries unmodeled |
| Inter-agent `SendMessage` (v2.1.206+) | 🔬 | headless reachability unknown; would upgrade swarm bus |
| **`Workflow` tool** (script-driven fan-out) | ✅ | probe 36 (re-verified 0.3.211); **`config.workflow` opt-in SHIPPED 2026-07-17**, live e2e green |
| `stopTask()` / `backgroundTasks()` + `background_tasks_changed` msg (0.3.211) | ✅ | **Wave 1**: probe 39 (level signal streams headlessly; Ctrl+B works mid-turn; no-arg returns true even when idle — use the targeted form to detect); `Session.backgroundTasks`/`stopTask`/`backgroundAll` + bridge frames; live e2e green |
| Agent teams | 🚫 | CLI-only, not SDK-configurable [claude-code-features] |
| Swarm coordinator/bus/teammates | ✅ | beyond-SDK value-add over `agents` |

### G. Observability / cost / telemetry

| Capability | Status | Evidence / what's left |
|---|---|---|
| Cost & usage (`total_cost_usd`, per-model `modelUsage`, cache tokens) | ✅ | `usage()` (wraps unstable name), dedupe lesson |
| `maxBudgetUsd` / `taskBudget` | ✅ | probes 11b/11c; pass-through-don't-swallow |
| `getContextUsage()` 17-field breakdown | ✅ | + agent-facing `cc-context` tool |
| `accountInfo()` / `initializationResult()` / `applyFlagSettings()` | ✅ | closeout |
| `supportedModels/Commands/Agents` + `mcpServerStatus` | ✅ | capability methods (probes 27/29/30) |
| **OpenTelemetry** (metrics/logs/traces, trace-context propagation, per-user attribution) | ⚪ | **the biggest untouched reachable surface** — env-gated, no bridge coupling [observability]; Wave 3 flagship |
| Billing/limit classification (`USAGE_*`/`ORG_POLICY_LIMIT_PREFIXES`, 0.3.211) | ✅ | **Wave 1**: `limits/classify` (SDK prefixes + observed org-policy/credit families + rejected `rate_limit_event`); `Session.limitState` + daemon registry `limit` field |
| New lifecycle msgs (0.3.211): `control_request_progress`, `model_refusal_no_fallback`, `conversation_reset` | ⚪ | absorb into daemon event stream |
| `promptSuggestions` | ⚪ | TUI could render them |
| Prompt caching (auto; `ENABLE_PROMPT_CACHING_1H`) | 🟢/⚪ | rely-on; 1h-TTL knob unexposed |
| Todo/Task tools (native `TaskCreate`/`TaskUpdate`…) | ✅ | deliberately shadowed by durable `cc-tasks` (A1 lesson) |
| `debug` / `debugFile` / `stderr` capture | ⚪ | ops lever — today's crash triage needed raw stderr; wire into daemon diagnostics |
| `usage().rate_limits` | 🚫 | `null` on API-key auth (bridge-coupled) |

### H. Extensibility — hooks / skills / plugins / commands / prompts

| Capability | Status | Evidence / what's left |
|---|---|---|
| Programmatic `hooks` (all 30 events reachable) | ✅ | probes 09/10; builders + `mergeHooks`; 8/30 verified-fired |
| Hook `defer` decision + async side-effect mode | 🔬 | newer decision semantics unprobed |
| Unverified hook events (PostToolUseFailure, UserPromptExpansion, PermissionRequest, Setup, Teammate/Task/Config/Worktree events) | 🔬 | Wave 2 probe sweep — which fire headlessly on 0.3.211? |
| `includeHookEvents` (hook lifecycle messages) | ⚪ | unmodeled |
| Skills (`.claude/skills`, model-invoked or `/name`) | ✅ | probes 30/31; command palette |
| `skills` Options field (explicit allowlist form) | ⚪ | we inherit via settingSources instead |
| Plugins (`{type:'local',path}` bundles) | ✅ | passthrough + palette surfacing |
| Plugin/skill runtime reload (`reloadPlugins`/`reloadSkills`) | ⚪ | daemon op candidate |
| Slash commands (catalog, args, `!`bash, `@`refs, frontmatter) | ✅ | probes 21/30/31; 3-way dispatch in REPL |
| System prompt presets (`claude_code` preset, append, excludeDynamicSections) | ✅ | `outputStyle.ts` |
| Output styles | ✅ | builtin personas + literal passthrough |
| `settingSources` cascade + `settings`/`managedSettings` | ✅ | `settings.ts` |
| `resolveSettings()` + provenance (alpha) | ⚪ | config-debugging surface |
| Auto memory (`~/.claude/projects/<p>/memory/`; disable env) | 🟢/⚪ | rely-on; per-tenant disable knob undocumented in config |

### I. Deployment / hosting / security

| Capability | Status | Evidence / what's left |
|---|---|---|
| Subprocess model + 4 session-lifecycle hosting patterns | 🟡 | daemon IS the long-running pattern; no ops guide mapping ours to docs [hosting] |
| Scaling formula / session pinning / resource sizing | ⚪ | docs-level; Wave 3 ops guide |
| `spawnClaudeCodeProcess` (custom spawn — VMs/containers/remote) | 🔬 | probe; opens remote placement for daemon sessions |
| `sandbox` settings (bubblewrap/sandbox-exec + egress proxy) | ✅ | modeled (`sandbox.ts`, object-shape lesson) |
| **Sandbox credential redaction** (`SandboxSettings.credentials`, 0.3.211) | 🔬 | new security surface: deny/mask env+files, per-host injection |
| Secure-deployment patterns (credential proxy via `ANTHROPIC_BASE_URL`, TLS proxy, read-only mounts) | ⚪ | `baseUrl`/`customHeaders` exist; no recipe/test |
| Multi-tenant isolation (settingSources:[] + memory-disable + per-tenant `CLAUDE_CONFIG_DIR`/cwd) | 🟡 | pieces exist; no composed recipe |
| `additionalDirectories` / `executable*` / `extraArgs` / `betas` / `pathToClaudeCodeExecutable` | ⚪ | plumbing knobs (reachable via `extraOptions` today) |
| `env` replace-not-merge contract | ✅ | the spread-process.env lesson, locked by tests |
| CLI/wrapper `sdkCompat` contract (manifest, 0.3.211) | ⚪ | version-skew guard for the npm-published worker |

### J. Products built on the envelope (beyond-SDK value-adds)

These consume the surface above and are scored in `coverage.md` §2/§6 and `tui-ux.md`: the daemon
(supervisor/registry/UDS server/rehydration), swarm, proactive/kairos autonomy latch, `cc-harness top`,
the Ink console + chat REPL (~82% visual parity), and the two Codex-protocol consumers
(`cc-codex-appserver`, `claude-plugin-codex`). They are the *proof* the envelope composes into products.

---

## §2 — The math

Counting §1's reachable rows (✅/🟢 realized; 🟡 half; ⚪/🔬 unrealized; 🚫 excluded):
**~67% realized post-Wave-1** (was ~65% post-Workflow: Wave 1 flipped 5 rows — rewind, reinitialize, interrupt receipt, limits classification, background-task control) — consistent with `coverage.md`'s domain-weighted ~63–65%. The
unrealized ~35% clusters in exactly three shapes:

1. **Operational/service maturity** (OTel, hosting/warm-spawn, secure deployment, external
   session-store adapter, billing classification) — the "run it in production" half the docs
   emphasize hardest. Roughly half the gap.
2. **Newly declared 0.3.211 + unprobed surface** (reinitialize, credentials redaction, ReportFindings,
   ClaudeDesign, `/goal` loop, SendMessage, hook events beyond the 8, Monitor, startup()) — cheap to
   settle with probes, then mostly small wires. Roughly a third of the gap.
3. **Knob completion** (~20 unmodeled Options fields + Query methods like reload*/readFile/
   seedReadState) — long tail, each trivial; `extraOptions` already makes them reachable. The rest.

## §3 — The roadmap

Each wave follows the house discipline: **probe → spec → plan → subagent-driven build → unit + gated
live → refresh `coverage.md` + tick this map**. Waves are ordered by product value ÷ cost; items within
a wave are independent (parallelizable).

### Wave 1 — session time-travel + daemon resilience — ✅ SHIPPED 2026-07-17 (probes 37/37b/38/39; spec/plan `2026-07-17-wave1-time-travel-and-resilience`; all 4 items live-verified)

1. **`resumeSessionAt` rewind** — the Esc-Esc conversation rewind, composed with `rewindFiles` into one
   time-travel surface (`Session.rewindTo(messageId, {files?: boolean})` + TUI Esc-Esc + daemon op).
   Probe first: interaction with streaming-input sessions + checkpoint UUIDs (`replay-user-messages` extraArg).
2. **`reinitialize()` live-reattach** — upgrade daemon boot-rehydration from resume-only to control-channel
   recovery; absorb `interrupt()` receipts + `control_request_progress` retry telemetry into daemon events.
3. **Billing/limit classification** — `USAGE_*`/`ORG_POLICY_LIMIT_PREFIXES` matching in Session/daemon error
   paths; surface "subscription disabled / credits exhausted / rate-limited" as typed states (today's
   incident, productized).
4. **Background-task visibility** — consume `background_tasks_changed`, expose `backgroundTasks()`/`stopTask()`
   as Session methods + daemon ops + console panel (pairs naturally with the Workflow knob just shipped).

### Wave 2 — the probe wave (settle every 🔬, then wire the live ones)

One probe file each, cheapest-first: `startup()`/WarmQuery · `SendMessage` inter-agent · hook-event
sweep on 0.3.211 (which of the 22 unverified events fire now; `defer` semantics) · `onUserDialog`/
`onElicitation` · `ReportFindings` · `ClaudeDesign` (`operation:"list"`) · `/goal` `active_goal` loop ·
`Monitor` · sandbox `credentials` · `setMcpPermissionModeOverride`/`RefreshMcpTools` ·
`spawnClaudeCodeProcess`. Expected split, by priors: ~half alive-headless (wire in Wave 1/3 style),
~half bridge/CLI-coupled (document as 🚫, shrinking the denominator honestly).

### Wave 3 — production-service maturity (the OTel wave)

1. **OpenTelemetry** — env-gated exporters in daemon config, span/metric passthrough docs, a
   docker-compose OTLP demo; the flagship observability gap.
2. **Warm-spawn pool** — `startup()`/WarmQuery (if probe passes) in the daemon supervisor: pre-warmed
   subprocess per pool slot, killing first-turn latency.
3. **External session-store reference adapter** — one real backend (Redis or S3) + the SDK conformance
   suite + `mirror_error` surfacing; makes cross-host daemon resume real.
4. **Secure-deployment recipe** — composed multi-tenant isolation (settingSources:[] + memory-disable +
   per-tenant CONFIG_DIR + credential-proxy via `baseUrl`) as a documented, tested `createTenantHarness()` preset.
5. **Runtime MCP topology** — `setMcpServers`/`reconnect`/`toggle` (+ 0.3.211 per-server mode pins) as
   daemon ops + console controls.

### Wave 4 — knob completion + drift watch (continuous)

- Model the remaining Options long tail (`strictMcpConfig`, `additionalDirectories`, `betas`,
  `toolConfig`, `planModeInstructions`, `promptSuggestions`, `agentProgressSummaries`, `includeHookEvents`,
  `debug`/`debugFile`/`stderr`, AgentDefinition's newer per-agent fields) — each a one-line
  `resolveOptions` wire + test; batch as one "knob sweep" increment.
- Tool annotations on our 5 MCP servers; `Zod→runStructured<T>()` convenience.
- **Drift ritual** (monthly or on-demand): re-run the §7 remeasure of `coverage.md` — diff installed vs
  npm HEAD `.d.ts`, sweep the docs list, re-run the probe suite, update this map. The SDK moved 33
  releases in one month; the map rots in weeks, not quarters.

### Standing exclusions (the 🚫 floor)

Agent teams (CLI-only) · `usage().rate_limits` on API-key auth · native `CronCreate` firing /
`PushNotification` transport (headless-dead, probed) · anything claude.ai-bridge-coupled. 0.3.211
*deleted* `runAssistantWorker` and `connectRemoteControl` — the floor shrinks on its own; re-check each
drift pass.
