# SDK Potential — Realized vs. Available

> Companion to `parity.json` / `roadmap.md`. Those score **Claude Code feature parity** (551 CC
> features → SDK). This scores the inverse: **of the Agent SDK's own capability envelope, how much
> have we actually realized?** Measured 2026-06-17 against `@anthropic-ai/claude-agent-sdk@0.3.178`
> from the installed `.d.ts` and live probes — not the Feb snapshot.
>
> **Shipped since first draft:**
> - **Session persistence spine** (domain 5) — `resume` / `persistSession` / `sessionStore` config
>   passthrough, `resumeHarness()`, `--resume` / `--no-persist` CLI flags, daemon `spawn({resume})`.
>   Spec `specs/2026-06-17-session-persistence-spine-design.md`, commits `99cab31..583f0db`.
> - **Observability read API** (domain 6) — `src/sessions/reader.ts` (`listSessions` /
>   `getSessionMessages` / `getSessionInfo`, `cwd`→`dir`), `Harness.getContextUsage()` / `accountInfo()`,
>   daemon `sessions` / `messages` ops + `context_usage` / `account_info` control frames.
>   Spec `specs/2026-06-17-observability-read-api-design.md`, commits `798ea5b..14f8c09`.
> - **Context introspection tool** (domain 6, *agent-facing*) — `src/context/server.ts` `cc-context` MCP
>   server with one `GetContextUsage` tool (`summarizeUsage` → `{percentUsed, tokensUsed, maxTokens,
>   tokensRemaining, status}`), opt-in via `createHarness({ contextTool })` and daemon-wide
>   `DaemonOptions.contextTool`; late-bound `QueryHolder` seam (no re-entrancy deadlock). Read-only.
>   Spec `specs/2026-06-17-context-introspection-tool-design.md`, commits `eb4415a..9fd074b`.
> - **Self-compaction** (domain 1/6, context lifecycle) — config knobs `autoCompactEnabled`/`autoCompactWindow`
>   (→ `options.settings`, all paths), a daemon on-demand `compact()` op (`DaemonSession.compact()` injects
>   `/compact` via a shared `enqueueTurn`, parses `compact_result`/`compact_boundary` → `CompactOutcome`), and an
>   opt-in agent-facing `cc-compact` `RequestCompaction` tool that fires `/compact` at the turn boundary
>   (intent flag consumed in `readLoop`, fire-and-forget, own FIFO waiter). On-demand is **daemon-only** (no
>   `Query.compact()` method; one-shot has no input queue). Live: 31590→5664 tokens. Spec
>   `specs/2026-06-17-self-compaction-design.md`, commits `0faf597..b62d006`.
> - **Lib interactive `Session` primitive** (domain 5/1/6) — `src/session/session.ts` promotes
>   `DaemonSession`'s streaming engine into a public, daemon-independent `Session` (open → `submit` turns →
>   `compact()`/control/`getContextUsage`/`rewind` → `.sessionId` (captured from `init`, capture-once) →
>   `resume` → `dispose`), `openSession`/`resumeSession` factories, a `stream()` convenience; `DaemonSession`
>   is now a thin `extends Session` subclass (129→19 lines). **Lifts the "multi-turn = daemon-only" restriction:**
>   on-demand `compact()`, `cc-context`, and the control surface now work library-side too. Spec
>   `specs/2026-06-17-lib-session-primitive-design.md`, commits `d0e209a..c87a414`. Live 3/3 (stable sessionId,
>   compact, resume round-trip preserving the id). Keystone of the 3-spec session cluster (Specs 2 & 3 depend on `.sessionId`).
> - **Daemon durable sessions** (domain 5) — `SessionRecord` gains `sessionId` (captured from `Session.sessionId`,
>   persisted in `supervisor.submit()`); on-failure `restart()` now RESUMES that captured sdk session (context
>   intact) instead of going fresh (the `supervisor.ts:248` bug). Resumes the CAPTURED id, not the spawn-time hint;
>   fresh if none captured (graceful degradation). Link-not-swap (registry stays the operational store; the SDK
>   owns the transcript). Spec `specs/2026-06-17-daemon-durable-sessions-design.md`, commits `42acf43..880d0a5`.
>   Live 1/1 (a daemon turn captured a real UUID; that id resumed + recalled).
> - **Session forking** (domain 5) — `src/sessions/fork.ts` `forkSession(id, opts?)` wraps the SDK fork fn
>   (`cwd`→`dir` + DI, mirrors `reader.ts`) + a daemon `fork` op (`supervisor.fork(id)` reads the live
>   `Session.sessionId`, mints a fork, spawns a new session resuming it). Fork MINTS a new id (original
>   untouched), reached via `resumeSession(forkId)` — the explicit branch, vs `resume` which preserves the id.
>   Spec `specs/2026-06-17-session-forking-design.md`, commits `d968a1b..7abd8c4`. Live 1/1 (the branch recalled
>   the pre-fork codeword but NOT the original's post-fork one — a true independent branch). **Completes the
>   3-spec session cluster.**

## How to read this

"How much of the SDK have we used?" has two honest denominators:

1. **Raw API surface** — how many of the SDK's typed knobs we touch (§3). A *low* number here is the
   intended design: 313 of 551 CC features are verdict `provided`, i.e. the SDK already does them
   natively, so consuming more of the API would mean re-implementing what is free.
2. **Capability envelope** — of everything the SDK *makes possible*, how much have we turned into
   working harness capability (§2). This is the number that answers "considering the SDK's full
   potential, how much have we made?"

**Headline:** we have realized roughly **~57% of the SDK's reachable capability envelope** — strong
(60–90%) on the *execution & orchestration* half (turn loop, tools, permissions, multi-agent,
settings, autonomy). The *state & observability* half has now largely closed: **persistence** (domain 5,
~85% — the full session cluster: interactive `Session` primitive, durable daemon sessions, forking), the
**observability read API**, the **agent-facing context tools** (domain 6), and now **programmatic hooks**
(domain 8 — typed `config.hooks` passthrough + builders) are all built. The remaining frontiers are more
incremental: turn-level surfaces (partial messages, `thinking`/`effort`, budget caps) and deeper
plugin/skill lifecycle integration.

---

## §1 — Verification status legend

- **✅ built** — shipped in `harness/src`, unit + (mostly) live tested.
- **🟡 verified-unused** — probed live this session, works headlessly, not yet wired into the harness.
- **⚪ untouched** — available in the SDK, neither built nor probed.
- **🚫 unreachable** — bridge-/claude.ai-coupled or build-internal; out by definition.

---

## §2 — Capability-domain scorecard

Each domain is a slice of the SDK's potential. "Realized" = fraction turned into working harness
capability, weighted by what is *reachable* (🚫 items excluded from the denominator).

| # | Capability domain | Realized | State | Evidence / gap |
|---|---|---|---|---|
| 1 | **Turn execution & streaming** — `query()` loop, streaming I/O, partial messages, `thinking`/`effort`, `maxTurns`/`maxBudgetUsd`/`taskBudget`, compaction | ~68% | ✅ core | `daemon/session` drives `query()` via a shared `Session` engine; **multi-turn now lib-side too** (`openSession`/`Session.submit`/`stream`); **compaction built** (config `autoCompact*` all paths + on-demand `compact()` + agent-triggered `cc-compact`, now lib + daemon); partial-messages, `thinking`/`effort`, budget caps not surfaced |
| 2 | **Tool system** — 37 native tools (default-on), `createSdkMcpServer`+`tool()`, allow/deny/`toolAliases`, `toolConfig` | ~70% | ✅ | 3 MCP servers built (tasks/swarm/brief); gating wired; `toolConfig`/`tools` allowlist-shaping partial |
| 3 | **Permission & safety** — 6 `permissionMode`s, `canUseTool`, `sandbox`, `allowDangerouslySkip` | ~75% | ✅ | 4/6 modes exercised (default/plan/auto/bypass-gated); `canUseTool` broker in swarm; sandbox modeled |
| 4 | **Multi-agent** — `agents`/`AgentDefinition`, native subagents, `Agent`/`Task*` tools, coordination | ~70% | ✅ | `swarm/` coordinator + bus + teammates; native subagent transcripts (`listSubagents`) unused |
| 5 | **Session lifecycle & persistence** — `resume`, `forkSession`, `persistSession`, `sessionStore`, `enableFileCheckpointing`+`rewindFiles` | **~85%** | ✅ built | **Full session cluster shipped (3 of 3):** `resume`/`persistSession`/`sessionStore` config, `resumeHarness()`, CLI flags, daemon `spawn({resume})`, `rewindFiles`; **lib `Session` primitive** (`openSession`/`resumeSession`, multi-turn + `.sessionId` capture + `resume` preserves id); **daemon durable sessions** (`SessionRecord.sessionId` persisted; on-failure `restart()` resumes the captured session); **forking** (`forkSession` lib wrapper + daemon `fork` op — mints a new id, branch reached via resume). Deferred: surviving a full daemon-process restart (boot rehydration); session write/mutation ops |
| 6 | **Introspection & observability** — `getContextUsage`, `usage`, `accountInfo`, `mcpServerStatus`, `listSessions`/`getSessionMessages`/`getSessionInfo`, `supportedModels`/`Commands`/`Agents`, `initializationResult` | **~82%** | ✅ built | **Read API + agent-facing tool shipped:** reader module (`listSessions`/`getSessionMessages`/`getSessionInfo`, `cwd`→`dir`), `Harness.getContextUsage()`/`accountInfo()`, daemon `sessions`/`messages` ops + `context_usage`/`account_info` frames; **`cc-context` `GetContextUsage` MCP tool** (model self-introspection, lib + daemon opt-in); models/commands/mcpStatus via `bridge/`. Unbuilt: `usage` (EXPERIMENTAL rate-limit data), `initializationResult` full payload |
| 7 | **Scheduling & autonomy** — proactive self-wake, `CronCreate`, `PushNotification`, assistant worker | ~50%¹ | ✅/🚫 | `proactive/` + `kairos/` latch built; cron dead headless, push has no transport, worker bridge-coupled |
| 8 | **Extensibility** — `plugins`, `skills`, **30 hook events**, output styles, dynamic MCP | **~60%** | ✅ | plugins/skills/styles/MCP passthrough; **programmatic hooks shipped** — typed `config.hooks` → `options.hooks` (all 30 reachable), `injectContext`/`guardTool`/`blockTool`/`observe` builders + `mergeHooks` for the live-verified subset (8 of 30 fire headlessly; `SessionStart`/`SessionEnd` dormant via the programmatic path — documented, no builder), daemon path via `sessionOptions`. Deeper plugin/skill lifecycle integration remains |
| 9 | **Settings & config** — `settingSources` cascade, `settings`/`managedSettings`, provider/env, sandbox | ~90% | ✅ | fully modeled in `config/`; `applyFlagSettings` (mid-session merge) unused |
| 10 | **Remote / bridge / voice / UI** — `connectRemoteControl`, remote server, voice, Ink TUI | ~10%¹ | ✅/🚫 | `bridge/` control-protocol shim built; remote/voice/UI are Phase-3, mostly 🚫/non-goal **by design** |

¹ Of the *reachable* sub-surface — much of domains 7 and 10 is 🚫 unreachable (bridge-coupled), so the
low number is a design boundary, not a shortfall.

**Reading the shape:** domains 1–4 + 9 (execution, tools, permissions, multi-agent, config) are the
orchestration substrate — the part the SDK does *not* hand you — and they sit at 60–90%. Domains 5
(persistence — now incl. the lib interactive `Session` primitive) and 6 (observability) have joined them
with the spine + read API + the interactive session surface. **Domain 8 (hooks) now ships first-class
programmatic hooks** (`config.hooks` + builders; 8 of 30 events verified-fired, all 30 reachable via
passthrough). The remaining ready-made levers are incremental — turn-level surfaces (partial messages,
`thinking`/`effort`, budget caps) in domain 1 and `usage`/`initializationResult` in domain 6. Domains 7,
10 are capped by bridge-coupling we cannot cross headlessly.

---

## §3 — Raw API surface reference

| SDK surface | Size | We use | Note |
|---|---|---|---|
| `Options` fields | 63 | ~29 modeled in `resolveOptions` (now incl. `resume`/`persistSession`/`sessionStore`) + `extraOptions` escape hatch | passthrough makes all 63 *reachable* |
| `Query` control methods | ~25 | 9 (`interrupt`, `setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `rewindFiles`, `getContextUsage`, `accountInfo`, init/`supportedModels`/`supportedCommands`/`supportedAgents`) | ~16 unused; `usage` (EXPERIMENTAL) + mutation/store-mgmt methods remain |
| Core builders (`query`, `createSdkMcpServer`, `tool`) | 3 | 3 | 100% |
| In-process MCP servers built | — | 5 (`cc-tasks`, `cc-swarm`, `cc-brief`, `cc-context`, `cc-compact`) | `cc-context` = self-introspection (`GetContextUsage`); `cc-compact` = self-compaction (`RequestCompaction`) |
| Native model tools | 37 | 0 reimplemented; 2 deliberately shadowed by our MCP (Task→swarm, Tasks); `CronCreate` probed dead | rely-on, not consume |
| Subpath exports | 7 | 1 used (`.`), 2 probed-and-rejected (`/assistant`, `/bridge`), 1 types-only (`/sdk-tools`) | — |
| Hook events (`HOOK_EVENTS`) | 30 | first-class `config.hooks` + 4 builders + `mergeHooks` | 8 verified-fired headlessly; all 30 reachable via passthrough; SessionStart/End dormant (documented) |
| `permissionMode` values | 6 | 4 exercised | default/plan/auto/bypass(gated) |
| Session-store top-level fns | 10 | 4 used (`listSessions`/`getSessionMessages`/`getSessionInfo` via `sessions/reader.ts`, `forkSession` via `sessions/fork.ts`); `resume`/`persistSession`/`sessionStore` (Options) wired | unused: write/mutation fns (`renameSession`/`tagSession`/`deleteSession`, non-goal) |

---

## §4 — The session-store + introspection family (verified live 2026-06-17)

This was the largest *available-but-unbuilt* lever, and unlike cron/push it is **fully functional
headlessly with an API key**. Probe (`probe-sessionstore.mjs`, model `claude-haiku-4-5`) results, now
annotated with build status — **✅ shipped** (persistence spine or observability read API),
**⚪ deferred**:

| API | Result | Status / implication |
|---|---|---|
| persist → **resume** round-trip | recalled the codeword across two separate `query()` calls (`true`) | **✅ shipped** (persistence) — `resume` config + `resumeHarness()` + daemon `spawn({resume})` |
| `InMemorySessionStore` injection (`sessionStore`) | custom store received the mirror (`size: 1`) | **✅ shipped** (persistence) — `sessionStore` config passthrough (BYO backend seam) |
| `enableFileCheckpointing` + `Query.rewindFiles(id)` | two-turn edit (VERSION_ONE→TWO) **reverted to VERSION_ONE on disk**; `dryRun` returns `{canRewind, filesChanged, insertions, deletions}` | **✅ shipped** (persistence) — `Harness.rewind` (checkpointing default-on); undo/time-travel |
| `getContextUsage()` | 17-field breakdown — `totalTokens: 26191`, `maxTokens`, `percentage`, per-category `memoryFiles`/`mcpTools`/`agents`/`skills`/`slashCommands`, `messageBreakdown`, `apiUsage`, autocompact state | **✅ shipped** (observability) — `Harness.getContextUsage()` + daemon `context_usage` frame; **+ agent-facing** `cc-context` `GetContextUsage` MCP tool (model self-introspection, `summarizeUsage` concise digest), spec `2026-06-17-context-introspection-tool-design.md` |
| `listSessions()` | `array[801]` w/ `sessionId, summary, firstPrompt, gitBranch, cwd, tag, createdAt, lastModified` | **✅ shipped** (observability) — `sessions/reader.ts` + daemon `sessions` op; **`cwd`→`dir` scoping is the actual fix** (the "global store" was a probe passing a non-field `cwd`) |
| `getSessionMessages(id)` | transcript `array[3]` | **✅ shipped** (observability) — reader + daemon `messages` op |
| `accountInfo()` | `{tokenSource, apiKeySource, apiProvider}` | **✅ shipped** (observability) — `Harness.accountInfo()` + daemon `account_info` frame |
| `supportedModels` / `Commands` / `Agents` / `mcpServerStatus` | arrays `[6]` / `[94]` / `[15]` / `[6]` | **✅ shipped** — `bridge/` + `Harness` capability methods |
| `forkSession(id)` | new `{sessionId}` (resume PRESERVES the id, fork MINTS a new one) | **✅ shipped** — `sessions/fork.ts` (`cwd`→`dir` wrapper) + daemon `fork` op; live-verified true independent branch (Spec 3 `session-forking`) |

**Wiring lesson (verified):** `rewindFiles()`'s anchor must be a genuine **user-prompt UUID**, resolved
from the transcript via `getSessionMessages()` — **not** from live stream frames (in streaming mode the
`type:"user"` frames are tool-results, which carry no checkpoint and return "No file checkpoint found").

**Hooks (domain 8) — SHIPPED** (`hooks-support`, 2026-06-18): first-class programmatic hooks — typed
`config.hooks` → `options.hooks` passthrough (all 30 `HOOK_EVENTS` reachable), the `injectContext` /
`guardTool` / `blockTool` / `observe` builders + `mergeHooks`, public type re-exports, and the daemon path
via the existing `sessionOptions` factory (no daemon code change). Live-probed first (`probes/probes/09-hooks-coverage.ts`,
`10`): **8 of 30 events fire headlessly** (PreToolUse/PostToolUse/PostToolBatch/UserPromptSubmit/Stop/
SubagentStart/SubagentStop/MessageDisplay); context-injection + tool-block + subagent-attribution all
verified; `SessionStart`/`SessionEnd` dormant via the programmatic path (documented, no builder). Unit
+15 (328 total¹), live 2/2 keyed. The **session cluster is also COMPLETE (3 of 3)**.

**Remaining frontiers** (incremental, ready-made): turn-level surfaces (partial messages, `thinking`/`effort`,
budget caps) in domain 1; the EXPERIMENTAL `usage` (plan rate-limit) + full `initializationResult` in
domain 6; deeper plugin/skill lifecycle integration in domain 8; and the deferred session sub-projects
(daemon-process-restart boot rehydration, session write/mutation ops `renameSession`/`tagSession`/`deleteSession`).

¹ unit suite count at hooks completion; verify with `npx vitest run test/unit` as the suite grows.

---

## §5 — Permanently out of reach (the 🚫 floor)

58 parity items are `not-possible` and ~77 are non-goals: claude.ai bridge-coupled surfaces
(`connectRemoteControl`, `runAssistantWorker`, `RemoteTrigger`, native `CronCreate` firing,
`PushNotification` transport), build-internal feature-flag/DCE gating, and the interactive Ink TUI
(deferred under the "harden & ship over Phase 3" decision). These are excluded from every "realized"
fraction above — measuring against them would understate true coverage of the reachable envelope.
