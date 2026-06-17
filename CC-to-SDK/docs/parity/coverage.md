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

## How to read this

"How much of the SDK have we used?" has two honest denominators:

1. **Raw API surface** — how many of the SDK's typed knobs we touch (§3). A *low* number here is the
   intended design: 313 of 551 CC features are verdict `provided`, i.e. the SDK already does them
   natively, so consuming more of the API would mean re-implementing what is free.
2. **Capability envelope** — of everything the SDK *makes possible*, how much have we turned into
   working harness capability (§2). This is the number that answers "considering the SDK's full
   potential, how much have we made?"

**Headline:** we have realized roughly **~53% of the SDK's reachable capability envelope** — strong
(60–90%) on the *execution & orchestration* half (turn loop, tools, permissions, multi-agent,
settings, autonomy). The *state & observability* half has now largely closed: **persistence** (domain 5)
and the **observability read API** (domain 6) are both built. The largest remaining near-term frontier
is **hooks** (domain 8 — 0 of 30 events), verified-reachable and unbuilt.

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
| 1 | **Turn execution & streaming** — `query()` loop, streaming I/O, partial messages, `thinking`/`effort`, `maxTurns`/`maxBudgetUsd`/`taskBudget` | ~60% | ✅ core | `daemon/session` drives `query()`; partial-messages, `thinking`/`effort`, budget caps not surfaced |
| 2 | **Tool system** — 37 native tools (default-on), `createSdkMcpServer`+`tool()`, allow/deny/`toolAliases`, `toolConfig` | ~70% | ✅ | 3 MCP servers built (tasks/swarm/brief); gating wired; `toolConfig`/`tools` allowlist-shaping partial |
| 3 | **Permission & safety** — 6 `permissionMode`s, `canUseTool`, `sandbox`, `allowDangerouslySkip` | ~75% | ✅ | 4/6 modes exercised (default/plan/auto/bypass-gated); `canUseTool` broker in swarm; sandbox modeled |
| 4 | **Multi-agent** — `agents`/`AgentDefinition`, native subagents, `Agent`/`Task*` tools, coordination | ~70% | ✅ | `swarm/` coordinator + bus + teammates; native subagent transcripts (`listSubagents`) unused |
| 5 | **Session lifecycle & persistence** — `resume`, `forkSession`, `persistSession`, `sessionStore`, `enableFileCheckpointing`+`rewindFiles` | **~60%** | ✅ built | **Spine shipped:** `resume`/`persistSession`/`sessionStore` config, `resumeHarness()`, CLI flags, daemon `spawn({resume})`, `rewindFiles` (Harness.rewind). Deferred: `forkSession`, daemon restart-with-resume, `SessionRecord`-index persistence |
| 6 | **Introspection & observability** — `getContextUsage`, `usage`, `accountInfo`, `mcpServerStatus`, `listSessions`/`getSessionMessages`/`getSessionInfo`, `supportedModels`/`Commands`/`Agents`, `initializationResult` | **~80%** | ✅ built | **Read API shipped:** reader module (`listSessions`/`getSessionMessages`/`getSessionInfo`, `cwd`→`dir`), `Harness.getContextUsage()`/`accountInfo()`, daemon `sessions`/`messages` ops + `context_usage`/`account_info` frames; models/commands/mcpStatus via `bridge/`. Unbuilt: `usage` (EXPERIMENTAL rate-limit data), `initializationResult` full payload |
| 7 | **Scheduling & autonomy** — proactive self-wake, `CronCreate`, `PushNotification`, assistant worker | ~50%¹ | ✅/🚫 | `proactive/` + `kairos/` latch built; cron dead headless, push has no transport, worker bridge-coupled |
| 8 | **Extensibility** — `plugins`, `skills`, **30 hook events**, output styles, dynamic MCP | ~40% | ✅/⚪ | plugins/skills/styles/MCP passthrough; **0 of 30 hook events** handled (largest extensibility gap) |
| 9 | **Settings & config** — `settingSources` cascade, `settings`/`managedSettings`, provider/env, sandbox | ~90% | ✅ | fully modeled in `config/`; `applyFlagSettings` (mid-session merge) unused |
| 10 | **Remote / bridge / voice / UI** — `connectRemoteControl`, remote server, voice, Ink TUI | ~10%¹ | ✅/🚫 | `bridge/` control-protocol shim built; remote/voice/UI are Phase-3, mostly 🚫/non-goal **by design** |

¹ Of the *reachable* sub-surface — much of domains 7 and 10 is 🚫 unreachable (bridge-coupled), so the
low number is a design boundary, not a shortfall.

**Reading the shape:** domains 1–4 + 9 (execution, tools, permissions, multi-agent, config) are the
orchestration substrate — the part the SDK does *not* hand you — and they sit at 60–90%. Domains 5
(persistence) and 6 (observability) have now joined them with the spine + read API. **Domain 8 (hooks,
0 of 30 events) is the largest remaining ready-made-but-unbuilt lever.** Domains 7, 10 are capped by
bridge-coupling we cannot cross headlessly.

---

## §3 — Raw API surface reference

| SDK surface | Size | We use | Note |
|---|---|---|---|
| `Options` fields | 63 | ~29 modeled in `resolveOptions` (now incl. `resume`/`persistSession`/`sessionStore`) + `extraOptions` escape hatch | passthrough makes all 63 *reachable* |
| `Query` control methods | ~25 | 9 (`interrupt`, `setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `rewindFiles`, `getContextUsage`, `accountInfo`, init/`supportedModels`/`supportedCommands`/`supportedAgents`) | ~16 unused; `usage` (EXPERIMENTAL) + mutation/store-mgmt methods remain |
| Core builders (`query`, `createSdkMcpServer`, `tool`) | 3 | 3 | 100% |
| In-process MCP servers built | — | 3 (`cc-tasks`, `cc-swarm`, `cc-brief`) | — |
| Native model tools | 37 | 0 reimplemented; 2 deliberately shadowed by our MCP (Task→swarm, Tasks); `CronCreate` probed dead | rely-on, not consume |
| Subpath exports | 7 | 1 used (`.`), 2 probed-and-rejected (`/assistant`, `/bridge`), 1 types-only (`/sdk-tools`) | — |
| Hook events (`HOOK_EVENTS`) | 30 | 0 handlers | option wired, no callbacks |
| `permissionMode` values | 6 | 4 exercised | default/plan/auto/bypass(gated) |
| Session-store top-level fns | 10 | 3 used (`listSessions`/`getSessionMessages`/`getSessionInfo` via `sessions/reader.ts`); `resume`/`persistSession`/`sessionStore` (Options) wired | unused: `forkSession` (deferred) + write/mutation fns (`renameSession`/`tagSession`/`deleteSession`, non-goal) |

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
| `getContextUsage()` | 17-field breakdown — `totalTokens: 26191`, `maxTokens`, `percentage`, per-category `memoryFiles`/`mcpTools`/`agents`/`skills`/`slashCommands`, `messageBreakdown`, `apiUsage`, autocompact state | **✅ shipped** (observability) — `Harness.getContextUsage()` + daemon `context_usage` frame |
| `listSessions()` | `array[801]` w/ `sessionId, summary, firstPrompt, gitBranch, cwd, tag, createdAt, lastModified` | **✅ shipped** (observability) — `sessions/reader.ts` + daemon `sessions` op; **`cwd`→`dir` scoping is the actual fix** (the "global store" was a probe passing a non-field `cwd`) |
| `getSessionMessages(id)` | transcript `array[3]` | **✅ shipped** (observability) — reader + daemon `messages` op |
| `accountInfo()` | `{tokenSource, apiKeySource, apiProvider}` | **✅ shipped** (observability) — `Harness.accountInfo()` + daemon `account_info` frame |
| `supportedModels` / `Commands` / `Agents` / `mcpServerStatus` | arrays `[6]` / `[94]` / `[15]` / `[6]` | **✅ shipped** — `bridge/` + `Harness` capability methods |
| `forkSession(id)` | new `{sessionId}` | **⚪ deferred** — branch-and-explore; its own later sub-project |

**Wiring lesson (verified):** `rewindFiles()`'s anchor must be a genuine **user-prompt UUID**, resolved
from the transcript via `getSessionMessages()` — **not** from live stream frames (in streaming mode the
`type:"user"` frames are tool-results, which carry no checkpoint and return "No file checkpoint found").

**Next frontier — hooks (domain 8):** 0 of 30 `HOOK_EVENTS` are handled — the largest ready-made,
verified-reachable, unbuilt lever. Other deferred sub-projects: `forkSession` branch-and-explore,
session write/mutation ops (`renameSession`/`tagSession`/`deleteSession`), daemon `SessionRecord`-index
persistence, and the EXPERIMENTAL `usage` (plan rate-limit) surface.

---

## §5 — Permanently out of reach (the 🚫 floor)

58 parity items are `not-possible` and ~77 are non-goals: claude.ai bridge-coupled surfaces
(`connectRemoteControl`, `runAssistantWorker`, `RemoteTrigger`, native `CronCreate` firing,
`PushNotification` transport), build-internal feature-flag/DCE gating, and the interactive Ink TUI
(deferred under the "harden & ship over Phase 3" decision). These are excluded from every "realized"
fraction above — measuring against them would understate true coverage of the reachable envelope.
