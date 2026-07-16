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
| `startup()` / `WarmQuery` (pre-warmed CLI subprocess) | ✅ | **W3.2 SHIPPED**: `createWarmPool` (delegating-canUseTool slots, fail-closed unbound; refill/miss/teardown-liveness) + daemon `warmPool:{size}` (default-cfg spawns consume a slot, registry `warm:true`). Probe 40: warm init@51 vs 602ms one-shot; through a STREAMING session both legs pay the message round-trip so the delta is smaller (live-measured) |
| `close()` | ✅ | teardown-liveness suite |
| Built-in tool set (Read/Write/Edit/Bash/Glob/Grep/Web*/Agent/Skill/Task*) | 🟢 | claude_code preset |
| `Monitor` tool (watch background script output) | 🟢 | **Wave 2 probe 47: ALIVE** — registers as a bg task (changed-set entry); **each stdout line wakes a FULL model turn** (cost semantics!); command exit → `task_notification` completed + set empties |
| `ReportFindings` tool (typed review findings) | 🟢 | **Wave 2 probe 44: ALIVE** — callable headlessly; consumers harvest findings from the `tool_use` input (the result is just "N findings reported") |
| `ClaudeDesign` tool | 🚫 | **Wave 2 probe 45: absent headless** (not in the tool inventory; behaviorally confirmed). `DesignSync` exists deferred but is claude.ai-design-project-shaped — bridge-coupled |
| `/goal` `active_goal` loop | 🚫 | **Wave 2 probes 46/46b/46c: UI-command only** — plain-text `/goal` not intercepted, Skill tool refuses ("goal is a UI command"), `<command-name>` wrapper ignored; `active_goal` msg type is declared but nothing headless can set a goal (replicate via our proactive latch instead). Contrast: `/compact` as plain streaming text DOES execute |
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
| Runtime MCP control: `reconnectMcpServer` / `toggleMcpServer` / `setMcpServers` | ✅ | **W3.5 SHIPPED** (probes 52/52b): Session methods + daemon ops (`mcp_status/set_servers/toggle/reconnect/mode_override`; SDK-type rejected over the wire) + chat-REPL `/mcp`. Semantics: add/remove work both server types; reconnect respawns stdio (pid change) and THROWS for SDK-type; **toggle is ADVISORY** (on-demand bring-up resurrects a disabled server — permissions are the gate); `setMcpServers({})` keeps plugin servers |
| `RefreshMcpTools` tool + `setMcpPermissionModeOverride()` (0.3.211) | 🟡 | **Wave 2 probe 49**: override resolves (`{}`) but does NOT silence a `canUseTool` broker (it acts at the rules/classifier layer — consistent with the permission-matrix lesson); `RefreshMcpTools` absent from the inventory even with an SDK server attached (caller-provided servers need no subprocess refresh; external-server case unprobed) |
| MCP auth (HTTP headers / OAuth-token passthrough; `needs-auth` status) | 🟡 | passthrough works; no harness story for token refresh |
| MCP limits (`MCP_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`) | ⚪ | env knobs, expose in config docs |
| `onElicitation` handler | 🟢 | **Wave 2 probes 43/43b: ALIVE for stdio servers** — full round-trip (server `elicitInput` → `Elicitation` hook → `onElicitation` accept+content → `ElicitationResult` hook → content back to the tool). SDK-type in-process servers CANNOT elicit ("Client does not support form elicitation"). Unhandled → auto-decline. Harness wire = config passthrough (Wave 2 follow-up) |
| `onUserDialog` + `supportedDialogKinds` | 🟡 | **Wave 2 probe 43**: intake validation confirmed (kinds without callback throws, fail-closed); wiring both breaks nothing; no deterministic headless trigger exists (`refusal_fallback_prompt` needs a real refusal) — wireable, untriggerable-on-demand |
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
| External `sessionStore` (S3/Redis/Postgres mirror; cross-host resume) | ✅ | **W3.3 SHIPPED**: `createRedisSessionStore` (dependency-free `RedisLike` DI; uuid-idempotent, retry-safe mark-AFTER-write; fold-serialized summaries) + `sessionStoreConformance` suite (SDK InMemory passes core; adapter passes +dedup) + `Session.mirrorErrors` ring + daemon count. **Cross-host resume live-proven** (fresh CLAUDE_CONFIG_DIR + store → recall). Gotcha: SDK REJECTS `enableFileCheckpointing`+`sessionStore` — resolveOptions auto-defaults checkpointing off with a store |
| `sessionStoreFlush` / `loadTimeoutMs` (alpha) | ✅ | W3.3: `sessionStoreFlush` / `sessionStoreLoadTimeoutMs` HarnessConfig knobs wired |
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
| Inter-agent `SendMessage` (v2.1.206+) | 🟢 | **Wave 2 probes 41/41b: ALIVE** — delivery is queued-at-next-tool-round to a RUNNING agent (agents run to completion, they don't idle); address by `name` (spawner must pass it explicitly — models omit it unforced) or by spawn-result agentId; replies travel via `task_notification` + a parent wake turn |
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
| **OpenTelemetry** (metrics/logs, per-user attribution) | ✅ | **W3.1 SHIPPED** (probe 51: ALIVE headless): typed `telemetry` config → env gates in resolveOptions + daemon-wide `DaemonOptions.telemetry`; guide + docker-compose OTLP demo. Live catalog: metrics `claude_code.{session.count,cost.usage,token.usage,active_time.total}`; events `user_prompt/api_request/assistant_response/tool_decision/tool_result/hook_registered`; attrs `session.id`+`prompt.id`(joins hooks)+user.*. **NO traces** (metrics+events only); `logUserPrompts` privacy-defaulted off |
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
| Programmatic `hooks` (all 30 events reachable) | ✅ | probes 09/10; builders + `mergeHooks`; **17/30 verified-fired post-Wave-2** |
| Hook `defer` decision + async side-effect mode | ✅ | **Wave 2 probes 42/42b**: `PreToolUse` `permissionDecision:'defer'` PARKS the call — no execution, no `canUseTool`, no tool_result (the `deferred_tool_use` result shape); it is host-decides-later, not hand-to-broker. Also: safe read-only Bash auto-approves BEFORE `canUseTool`; order is PreToolUse → canUseTool → PermissionRequest (informational — fires on ALLOWED calls too, carries `permission_suggestions`); `PermissionDenied` never fires for callback/hook denials |
| Hook-event sweep on 0.3.211 (which of the 30 fire headlessly) | ✅ | **Wave 2 probes 42/43b — 17/30 FIRE**: the prior 8 + PostToolUseFailure, PostToolBatch, PermissionRequest, TaskCreated, TaskCompleted, MessageDisplay, PostCompact, InstructionsLoaded, Elicitation, ElicitationResult; `SessionStart` fires at the **/compact boundary** (not initial startup; the compact summarizer emits `SubagentStop`). Silent under driven scenarios: Notification, UserPromptExpansion, SessionEnd, StopFailure, SubagentStart, PermissionDenied, Setup, TeammateIdle, ConfigChange, Worktree*, CwdChanged, FileChanged |
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
| Scaling formula / session pinning / resource sizing | 🟡 | partially covered by the W3.4 secure-deployment guide; full ops-sizing guide remains docs-level backlog |
| `spawnClaudeCodeProcess` (custom spawn — VMs/containers/remote) | 🟢 | Wave 2 probe 50: ALIVE end-to-end; W3.4 documents the container-placement pattern in the secure-deployment guide (via `extraOptions`); a first-class config field remains Wave-4 knob-sweep material |
| `sandbox` settings (bubblewrap/sandbox-exec + egress proxy) | ✅ | modeled (`sandbox.ts`, object-shape lesson) |
| **Sandbox credential redaction** (`SandboxSettings.credentials`, 0.3.211) | ✅ | **Wave 2 probe 48: deny-mode VERIFIED** under engaged sandbox-exec — denied env var hidden (control var visible), credential-file read blocked ("Operation not permitted"). Already passes through our `resolveSandbox` spread. `mask` mode (sentinel + proxy `injectHosts`) needs egress-proxy infra — untested. **W3.4**: now a typed `sandbox.credentials` field, composed by `tenantHarnessConfig` (live: deny held; the model itself refused the exfiltration-shaped prompt) |
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
**~78% realized post-Wave-3** (was ~71% post-Wave-2, ~67% post-Wave-1: Wave 3 shipped the entire
operational-maturity cluster — OTel ✅ (probe 51 alive; typed config + daemon-wide + guide/demo),
warm-spawn pool ✅ (delegating-broker slots + daemon warm path), external session-store ✅ (Redis
reference adapter + conformance suite + mirror_error + cross-host-resume live proof), secure
deployment ✅ (`tenantHarnessConfig` + guide), runtime MCP topology ✅ (probes 52/52b; Session/daemon/
console surfaces, toggle-advisory documented)) — consistent with `coverage.md`'s domain-weighted
score. The unrealized ~22% is now dominated by ONE shape:

1. **Knob completion** (~20 unmodeled Options fields + Query methods like reload*/readFile/
   seedReadState, first-class `spawnClaudeCodeProcess`/`onElicitation` config fields) — long tail,
   each trivial; `extraOptions` already makes them reachable. Wave 4.
2. Residual ops depth: mask-mode credentials (needs egress proxy), full scaling/sizing ops guide,
   `control_request_progress` telemetry — small, documented, unblocked.

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

### Wave 2 — the probe wave — ✅ PROBED 2026-07-17 (probes 40–50 + b/c variants; all 12 🔬 settled live)

Outcome (details in the §1 rows): **8 alive** — startup()/WarmQuery (probe 40), SendMessage (41/41b),
hook sweep 17/30 + defer-parks-the-call (42/42b), onElicitation stdio round-trip (43/43b),
ReportFindings (44), Monitor (47, each-line-wakes-a-turn), sandbox credentials deny-mode (48),
spawnClaudeCodeProcess (50). **2 partial** — setMcpPermissionModeOverride resolves but is
rules-layer-only + RefreshMcpTools absent for SDK servers (49); onUserDialog wireable but has no
deterministic headless trigger (43). **2 dead 🚫** — ClaudeDesign (45), `/goal` (46/46b/46c).
The prior's "~half bridge-coupled" was wrong — the split landed 8/2/2. No harness wire was needed:
the alive tools are default-on in every session, sandbox credentials already flow through
`resolveSandbox`, and the callback surfaces (onElicitation/onUserDialog/spawnClaudeCodeProcess) are
reachable today via `extraOptions` (merged last into SDK Options). First-class config fields land
with their consumers in Wave 3 (warm pool ← startup(); tenant recipe ← credentials/spawn).

### Wave 3 — production-service maturity — ✅ SHIPPED 2026-07-17 (probes 51/52/52b; spec/plan `2026-07-17-wave3-production-maturity`; all 5 increments live-verified)

Shipped as five increments (each unit + gated-live tested; commits 59a5b2e3d8/4197c78e87/1f13851d20/
9ae1f3cd40/5921b3e09b; details in the §1 rows):

1. **OpenTelemetry (W3.1)** — probe 51 proved env-gated OTLP alive headless; typed `telemetry` config
   → env gates in resolveOptions, daemon-wide `DaemonOptions.telemetry`, `docs/guides/observability-otel.md`
   + `examples/otel/` compose demo. Metrics+events only (no traces); prompts privacy-defaulted out.
2. **Warm-spawn pool (W3.2)** — `createWarmPool` (frozen-Options slots with DELEGATING canUseTool,
   fail-closed unbound) + daemon warm path for default-cfg spawns (`warm:true` registry flag). The
   frozen-Options constraint excludes resume/sessionOptions/context-compact-tool spawns by design.
3. **Session-store adapter (W3.3)** — `createRedisSessionStore` (RedisLike DI, uuid-idempotent with
   retry-safe mark-after-write) + `sessionStoreConformance` + `mirrorErrors` surfacing + flush/timeout
   knobs; live cross-host resume (fresh CONFIG_DIR). Found: SDK rejects checkpointing+store → auto-off.
4. **Secure-deployment recipe (W3.4)** — `tenantHarnessConfig` preset (settings/state/secret/proxy/
   attribution isolation) + `docs/guides/secure-deployment.md`; live deny proof; the model itself
   refused the exfiltration-shaped probe (defense in depth above the sandbox).
5. **Runtime MCP topology (W3.5)** — probes 52/52b settled the trio's semantics (toggle ADVISORY —
   on-demand bring-up resurrects disabled servers); Session methods + daemon ops + `/mcp` console cmd.

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
