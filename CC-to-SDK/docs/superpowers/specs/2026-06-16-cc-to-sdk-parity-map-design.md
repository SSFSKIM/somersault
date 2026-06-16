# CC → Agent SDK Feature-Parity Map — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** 0 (research foundation) of the larger "replicate the Claude Code harness on the Agent SDK" program
**Working dir:** `CC-to-SDK/`
**Author:** main session

---

## 1. Goal

Produce a definitive, feature-granular **parity map** that classifies every capability of the
Claude Code harness against the current TypeScript **Claude Agent SDK** surface, and derives a
**sequenced phase roadmap** for the later build phases.

This is the foundation that all subsequent phases (harness core → modes → TUI) build from. This
phase produces **documentation only — no harness code.**

### Ultimate-goal framing

The program's end state is "replicate the full Claude Code harness on top of the Agent SDK (TS)."
That is far too large for one spec, so we decompose. The single highest-leverage first artifact is
an accurate map of **what the SDK already gives us for free vs. what we must build** — because that
line determines the entire downstream plan. Getting it wrong wastes the most work.

---

## 2. Key architectural finding (the premise the map rests on)

The Agent SDK **bundles a native Claude Code binary** and drives the same engine that ships in the
CLI. Therefore the agent *core* is already provided by the SDK:

- agent loop, streaming, retries, context management & **compaction**
- all built-in tools: Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Monitor,
  AskUserQuestion, Task/subagents, TodoWrite, MCP tools, …
- **permission system** (modes: `default | acceptEdits | bypassPermissions | plan | dontAsk | auto`;
  `canUseTool`; allow/deny lists; settings-based rules)
- **hooks** (`PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, …)
- **subagents** via `agents: Record<string, AgentDefinition>`
- **MCP** via `mcpServers` (stdio/sse/http/sdk/claudeai-proxy) + in-process `createSdkMcpServer`/`tool`
- **sessions**: `resume`, `forkSession`, `continue`, `sessionId`, `sessionStore`, plus
  `listSessions`/`getSessionMessages`/`getSessionInfo`/`renameSession`/`tagSession`
- **skills** (`skills` option + `.claude/skills/*/SKILL.md`), **plugins** (`plugins: SdkPluginConfig[]`
  + filesystem), **slash commands** (`.claude/commands/*.md`, enumerated via `supportedCommands()`)
- **settings** via `settingSources: ("user"|"project"|"local")[]` + `resolveSettings()`
- structured output via `outputFormat: { type: 'json_schema', schema }`
- file checkpointing/rewind (`enableFileCheckpointing`, `rewindFiles()`), sandbox, budgets
  (`maxTurns`, `maxBudgetUsd`, `taskBudget`), effort/thinking, model/fallbackModel.

What the SDK does **not** provide is the **harness shell**: the interactive Ink **TUI/REPL** (~127K
LoC of the reference: `components/` ~82K, `ink/` ~20K, `screens/` ~6K, UI `hooks/` ~19K), and the
extra **modes** (proactive, daemon, bridge, remote-server, voice, vim keybindings). That is where the
reference harness's 516K LoC actually concentrates, and it is the bulk of the "Build-needed" set.

**Restriction to record up front:** Anthropic does not permit 3rd-party SDK apps to offer
**claude.ai OAuth login / claude.ai rate limits**. Any CC feature that depends on that auth path is
**🚫 Not-possible/restricted** for our build (API-key / Bedrock / Vertex / Foundry auth only).

---

## 3. Evidence sources (and their authority)

| Source | Use | Currency |
|---|---|---|
| `Claude Code Src/docs/specs/` (147 files, ~62K lines, specs 00–42 + catalogs) | **Feature taxonomy** = the rows | Feb snapshot; partly stale — structural scaffold, not ground truth |
| `Claude Code Src/src/` (516K LoC somersault reference) | Spot-checks of CC behavior when a spec is ambiguous | Feb snapshot |
| **Live Agent SDK TS reference** (`code.claude.com/docs/en/agent-sdk/typescript`) | **Verdict basis** = the columns (60+ options, Query methods, message types) | Current (v0.3.x) |
| **This live harness** (current Claude Code v2.1.x): observable tools, deferred tools, agent types, skills, hook events, output styles, MCP | Confirms *current* CC feature set where Feb specs lag (e.g. Monitor, CronCreate, DesignSync, RemoteTrigger, Task*, EnterWorktree, PushNotification) | Current |
| `ant` CLI (Developer Platform) | Hosted primitives: `beta:agents`, `beta:skills`, `beta:memory-stores`, `beta:sessions` — relevant to Managed-Agents parity notes | Current |
| **Live SDK runs** (ANTHROPIC_API_KEY) | Empirically resolve ~15–25 high-stakes/uncertain verdicts | Current |

**Rule:** Feb specs supply the *feature list*; verdicts are set against the *current* SDK + current
harness. Where current CC has features newer than the Feb specs, the live harness is authoritative.

### 3.1 The February-snapshot delta (first-class requirement)

Both the reverse-engineered specs **and** the `Claude Code Src/src/` reference are a **February
snapshot**. Current Claude Code (v2.1.x) and the live Agent SDK (v0.3.x) have moved on. Anything
added since February will be **present in the SDK/current harness but absent from the Feb source** —
and a purely spec-driven map would silently drop it. Capturing this delta is a first-class goal, not
a side effect.

Observed-from-this-session examples of likely post-Feb additions (to be confirmed during build):
- **Tools:** `Monitor`, `CronCreate`/`CronList`/`CronDelete`, `DesignSync`, `EnterWorktree`/`ExitWorktree`,
  `RemoteTrigger`, `PushNotification`, `ScheduleWakeup`, `Workflow`, `ToolSearch`, `LSP`, `Task*`
  (`TaskCreate`/`Get`/`List`/`Output`/`Stop`/`Update`), `SendMessage`, `EnterPlanMode`/`ExitPlanMode`.
- **SDK options/methods:** `effort`, `thinking` (adaptive), `taskBudget`, `maxBudgetUsd`, `sessionStore`/
  `sessionStoreFlush`, `enableFileCheckpointing`/`rewindFiles`, `outputFormat` (json_schema), `betas`,
  `onElicitation`, `planModeInstructions`, `agentProgressSummaries`, `forwardSubagentText`, `skills`,
  `toolAliases`, `toolConfig`, `startup()`/`WarmQuery`, `applyFlagSettings`, `stopTask`, `setMcpServers`.
- **Permission modes:** `dontAsk`, `auto` (classifier-based).
- **Capabilities:** background tasks, scheduled/cron cloud agents ("routines"), git-worktree isolation,
  workflows, fast mode, output styles, prompt suggestions, memory-recall events, claudeai-proxy MCP.

These are illustrative; the build's delta pass (§7 step 2′) enumerates the current surface
authoritatively and reconciles it against the Feb feature list.

---

## 4. Verdict taxonomy (5 buckets)

| Verdict | Meaning | Examples |
|---|---|---|
| ✅ **Provided** | SDK exposes directly; no/trivial wiring | built-in tools, permission modes, hooks, subagents, MCP, sessions/resume/fork, compaction, skills/plugins loading |
| 🔧 **Configurable** | SDK gives the primitive; we supply content/wiring | custom slash commands (`.claude/commands`), `CLAUDE.md` memory, `outputFormat`, custom tools via `tool()`, settings |
| 🏗 **Build-needed** | Absent from SDK; implement in our harness layer | Ink TUI + ~140 components, REPL, vim mode, voice, daemon/bridge/remote-server, proactive mode, keybindings, status/cost UI |
| 🚫 **Not-possible/restricted** | Cannot replicate via the SDK | claude.ai OAuth login, internal-only telemetry/flags/services |
| ❔ **Unknown** | Needs empirical verification | resolves into one of the four above after a live SDK probe |

---

## 5. Row schema (one row per feature)

| Field | Notes |
|---|---|
| `id` | `NN.k` keyed to spec area (e.g. `09.3`) |
| `feature` | short name |
| `what it is` | one line |
| `CC source` | spec § and/or `src/` file |
| **`verdict`** | one of the 5 buckets |
| `SDK surface` | exact option/method/type that covers it, or `—` |
| `gap / bridge note` | how to close it on the SDK; rough effort hint |
| `target phase` | which future build phase it belongs to (feeds `roadmap.md`) |
| `confidence` | Verified-empirically / Doc-grounded / Inferred |
| **`snapshot`** | **`Feb-spec`** (present in the Feb reference) / **`Post-Feb`** (new in current CC/SDK, absent from Feb source) — makes the since-February delta queryable on every row |

---

## 6. Granularity & coverage (approved: feature-granular)

- ~300–500 feature rows, grouped by the 43 subsystem areas (specs 00–42).
- **Not** per-file. The four catalog specs collapse into a small number of verdicts with an explicit
  count, not hundreds of rows:
  - `37a` (389 components) → "🏗 TUI component surface" rows by cluster (permissions UI, MCP UI, swarm UI, …)
  - `37b` (104 UI hooks), `37c` (96 ink primitives) → "🏗 TUI" rollups
  - `42a` (327 utils) → "internal util / mostly Provided-or-N/A" rollup, with the few user-facing utils broken out
- **Coverage statement is mandatory** (`methodology.md`): every one of the 43 areas is accounted for;
  every collapse/rollup names what it subsumes and the file count. **No silent truncation** — if any
  area is deferred or sampled, it is logged as such.

---

## 7. Method / execution shape

1. **Lock the SDK surface** (done in design; re-confirm exact field names during build): options,
   `Query` methods, message types, `AgentDefinition`, `SettingSource`, `McpServerConfig`,
   permission modes, hook events.
2. **Enumerate current-harness surface** from this session (tools, deferred tools, agent types,
   skills, hook events, output styles) → a "current CC capability" checklist to catch post-Feb features.
2′. **February-delta reconciliation pass (required).** Treat the current surface as authoritative:
   enumerate the *current* CC/SDK capability set (live SDK docs + this harness's observable tools/agents/
   skills/hooks + current CC public docs via WebSearch/WebFetch), then **diff it against the Feb-derived
   feature list**. Any current capability with no Feb-derived row gets its own row tagged
   `snapshot: Post-Feb`; any Feb feature removed/renamed in current CC is annotated. Output feeds
   `since-february.md`.
3. **Fan out per spec area** (sub-agents, one per area / cluster of areas): each reads its spec(s)
   (+ targeted `src/` checks), emits rows in the schema with a provisional verdict + SDK-surface
   mapping. Areas are independent → parallelizable.
4. **Synthesize** rows into per-area files + the master matrix; dedupe cross-cutting features
   (permissions appear in 09 + 37a; MCP in 16 + 23 + 37a — own each once, cross-reference).
5. **Empirical spot-verification** (approved: ~15–25 high-stakes): run the SDK with ANTHROPIC_API_KEY
   to resolve `❔` and confirm critical `✅` claims. Candidate probes:
   - `systemPrompt:{preset:'claude_code'}` — does it reproduce the real CC system prompt?
   - `settingSources` — does it load `.claude/commands`, `.claude/skills`, `CLAUDE.md`?
   - `supportedCommands()` — does it enumerate built-in slash commands?
   - skills auto-trigger vs. explicit `/name` invocation
   - `agents` subagent dispatch + `parent_tool_use_id` threading
   - `createSdkMcpServer`/`tool()` in-process tool round-trip
   - `canUseTool` / `permissionMode` transitions; `outputFormat` json_schema
   - session `resume`/`forkSession` + `getSessionMessages`
   - `hooks` callback firing (PreToolUse blocking, PostToolUse logging)
   Each probe's result is recorded with `confidence: Verified-empirically`.
6. **Derive the roadmap**: group 🔧 + 🏗 features into sequenced phases (proposed default:
   Phase 1 harness-core/config wiring & headless parity → Phase 2 modes → Phase 3 TUI), each a future
   spec→plan→build cycle. 🚫 items listed as explicit non-goals.

---

## 8. Outputs (`CC-to-SDK/docs/parity/`)

- `INDEX.md` — master matrix (all rows) + verdict tallies + a coarse 43-area summary table.
- `NN-<area>.md` — per-area detailed rows (43 files, merged where sensible).
- `methodology.md` — evidence sources, taxonomy, **coverage statement**, probe log.
- `since-february.md` — the **post-Feb delta**: every current CC/SDK capability absent from the Feb
  source, with its verdict and target phase. Ensures new features are affirmatively enumerated.
- `roadmap.md` — the phase decomposition derived from the map (the payoff artifact).
- `parity.json` — machine-readable mirror of all rows (optional, for later tooling).

Design doc (this file): `CC-to-SDK/docs/superpowers/specs/2026-06-16-cc-to-sdk-parity-map-design.md`.

---

## 9. Explicit non-goals for this phase

- No harness implementation code.
- No reimplementation of the agent loop or tools (the SDK provides them).
- No exhaustive per-file mapping of the 992 cataloged files (collapsed by design).
- No attempt to replicate claude.ai-login-gated behavior (restricted).

---

## 10. Success criteria

- Every one of the 43 subsystem areas has rows or an explicit, justified rollup.
- Every row has a verdict + SDK-surface mapping (or `—`) + confidence.
- ≥15 high-stakes verdicts carry `Verified-empirically` confidence from live SDK runs.
- **The since-February delta is affirmatively enumerated:** every row carries a `snapshot` tag, and
  `since-february.md` lists all `Post-Feb` capabilities (the reconciliation pass ran, not just incidental catches).
- `roadmap.md` sequences all 🔧/🏗 work into coherent future phases with dependencies.
- A reader can answer, for any CC feature: "Provided / Configurable / Build / Not-possible, and how."
