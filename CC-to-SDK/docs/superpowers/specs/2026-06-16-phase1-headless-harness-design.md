# Phase 1 — Headless Harness Core — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** 1 of the CC→SDK program (Headless harness core). Follows Phase 0 (parity map).
**Working dir:** `CC-to-SDK/harness/` (new package)
**Inputs:** parity map (`docs/parity/`), roadmap Phase 1 (262 rows: 246 ✅ provided, 16 🔧 configurable)

---

## 1. Goal

A reusable TypeScript **harness library** wrapping the Claude Agent SDK that reproduces Claude Code's
*behavior* headlessly, plus a thin runnable **CLI**. It is the stable core that Phases 2 (modes) and
3 (TUI) build on.

`createHarness(config) → Harness`, where `Harness.run/stream/rewind` drive the SDK `query()` with
**CC-faithful defaults**, and the friendly `HarnessConfig` is translated into correct SDK `Options`
by the **16 bridge modules**. `cc-harness "<prompt>"` exercises it end-to-end.

## 2. Premise (from Phase 0)

The SDK *is* CC's engine, so 246/262 Phase-1 features are already ✅ Provided — the harness
**configures and verifies** them rather than reimplementing them. The only real code is:
(a) a clean API surface, (b) the **16 🔧 bridges**, (c) a live parity-verification suite. Re-coding
the settings cascade / query loop is an explicit non-goal (the SDK does it).

The bridges mostly paper over SDK sharp edges: **settingSources defaults to `none`** (CC = all),
**`outputStyle` is a phantom Option** (not in `sdk.d.ts` v0.3.178), **built-in agents are not
auto-shipped** by the SDK. The harness makes the CC-faithful choice by default.

## 3. Architecture

```
HarnessConfig (friendly)
   │  resolveOptions()  ← the 16 bridges (pure, testable)
   ▼
SDK Options ── query({prompt, options}) ── message stream
   ▼                                            │
Harness.run() collect · Harness.stream() iterate · CLI renders
```

`Harness` also exposes passthrough introspection from the SDK `Query` object: `supportedCommands()`,
`supportedModels()`, `supportedAgents()`, `mcpServerStatus()`, `getContextUsage()`, and
`rewind()` (→ `Query.rewindFiles`).

## 4. Module structure (small, single-responsibility files)

| File | Responsibility | Bridges |
|---|---|---|
| `src/config/types.ts` | `HarnessConfig` type + defaults | — |
| `src/config/settings.ts` | settingSources defaults (`['user','project','local']`), `resolveSettings()` validation, stderr surfacing, governance/version keys passthrough | 02.12, 02.14, 02.17, 02.20, 05.4 |
| `src/config/agents.ts` | register CC built-ins (general-purpose; Explore=read-only via disallowedTools; Plan=architect) as `AgentDefinition`s; load disk frontmatter agents via settingSources | 14.10, 14.21 |
| `src/config/outputStyle.ts` | output style → `systemPrompt` preset **append** (phantom-`outputStyle` workaround) | 02.18 |
| `src/config/sandbox.ts` | friendly sandbox config → `Options.sandbox` (`enabled`/`autoAllowBashIfSandboxed`/`network`) | 42.2, 10.6 |
| `src/config/provider.ts` | provider/base-URL/gateway → `env` (`ANTHROPIC_BASE_URL`, custom headers, Bedrock/Vertex/Foundry flags) | 22.6 |
| `src/config/tools.ts` | base tool pool (`tools` preset) + allow/deny/alias; WebFetch `domain:<host>` rules | 05.7, 13.8 |
| `src/config/resolveOptions.ts` | compose all of the above into a single SDK `Options` object | (orchestrator) |
| `src/harness.ts` | `createHarness`, `run`, `stream`, `rewind` (enableFileCheckpointing), introspection passthrough; commands/skills load via settingSources | 11.13, 20.2 |
| `src/cli.ts` | arg parse + stdin pipe (non-TTY ingestion) + stream renderer | 01.11 |
| `src/index.ts` | public exports | — |

All 16 bridges are covered. `resolveOptions()` is pure (config → Options) so it is unit-testable
without the network; the live behavior is checked by the verification suite.

## 5. Verification

`harness/test/` — vitest, reusing the Phase-0 probe infra (`../.env`, `runProbe` pattern). Two tiers:
- **Unit (no network):** `resolveOptions()` produces the expected SDK `Options` for representative
  configs (settingSources defaulting, outputStyle→systemPrompt, sandbox mapping, provider env, agent
  registration). Fast, deterministic.
- **Live parity (network, ANTHROPIC_API_KEY):** each bridge gets one live-SDK test asserting the
  CC-faithful behavior, e.g.: CLAUDE.md loads by default; a `.claude/commands/x.md` appears in
  `supportedCommands()`; output-style swaps the persona; `rewind()` restores a written file; the
  built-in `Explore` agent is read-only. These extend the Phase-0 probes into regression tests.

## 6. Tooling

- **Node ≥20 + TypeScript (ESM, NodeNext).** SDK default runtime; most CI-portable. Bun stays
  available later via the SDK `executable` option (Phase 3 Ink runs on Node too).
- **vitest** for tests. **tsx** for dev/CLI run. **tsc --noEmit** for typecheck.
- New package `CC-to-SDK/harness/` (separate from `probes/`); `node_modules` gitignored; `.env` reused
  from `CC-to-SDK/.env` (already gitignored).

## 7. Non-goals (this phase)

- The interactive Ink TUI (Phase 3) and the modes/coordinator (Phase 2).
- Reimplementing the agent loop, settings cascade, tools, or permission engine (SDK-provided).
- The claude.ai-login-gated and internal-only features (🚫 in the parity map).
- A config *file* format (`cc-harness.config.ts`) — programmatic config first; YAGNI.

## 8. Success criteria

- `createHarness(config)` resolves a friendly config into correct SDK `Options` with CC-faithful
  defaults; all 16 bridges implemented and unit-tested.
- `cc-harness "<prompt>"` runs a real agent end-to-end (incl. piped stdin) against the live SDK.
- Live parity suite: ≥1 passing test per bridge that needs runtime behavior (CLAUDE.md load, custom
  command discovery, output-style, rewind, built-in agent restriction, sandbox).
- `tsc --noEmit` clean; `vitest` green; no secret committed.
- A Phase-2/3 author can consume `createHarness`/`Harness` as the stable core without touching SDK
  `Options` directly.
