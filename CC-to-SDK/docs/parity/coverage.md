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
> - **SDK capability closeout** (P1–P4 frontier, 2026-06-18) — three parts on existing seams: **(A) turn
>   controls** `effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText`
>   via `resolveOptions` passthrough (domain 1); **(B) introspection methods** `usage()`/`initializationResult()`
>   on `Harness`+`Session`, `applyFlagSettings()` on `Session`, + daemon `usage`/`init`/`apply_flag_settings`
>   ops (domains 6/9); **(C) session-store mutation** `renameSession`/`tagSession`/`deleteSession` lib wrappers
>   + daemon `rename`/`tag`/`delete` ops (domain 5). Live-probed first (probes 11–15); `maxBudgetUsd` is
>   pass-through-don't-swallow (exceed-path is throw OR empty result, timing-dependent); `taskBudget` opus-4-8-only;
>   `usage()` wraps the unstable SDK method name. Spec `specs/2026-06-18-sdk-capability-closeout-design.md`,
>   commits `83762229c6..ee389d80da` (6 tasks, subagent-driven). Unit 340/340, live 6/6 keyed.
> - **Daemon boot-rehydration** (domain 5, 2026-06-18) — the last non-knob session item: a restarted daemon
>   transparently re-adopts the sessions it owned instead of reaping them. Lazy + opt-in: `SessionRegistry.rehydrate(pid)`
>   claims orphaned-resumable records (reaps errored/no-sessionId, leaves live-pid alone) and the `restart` policy is
>   now persisted on `SessionRecord`; `DaemonSupervisor` gains a `rehydrate` flag + an `ensureLive(id)` seam that
>   revives a claimed session on first access (resumes the captured `sessionId` — continue, not branch) — **no subprocess
>   at boot, no new daemon op, `server.ts` untouched.** Graceful `stop`/`shutdown` forget unrevived claims (only a crash
>   rehydrates). Premise live-verified (probe 16, cross-process resume). Spec `specs/2026-06-18-daemon-boot-rehydration-design.md`,
>   commits `8931bf97f8..5bb3339bbf` (4 tasks, subagent-driven). Unit 348/348, live 1/1 keyed. **The session cluster +
>   its durability story are now complete.**
> - **Public-API hardening** (harden-and-ship sub-project 2, 2026-06-18) — a packaging/quality milestone (no new
>   SDK capability, so no domain-% change): the public boundary of `src/index.ts` is now **curated** (5 plumbing
>   exports pruned), **validated** (zod `HarnessConfigError` fail-fast guard at every front door, matching — not
>   exceeding — the SDK), **leak-free** (teardown-liveness sweep across Session/harness/daemon/swarm — all surfaces
>   already correct, invariants now locked), and **frozen** (44-name surface snapshot + `harness/API-STABILITY.md`
>   tiers). Keyless (no live test). Commits `f9aab5ac00..12e74819b1` (6 tasks). Unit 366/366. The harness is now
>   publish-ready (still `private:true`). See memory `harden-and-ship-over-phase3`.
> - **Public-API docs** (harden-and-ship sub-project 3, 2026-06-18) — a documentation milestone (no new SDK
>   capability, so no domain-% change): `harness/README.md` is **rewritten** around the frozen 44-export surface
>   (a tour of all 9 core surfaces with runnable examples, the refreshed `HarnessConfig` table, the CC-faithful
>   bridges de-Phase-framed); `package.json` gains **publish metadata** (`description`/`keywords`/`repository`/
>   `homepage`/`license: Apache-2.0`); and a **self-maintaining drift gate** (`test/unit/readme.test.ts`) asserts
>   every `cc-harness` import in the README is a real export (value names from `Object.keys(index.js)`, type names
>   from `index.ts` source) so the docs can't silently rot. Keyless. Commits `9977f73dcf..9e9d906af3` (3 tasks).
>   Unit 368/368. Front door now accurate + complete (still `private:true`). See memory `harden-and-ship-over-phase3`.
> - **Test & CI hardening** (harden-and-ship sub-project 4, 2026-06-18) — an enforcement milestone (no new SDK
>   capability): CC-to-SDK had **zero CI**; this adds `.github/workflows/cc-to-sdk.yml`, a **keyless** gate that
>   runs `npm ci → typecheck → build → test:unit → verify:pack` on Node **[18, 22]**, path-scoped to `CC-to-SDK/**`
>   (disjoint from the upstream Rust syncs the fork receives) with SHA-pinned house actions + least-privilege
>   `permissions: contents: read`. So the guards sub-projects 2–3 built (frozen surface, README-drift, validation,
>   teardown) are now **enforced on every change**, not just on demand. One file, no source/lockfile change (`npm ci`
>   verified green as-is). Commit `3103c675b5` (+ hardening `c1c2a69f88`). **With this, the whole harden-and-ship
>   track — packaging · boundary · docs · test+CI — is COMPLETE.** See memory `harden-and-ship-over-phase3`.

## How to read this

"How much of the SDK have we used?" has two honest denominators:

1. **Raw API surface** — how many of the SDK's typed knobs we touch (§3). A *low* number here is the
   intended design: 313 of 551 CC features are verdict `provided`, i.e. the SDK already does them
   natively, so consuming more of the API would mean re-implementing what is free.
2. **Capability envelope** — of everything the SDK *makes possible*, how much have we turned into
   working harness capability (§2). This is the number that answers "considering the SDK's full
   potential, how much have we made?"

**Headline:** we have realized roughly **~64% of the SDK's reachable capability envelope** — strong
(60–90%) on the *execution & orchestration* half (turn loop, tools, permissions, multi-agent,
settings, autonomy). The *state & observability* half has now largely closed, and the **SDK capability
closeout** (2026-06-18) pushed the last ready-made frontiers in: **turn controls** (`effort`/`thinking`/
`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText` — domain 1 → ~85%),
**introspection methods** (`usage()`/`initializationResult()`/`applyFlagSettings()` — domain 6 → ~88%),
and **session-store mutation** (`rename`/`tag`/`delete`) now join the persistence
cluster, observability read API, agent-facing context tools, and programmatic hooks (domain 8) already
built. **Daemon-process boot-rehydration** (2026-06-18) then closed the last non-knob session item — a
restarted daemon re-adopts its sessions and resumes their context on first access (domain 5 → ~93%). The
remaining frontiers are narrow and mostly out of reach: `toolConfig` shaping, and rate-limit surfacing
(`null` on API-key auth — bridge-coupled).

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
| 1 | **Turn execution & streaming** — `query()` loop, streaming I/O, partial messages, `thinking`/`effort`, `maxTurns`/`maxBudgetUsd`/`taskBudget`, compaction | **~85%** | ✅ built | `daemon/session` drives `query()` via a shared `Session` engine; **multi-turn lib-side** (`openSession`/`Session.submit`/`stream`); **compaction built**; **turn controls SHIPPED** (closeout) — `effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText` config passthrough (`maxBudgetUsd` exceed-path is pass-through-don't-swallow; `taskBudget` opus-4-8-only; partial frames already flow through `stream()`). Remaining: deeper partial-stream ergonomics |
| 2 | **Tool system** — 37 native tools (default-on), `createSdkMcpServer`+`tool()`, allow/deny/`toolAliases`, `toolConfig` | ~70% | ✅ | 3 MCP servers built (tasks/swarm/brief); gating wired; `toolConfig`/`tools` allowlist-shaping partial |
| 3 | **Permission & safety** — 6 `permissionMode`s, `canUseTool`, `sandbox`, `allowDangerouslySkip` | ~80% | ✅ | **6/6 modes** now characterized (default/plan/auto/bypass + `acceptEdits`/`dontAsk` added in closeout — `acceptEdits` keeps the `canUseTool` broker for non-edits, `dontAsk` replaces it); `canUseTool` broker in swarm; sandbox modeled |
| 4 | **Multi-agent** — `agents`/`AgentDefinition`, native subagents, `Agent`/`Task*` tools, coordination | ~70% | ✅ | `swarm/` coordinator + bus + teammates; native subagent transcripts (`listSubagents`) unused |
| 5 | **Session lifecycle & persistence** — `resume`, `forkSession`, `persistSession`, `sessionStore`, `enableFileCheckpointing`+`rewindFiles` | **~93%** | ✅ built | **Full session cluster shipped (3 of 3):** `resume`/`persistSession`/`sessionStore` config, `resumeHarness()`, CLI flags, daemon `spawn({resume})`, `rewindFiles`; **lib `Session` primitive** (`openSession`/`resumeSession`, multi-turn + `.sessionId` capture + `resume` preserves id); **daemon durable sessions** (`SessionRecord.sessionId` persisted; on-failure `restart()` resumes the captured session); **forking** (`forkSession` lib wrapper + daemon `fork` op — mints a new id, branch reached via resume); **session-store mutation SHIPPED** (closeout) — `renameSession`/`tagSession`/`deleteSession` lib wrappers (mirror `fork.ts`) + daemon `rename`/`tag`/`delete` ops, live-verified CRUD on the default file store; **boot-rehydration SHIPPED** (`daemon-boot-rehydration`, 2026-06-18) — lazy opt-in: a restarted daemon re-adopts orphaned `SessionRecord`s (`SessionRegistry.rehydrate` claims/reaps; `restart` policy now persisted) and revives each on first access via the `ensureLive` seam (`DaemonOptions.rehydrate`, no subprocess at boot / no new daemon op), live-verified cross-instance resume |
| 6 | **Introspection & observability** — `getContextUsage`, `usage`, `accountInfo`, `mcpServerStatus`, `listSessions`/`getSessionMessages`/`getSessionInfo`, `supportedModels`/`Commands`/`Agents`, `initializationResult` | **~88%** | ✅ built | **Read API + agent-facing tool + introspection methods shipped:** reader module, `Harness.getContextUsage()`/`accountInfo()`, daemon `sessions`/`messages`/`context_usage`/`account_info`; **`cc-context` MCP tool**; **closeout added** `usage()`/`initializationResult()`/`applyFlagSettings()` on `Harness`+`Session` + daemon `usage`/`init`/`apply_flag_settings` ops (live-verified; `usage()` wraps the unstable SDK method name). Remaining: `usage().rate_limits` is `null` on API-key auth (only populated on claude.ai plan auth — bridge-coupled) |
| 7 | **Scheduling & autonomy** — proactive self-wake, `CronCreate`, `PushNotification`, assistant worker | ~50%¹ | ✅/🚫 | `proactive/` + `kairos/` latch built; cron dead headless, push has no transport, worker bridge-coupled |
| 8 | **Extensibility** — `plugins`, `skills`, **30 hook events**, output styles, dynamic MCP | **~60%** | ✅ | plugins/skills/styles/MCP passthrough; **programmatic hooks shipped** — typed `config.hooks` → `options.hooks` (all 30 reachable), `injectContext`/`guardTool`/`blockTool`/`observe` builders + `mergeHooks` for the live-verified subset (8 of 30 fire headlessly; `SessionStart`/`SessionEnd` dormant via the programmatic path — documented, no builder), daemon path via `sessionOptions`. Deeper plugin/skill lifecycle integration remains |
| 9 | **Settings & config** — `settingSources` cascade, `settings`/`managedSettings`, provider/env, sandbox | ~92% | ✅ | fully modeled in `config/`; **`applyFlagSettings` (mid-session merge) now wired** (closeout — `Session.applyFlagSettings()` + daemon `apply_flag_settings` op, streaming-input only) |
| 10 | **Remote / bridge / voice / UI** — `connectRemoteControl`, remote server, voice, Ink TUI | ~30%¹ | ✅/🚫 | `bridge/` control-protocol shim built; **Phase-3 increment 1 SHIPPED — `cc-harness top`, a read-only terminal daemon-observability dashboard** (lightweight, no-Ink `monitor/`: polls `list`+`context_usage`, renders the live pool / ctx% / token usage / proactive heartbeat with idempotent teardown; CLI-internal, public surface unchanged — spec/plan `2026-06-18-daemon-observability-dashboard`). **Phase-3 increment 2 SHIPPED — `cc-harness-console`, an interactive Ink daemon console** (new `cc-harness-tui` package over the core's new public `connectDaemon`/`DaemonClient`: master-detail pool/detail, inject prompts via streaming `submit`, drive control ops — interrupt/setModel/setPermissionMode/compact/fork/proactive — with confirm-gated `stop`; spec/plan `2026-06-18-interactive-daemon-console`). **Phase-3 increment 3 SHIPPED — `cc-harness-chat`, an in-process chat REPL** (in `cc-harness-tui` alongside the console bin: drives a live `openSession`/`Session` in `default` permission mode with rich tool rendering via `render.ts` — bespoke Edit/Write/Bash/Read formatters — and inline permission dialogs via `createPermissionGate`/`PermissionBroker` advanced-seam wired through `uiBroker.ts`/`useChat.ts`; spec/plan `2026-06-19-chat-repl-permission-prompts`). Remote/voice remain 🚫/non-goal **by design** |

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
| `Options` fields | 63 | ~35 modeled in `resolveOptions` (now incl. `resume`/`persistSession`/`sessionStore` + turn controls `effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText`) + `extraOptions` escape hatch | passthrough makes all 63 *reachable* |
| `Query` control methods | ~25 | 12 (`interrupt`, `setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `rewindFiles`, `getContextUsage`, `accountInfo`, **`usage`**, **`initializationResult`**, **`applyFlagSettings`**, `supportedModels`/`Commands`/`Agents`) | ~13 unused; `usage().rate_limits` is `null` on API-key auth (bridge-coupled) |
| Core builders (`query`, `createSdkMcpServer`, `tool`) | 3 | 3 | 100% |
| In-process MCP servers built | — | 5 (`cc-tasks`, `cc-swarm`, `cc-brief`, `cc-context`, `cc-compact`) | `cc-context` = self-introspection (`GetContextUsage`); `cc-compact` = self-compaction (`RequestCompaction`) |
| Native model tools | 37 | 0 reimplemented; 2 deliberately shadowed by our MCP (Task→swarm, Tasks); `CronCreate` probed dead | rely-on, not consume |
| Subpath exports | 7 | 1 used (`.`), 2 probed-and-rejected (`/assistant`, `/bridge`), 1 types-only (`/sdk-tools`) | — |
| Hook events (`HOOK_EVENTS`) | 30 | first-class `config.hooks` + 4 builders + `mergeHooks` | 8 verified-fired headlessly; all 30 reachable via passthrough; SessionStart/End dormant (documented) |
| `permissionMode` values | 6 | **6 characterized** | default/plan/auto/bypass(gated) + `acceptEdits`/`dontAsk` (closeout) |
| Session-store top-level fns | 10 | **7 used** (`listSessions`/`getSessionMessages`/`getSessionInfo` via `sessions/reader.ts`, `forkSession` via `sessions/fork.ts`, **`renameSession`/`tagSession`/`deleteSession` via `sessions/mutate.ts`**); `resume`/`persistSession`/`sessionStore` (Options) wired | all documented store fns now wrapped |

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
+15 (328 total), live 2/2 keyed. The **session cluster is also COMPLETE (3 of 3)**.

**SDK capability closeout (domains 1/3/5/6/9) — SHIPPED** (`sdk-capability-closeout`, 2026-06-18): the P1–P4
turn-level + introspection + session-mutation frontiers, all live-probed first (probes 11–15) then built on
existing seams: **(A)** `effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/
`forwardSubagentText` config passthrough; **(B)** `usage()`/`initializationResult()` on `Harness`+`Session`,
`applyFlagSettings()` on `Session`, + daemon `usage`/`init`/`apply_flag_settings` ops; **(C)** `renameSession`/
`tagSession`/`deleteSession` wrappers + daemon `rename`/`tag`/`delete` ops; plus the `acceptEdits`/`dontAsk`
permission modes characterized. `maxBudgetUsd` exceed-path is pass-through-don't-swallow (throw OR empty
result, timing-dependent); `taskBudget` opus-4-8-only. Commits `83762229c6..ee389d80da` (6 tasks). Unit
340/340¹, live 6/6 keyed. See [[sdk-turn-controls-and-store-mutation-verified]].

**Daemon boot-rehydration (domain 5) — SHIPPED** (`daemon-boot-rehydration`, 2026-06-18): lazy, opt-in — a
restarted daemon re-adopts orphaned `SessionRecord`s instead of reaping them. `SessionRegistry.rehydrate(pid)`
claims orphaned-resumable records (normalize→idle, reap errored/no-sessionId, leave live-pid alone); the
`restart` policy is now persisted on the record; `DaemonSupervisor` gains a `rehydrate` flag + an `ensureLive(id)`
seam that revives a claimed session on first access (resumes the captured `sessionId` — continue, not branch) —
**no subprocess at boot, no new daemon op, `server.ts` untouched.** Graceful `stop`/`shutdown` forget unrevived
claims (only a crash rehydrates). Premise live-verified by probe 16 (cross-process resume, `db4e30bc23`). Commits
`8931bf97f8..5bb3339bbf` (4 tasks, subagent-driven; one review-fix: shutdown clears unrevived claims). Unit
348/348, live 1/1 keyed. See [[harden-and-ship-over-phase3]].

**Remaining frontiers** (now narrow): deeper partial-stream ergonomics in domain 1; deeper plugin/skill
lifecycle integration in domain 8. Mostly-out-of-reach: `toolConfig` shaping (marginal) and
`usage().rate_limits`/`SDKRateLimitEvent` surfacing (`null` on API-key auth — bridge-coupled).

¹ unit suite count at closeout completion; verify with `npx vitest run test/unit` as the suite grows.

---

## §5 — Permanently out of reach (the 🚫 floor)

58 parity items are `not-possible` and ~77 are non-goals: claude.ai bridge-coupled surfaces
(`connectRemoteControl`, `runAssistantWorker`, `RemoteTrigger`, native `CronCreate` firing,
`PushNotification` transport), build-internal feature-flag/DCE gating, and the interactive Ink TUI
(deferred under the "harden & ship over Phase 3" decision). These are excluded from every "realized"
fraction above — measuring against them would understate true coverage of the reachable envelope.
