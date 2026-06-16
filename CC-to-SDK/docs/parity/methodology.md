# Parity Map — Methodology

How the CC → Agent SDK parity map is built, classified, and verified. Companion to the design spec
`docs/superpowers/specs/2026-06-16-cc-to-sdk-parity-map-design.md`.

## Verdict taxonomy (5 buckets)

| Verdict | Emoji | Meaning | Examples |
|---|---|---|---|
| Provided | ✅ | SDK exposes directly; no/trivial wiring | built-in tools, permission modes, hooks, subagents, MCP, sessions, compaction |
| Configurable | 🔧 | SDK gives the primitive; we supply content/wiring | custom slash commands, `CLAUDE.md` memory, `outputFormat`, custom tools, settings |
| Build-needed | 🏗 | Absent from SDK; implement in our harness layer | Ink TUI + components, REPL, vim, voice, daemon/bridge/remote-server, proactive, keybindings |
| Not-possible/restricted | 🚫 | Cannot replicate via the SDK | claude.ai OAuth login, internal-only telemetry/flags/services |
| Unknown | ❔ | Needs empirical verification (must resolve before finalize) | resolves into one of the four above after a live SDK probe |

## Row schema

Each row (authored in `data/*.json`, rendered to markdown) has:

`id` · `area` · `feature` · `what` · `ccSource` · `verdict` · `sdkSurface` · `bridge` · `targetPhase` · `confidence` · `snapshot`

- `verdict` ∈ `provided | configurable | build | not-possible | unknown`
- `confidence` ∈ `verified | doc | inferred`
- `snapshot` ∈ `feb | post-feb` (queryable since-February delta on every row)
- `targetPhase` ∈ `1 | 2 | 3 | non-goal`
- `sdkSurface` may be empty only when `verdict ∈ {build, not-possible}`

## Evidence sources (authority order)

| Source | Use | Currency |
|---|---|---|
| `Claude Code Src/docs/specs/` (147 files) | feature taxonomy (the rows) | Feb snapshot; structural scaffold, not ground truth |
| `Claude Code Src/src/` (516K LoC) | spot-checks of CC behavior | Feb snapshot |
| Live Agent SDK TS reference + bundled `.d.ts` (`_sdk-surface.md`) | verdict basis (the columns) | current (v0.3.x) |
| This live harness (`_current-surface.md`) | current CC feature set (post-Feb) | current (v2.1.x) |
| `ant` CLI (Developer Platform) | hosted primitives (agents/skills/memory/sessions) | current |
| Live SDK runs (`probes/`, ANTHROPIC_API_KEY) | empirically resolve high-stakes verdicts | current |

**Rule:** Feb specs supply the *feature list*; verdicts are set against the *current* SDK + harness.
Where current CC has features newer than the Feb specs, the live harness is authoritative
(see `_current-surface.md` and the February-delta reconciliation pass).

## Coverage statement

_(filled in Task 9 after extraction — must confirm all 43 areas accounted for, every catalog rollup
names its subsumed file count, no silent truncation.)_

## Probe log

Live Agent SDK runs (TS, v0.3.178, `probes/probes/*.ts`; raw output in `probe-results/`). Format: `NN | claim | PASS/FAIL | rows verified (ids)`.

- 01 | introspection: built-in tools provided + command/model/agent enumeration + MCP status + context-usage (`supportedCommands/Models/Agents()`, `mcpServerStatus()`, `getContextUsage()`, system/init) | PASS (32 tools, 92 cmds, 5 models, 15 agents, 6 MCP servers, context-usage categories returned) | 03.4, 20.1, 03.11, 16.5, 23.1, 06.4, 21a.3
- 02 | in-process custom MCP tool via `createSdkMcpServer` + `tool()` | PASS (echo handler ran with arg "PARITY", tool_use observed, result="PARITY") | 16.2, 23.5, 08.1
- 03 | filesystem commands + skills load via `settingSources:['project']` | PASS (`/probecmd` in supportedCommands + init; `probeskill` referenced/loaded) | 20.2, 02.1
- 04 | hooks fire + block (PreToolUse decision:block, includeHookEvents) | PASS (PreToolUse callback fired; hook_started/hook_progress/hook_response events; "probe-block" surfaced to model) | 04.3, 02.9
- 05 | programmatic permission control via `canUseTool` deny | PASS (callback consulted for Write tool, denied with "probe-deny"; note: headless default mode auto-allows safe Bash like `echo hi` without consulting canUseTool — permission-gated tools Write/Edit DO route through it; canUseTool requires streaming-input mode) | 09.1, 09.12, 04.5
- 06 | structured output via `outputFormat` json_schema | PASS (`result.structured_output = {"answer":"hello"}`) | 01.9, 03.8
- 07 | session resume + fork | PASS (resume recalled secret MAGENTA-42; forkSession produced a new session id that also recalled the secret) | 41.1, 01.19
- 08 | programmatic subagent dispatch via `options.agents` + Agent tool | PASS (supportedAgents lists 'probe'; Agent tool_use + parent_tool_use_id seen; subagent returned HELLO) | 14.1, 14.2, 01.22, 30.15

Total: 8/8 probes PASS, 25 rows set to `verified`. No verdicts changed (no probe disproved a verdict).
