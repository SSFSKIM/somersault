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

_(filled in Task 8 — one line per live SDK probe: `NN | claim | result | rows updated`.)_
