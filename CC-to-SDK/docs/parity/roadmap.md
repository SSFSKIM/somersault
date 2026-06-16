# CC → Agent SDK — Build Roadmap

Derived from the parity map (`INDEX.md`, 551 rows). This sequences the work of replicating the Claude
Code harness on the TypeScript Agent SDK into three phases, each its own spec→plan→build cycle.

## Thesis

The Agent SDK **is** Claude Code's engine, bundled as a native binary. So **246 of 551 features are
✅ Provided** — the agent loop, all built-in tools, permissions, hooks, subagents, MCP, sessions,
compaction, skills/plugins/commands loading. We do not rebuild those; we **wire and verify** them.
The remaining work is the **harness shell** the SDK omits: config glue (🔧 Configurable), the extra
runtimes/modes (🏗 build, headless), and the interactive terminal UI (🏗 build, the bulk of the LoC).

| Phase | Scope | Rows | Make-up |
|---|---|---|---|
| **1 — Headless core** | Wire + verify everything the SDK provides; supply config content | 262 | 246 ✅ · 16 🔧 |
| **2 — Modes & advanced** | Non-UI runtimes/backends + advanced config on top of the SDK | 133 | 58 ✅ · 35 🔧 · 40 🏗 |
| **3 — Interactive TUI** | The Ink REPL + component surface + vim + style picker | 79 | 66 🏗 · 6 🔧 · 7 ✅ |
| **Non-goals** | Can't or won't replicate | 77 | 58 🚫 · 19 out-of-scope |

---

## Phase 1 — Headless harness core

**Goal:** a programmatic harness that reproduces Claude Code's *behavior* headlessly: drive `query()`
with the `claude_code` system-prompt preset, wire every config surface, and verify parity against CC.

**Delivers (the 262 P1 rows):**
- The query loop, streaming, retries, compaction, cost/budgets — ✅ via `query()` + `Options`
  (`maxTurns`/`maxBudgetUsd`/`taskBudget`/`thinking`/`effort`/`fallbackModel`).
- All built-in tools (Bash/Read/Write/Edit/Glob/Grep/Web*/Monitor/AskUserQuestion) — ✅ tool preset.
- Permissions — ✅ `permissionMode` + `canUseTool` + settings rules (bridge CC's `ToolName(content)`
  rule grammar ↔ the SDK's structured `PermissionUpdate`; see rows 09.1/09.5/09.12).
- Hooks — ✅ all 30 SDK hook events; map CC's user-config hooks onto SDK callbacks.
- Subagents — ✅ `agents`/`AgentDefinition` + `Agent` tool.
- MCP — ✅ `mcpServers` + `createSdkMcpServer`/`tool()`; LSP via the `LSP` tool.
- Sessions/memory — ✅ `resume`/`forkSession`/`sessionStore` + `listSessions`…; `CLAUDE.md` via
  `settingSources`; `SDKMemoryRecallMessage`.
- **The 16 🔧 Configurable items to actually build:** settings precedence shims (note SDK
  `settingSources` defaults to *none* vs CLI *all*, and `'project'` is required for CLAUDE.md —
  rows 02.x), custom slash commands / skills authoring (20.2/17.x), `outputFormat` structured results,
  telemetry via OTel env (`CLAUDE_CODE_ENABLE_TELEMETRY`), provider selection (Bedrock/Vertex/Foundry
  env), memory auto-extraction via a Stop hook.

**Dependencies:** none — this is the foundation. **Verification:** the 25 already-`verified` rows are
P1's smoke tests; extend with parity diffs against the real CLI.

---

## Phase 2 — Non-UI modes & advanced features

**Goal:** the long-running runtimes and orchestration CC has that the SDK does *not* ship, built as
headless services around `query()`/`streamInput`/`sessionStore`.

**Delivers (the 133 P2 rows — 40 🏗 + 35 🔧):**
- **Multi-agent coordinator / swarm (the biggest 🏗 gap):** `spawnTeammate`, team create/delete,
  `SendMessage` mailbox, the orchestrator persona, worker→leader permission bridge, shutdown/plan
  handshakes. The SDK's `agents` gives child-subagent dispatch, **not** peer-Claude orchestration
  (rows 30.x, 14.x). Task* durable-store *tools* (TaskCreate/Update/…) also build here (SDK exposes
  Task* *messages/hooks*, not model-facing task-CRUD tools) — implement via `createSdkMcpServer`.
- **Mode backends:** daemon (server around `query()`), bridge (IDE/transport translation, safe-command
  allowlist), proactive (tick/idle loop), voice backend (STT/TTS wiring), remote direct-connect client.
- **Advanced config (🔧):** plugin marketplace install (SDK `plugins` is `type:'local'` only — vendor
  remote plugins locally), managed/enterprise policy via `managedSettings`, MCP server OAuth via
  `onElicitation` + headers.

**Dependencies:** Phase 1 (uses the core query loop, sessions, permissions, MCP).

---

## Phase 3 — Interactive TUI

**Goal:** the terminal UI — the largest LoC chunk of the reference (~127K) and ~589 cataloged UI files.

**Delivers (the 79 P3 rows — 66 🏗):** the Ink/React REPL shell + render loop; the component surface
rolled into families (message/transcript renderers ← `SDKAssistantMessage`/`SDKPartialAssistantMessage`;
tool-result renderers; permission dialogs ~49 ← `canUseTool` suggestions + `SDKPermissionDeniedMessage`;
MCP/elicitation dialogs; swarm view ← subagent-tagged messages; input composer/@-mention; status &
cost/context bars ← `SDKResultMessage`/`getContextUsage()`/`SDKRateLimitEvent`; model/command pickers
← `supportedModels()`/`supportedCommands()`; onboarding/setup; plan-mode UI); **vim keybindings**; and
the **output-style picker** (note: output styles are 🔧 via `systemPrompt` preset-append / settings —
`outputStyle` is NOT a real SDK option; only the picker UI is build).

**Key enabler:** the SDK already emits the rich message stream a UI renders (`includePartialMessages`,
`includeHookEvents`, `SDKToolProgressMessage`, `SDKStatusMessage`, …). Phase 3 is a *rendering* layer
over data Phases 1–2 already produce.

**Dependencies:** Phases 1–2 (renders their output).

---

## Non-goals (77 rows)

**🚫 Not-possible (58):** anything tied to **claude.ai OAuth login / claude.ai rate limits**
(Anthropic contractually forbids 3rd-party SDK apps from offering it — use API-key/Bedrock/Vertex/
Foundry), the **claudeai-proxy** transport, RemoteTrigger/PushNotification/Brief and other
KAIROS/Remote-Control features bound to internal endpoints, Teleport `/ultrareview`, CCR cloud
containers, the hosted voice-stream STT endpoint, the official Anthropic plugin marketplace (GCS),
and internal analytics (1P BigQuery/Datadog/GrowthBook/Perfetto).

**Out-of-scope build (19):** ant-internal, build-stripped, or telemetry/hosting-infra plumbing the fork
contains but that has no product value to replicate (e.g. git/PR analytics counters, BYOC file
persistence, embedded search-binary swaps, the OpenAI provider path — `build` but out of scope for a
CC-parity harness unless multi-provider is explicitly wanted).

---

## Since-February delta

7 capabilities are newer than the Feb source (see `since-february.md`): `/goal`, bundled
`/deep-research`, `ScheduleWakeup`, `DesignSync`, the `ultracode` workflow opt-in, and the Grep `-o`
flag (an SDK *superset*). All are slotted into the phases above by their `targetPhase` tag.
