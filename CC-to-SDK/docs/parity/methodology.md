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

**All 51 area slugs are accounted for** (the 43 conceptual subsystems + 8 catalog sub-areas
`21a–21d`, `37a–37c`, `42a`). The validator (`scripts/validate-parity.mjs`) enforces that every slug
in `scripts/parity-areas.mjs` has ≥1 row; it passes (`OK: 551 rows, 51 areas covered, 25 verified`).

**551 feature rows** total, grouped into 12 extraction clusters (C1–C12) + a reconciliation file
(`zz-post-feb.json`). Verdict split: ✅ 313 provided · 🔧 57 configurable · 🏗 123 build ·
🚫 58 not-possible · ❔ 0 unknown (all resolved).

**Catalog rollups — what was deliberately collapsed (and the file counts subsumed), so coverage is
honest rather than silently truncated:**

| Catalog area | Source files | Rendered as | How |
|---|---|---|---|
| `37a-components-catalog` | **389** components | ~20 family rows | grouped by UI family (permissions ~49, message renderers ~40, PromptInput 17, agents/wizard, MCP dialogs 13, swarm 13, design-system, spinners, tasks…) |
| `37b-hooks-catalog` | **104** React hooks | 4 rows | grouped by purpose (input/typeahead, data/session, display/resize, swarm/permission/transport) |
| `37c-ink-primitives-catalog` | **96** ink primitives | 2 rows | host components + render/layout pipeline; events + capability detection |
| `42a-utils-long-tail` | **327** utils | 5 rows | ~250 internal helpers (build), ~120 subsystem-entry utils (cross-ref owning clusters), user-facing session utils, doctor/installer, ANSI/terminal |
| `21a–21d` command catalog | **~105** commands / ~179 files | ~20 grouped rows | grouped by category (context/session, config, account, ant-internal, flag-gated, plugin/marketplace) with per-group counts |

Total files subsumed by rollups: **~1,021** (389+104+96+327 + ~105 commands). These are
intentionally not enumerated per-file (per design §6) because each collapses to a uniform verdict
(almost entirely 🏗 build for the UI catalogs; internal/non-parity for utils). Every rollup row names
its count in `what`/`bridge`.

**No silent truncation:** no area was skipped or sampled; the only compression is the documented
catalog rollups above. Cross-cutting features (permissions UI, MCP UI, swarm UI) are owned once by the
UI cluster C11 and cross-referenced from their logic clusters (C3/C6/C5) by row id.

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
