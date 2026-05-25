# Fork overview

Tool-neutral orientation for **this fork** of OpenAI's Codex. It is the single source of truth for fork-specific structure, architecture, and the upstream-merge workflow. It is referenced by the per-agent context files — `AGENTS.md` (Codex and other AGENTS.md readers) and `CLAUDE.md` (Claude Code) — so the fork story lives in one place and does not drift between them.

This file is **fork-local**: it is not part of upstream and will never arrive via an upstream merge. Keep it current (see "Keeping the agent docs current").

## What this repo is

A **fork of OpenAI's Codex** (`upstream` = `openai/codex.git`, `origin` = `SSFSKIM/codex_somersault`) — a lightweight Rust coding-agent harness. The goal is to deeply modify and expand Codex's agentic capabilities **while staying mergeable with upstream**. The fork currently diverges from `upstream/main` by a single commit that only adds `Claude Code Src/`; `codex-rs/` is still pristine upstream code. Keep it that way where you can (see "Working with upstream").

The repo has two distinct halves — don't confuse them:

| Path | What it is | Build? |
|---|---|---|
| `codex-rs/` | **The product.** The Rust agent harness — a ~90-crate Cargo workspace (also buildable with Bazel). This is what we build and extend. | Yes (Cargo + Bazel) |
| `Claude Code Src/` | **A reference only.** A separate TypeScript agent harness ("somersault") with its **own** `CLAUDE.md`. Used to research capabilities to port into Codex. Not part of the Rust build or runtime. | No |

Other top-level dirs: `codex-cli/` (npm wrapper that ships the Rust binary), `sdk/` (Python + TypeScript SDKs), `docs/` (upstream user/dev docs — do not put product docs here per `AGENTS.md`), `scripts/`, `patches/` (Bazel third-party patches).

## Architecture big picture

The whole system is one **Submission Queue / Event Queue (SQ/EQ)** loop. Clients submit `Op`s and consume `Event`s; `core` runs the agent loop. Every front-end (TUI, exec, app-server, IDE) is just a client of the same `core`.

```
cli/ (multitool) ──► tui/ (Ratatui UI)  ─┐
                 └─► exec/ (headless)    ─┼─► core/  ──►  model provider (Responses API)
app-server/ (JSON-RPC, for IDE/SDK) ─────┘     │              │
                                               └─► tools ──► sandbox (per-OS) / apply-patch / MCP
```

**Trace a turn through these files:**
- `codex-rs/protocol/` — defines the SQ/EQ contract with **minimal deps**: `Submission`, `Op`, `Event`, `EventMsg` in `protocol/src/protocol.rs`. Shared by core and every client. Avoid business logic here (use `Ext`-style traits elsewhere).
- `codex-rs/core/` — the agent loop. `core/src/codex_thread.rs` (`CodexThread`: `submit(Op)` / `next_event()`) → `core/src/session/handlers.rs` (the submission loop, dispatches per `Op`) → `core/src/session/{session.rs,turn.rs,turn_context.rs}` (one `Session`, at most one active `Turn`) → `core/src/client.rs` (`ModelClient`). See `codex-rs/core/CLAUDE.md` for the full internal map.
- `codex-rs/tools/` — `ToolSpec` / tool definitions; the model's tool calls are validated against the permission profile, then executed (shell, file edit, `apply-patch/`, MCP).
- **Sandboxing** is per-OS, selected by `--sandbox` (`read-only` | `workspace-write` | `danger-full-access`): `sandboxing/` orchestrates; Seatbelt on macOS, bubblewrap+Landlock on Linux (`linux-sandbox/`, `bwrap/`), restricted token on Windows (`windows-sandbox-rs/`). `execpolicy/` gates which commands are allowed.
- `codex-rs/app-server/` + `app-server-protocol/` — JSON-RPC 2.0 server wrapping `core` for IDEs/SDKs (stdio/ws/unix). Primitives: Thread → Turn → Item. **All new API work goes in v2, not v1.** See `codex-rs/app-server/CLAUDE.md`.
- **MCP:** `codex-mcp/` (client + connection manager — route tool mutations through `mcp_connection_manager.rs`), `rmcp-client/`, and `mcp-server/` (Codex *as* an MCP server via `codex mcp-server`).

**Extension subsystems** (the surface most likely to be expanded in this fork): `hooks/` (lifecycle events: PreToolUse, SessionStart, Stop, …), `skills/` + `core-skills/` (markdown agent subroutines), `plugin/` + `core-plugins/` (installable bundles of skills/hooks/MCP), `memories/` (persistent memory), `code-mode/` (`exec`/`wait` multi-turn execution), `cloud-tasks/` (`codex cloud-tasks`). Most have a crate-level `README.md` — read it first.

**Per-crate navigation maps:** `codex-rs/core/CLAUDE.md`, `codex-rs/tui/CLAUDE.md`, `codex-rs/app-server/CLAUDE.md` (these auto-load for Claude Code as it enters each crate; other agents can read them directly).

## Working with upstream

This fork intends to keep merging/rebasing `upstream/main` (OpenAI Codex). To keep merges cheap:
- `git fetch upstream` then merge/rebase `upstream/main`. `AGENTS.md`, `docs/` (except this file and other fork-local additions), and most of `codex-rs/` are upstream-owned — expect changes there to come from upstream, and avoid gratuitous edits to them.
- Prefer **isolated, minimal-footprint** changes (new crates/modules, narrow edits) over sprawling edits to high-traffic upstream files — they conflict on every merge.
- After any dependency change, reconcile Bazel: `just bazel-lock-update` + `just bazel-lock-check`.
- Local dev skills used to maintain this fork live in `.codex/skills/` (e.g. `babysit-pr`, `code-review`, `remote-tests`).

## Keeping the agent docs current

The fork-local agent docs (`CLAUDE.md`, the per-crate `CLAUDE.md` files, the `AGENTS.md` fork pointer, and this file) never arrive via an upstream merge, and the per-crate maps pin concrete paths/types (`session/handlers.rs`, `bespoke_event_handling.rs`, …) that drift when upstream restructures. So:
- After merging `upstream/main`, if it moved/renamed files or changed crate layout, refresh the affected navigation maps and commands. A stale map is worse than none.
- **Per-crate mirror pairs:** `codex-rs/{core,tui,app-server}/CLAUDE.md` and the `AGENTS.md` beside each are **byte-identical copies** (Claude Code reads `CLAUDE.md`; Codex and other AGENTS.md agents read `AGENTS.md`). Edit both together. Verify none have drifted: `for c in core tui app-server; do cmp codex-rs/$c/CLAUDE.md codex-rs/$c/AGENTS.md; done` (no output = in sync).
- Re-review the whole set periodically (and after major model releases): drop guidance the current model no longer needs, and remove rules made redundant by new upstream/native capabilities.

## Canonical sources (on conflict, these win)

`AGENTS.md`, the per-crate `codex-rs/*/README.md` files, and `codex-rs/tui/styles.md` are **upstream-owned and authoritative**. The fork docs deliberately point to them instead of copying them, to limit drift. If a fork doc disagrees with one of these, the upstream doc is correct — update the fork doc to match rather than editing the upstream doc.

## `Claude Code Src/` — reference, not build

A leaked-and-extended TypeScript harness used purely as a capabilities reference. It has its **own** `CLAUDE.md` and `docs/specs/` — read those when mining ideas from it. Treat `src/main.tsx` there as read-only bundled output. Nothing in this directory is part of the Codex Rust build.
