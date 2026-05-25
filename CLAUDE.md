# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repo is a **fork of OpenAI's Codex** (a Rust coding-agent harness). **Read [`docs/fork-overview.md`](docs/fork-overview.md) first** — it is the source of truth for fork structure (two halves: `codex-rs/` the product vs `Claude Code Src/` a reference), the SQ/EQ architecture and codebase map, and the upstream-merge workflow. Per-crate navigation maps live in `codex-rs/{core,tui,app-server}/CLAUDE.md` (they auto-load as you enter each crate).

## Repository map

Highest-level structure only — scan before grepping; the detailed SQ/EQ flow and per-crate maps are in `docs/fork-overview.md` and the per-crate `CLAUDE.md` files.

- **`codex-rs/`** — the Rust agent harness we build (~90-crate Cargo workspace; also Bazel). Key crates:
  - `core/` (`codex-core`) — the agent loop; the largest crate (**resist adding to it**)
  - `protocol/` — the `Submission`/`Op`/`Event` (SQ/EQ) wire types shared by every client
  - `tui/` — Ratatui terminal UI · `exec/` — headless runner · `cli/` — multitool entry (the `codex` subcommands)
  - `app-server/` + `app-server-protocol/` — JSON-RPC hub every client (TUI, IDE, SDK) talks through (**v2-only** for new API)
  - `codex-mcp/`, `rmcp-client/`, `mcp-server/` — MCP client + Codex-as-MCP-server
  - `sandboxing/`, `linux-sandbox/`, `windows-sandbox-rs/`, `execpolicy/` — per-OS command sandboxing
  - extension surfaces (most likely to expand): `hooks/`, `skills/`+`core-skills/`, `plugin/`+`core-plugins/`, `memories/`, `code-mode/`, `cloud-tasks/`
- **`Claude Code Src/`** — TypeScript reference harness; research only, **not built** (has its own `CLAUDE.md`)
- `codex-cli/` npm wrapper · `sdk/` Python+TS SDKs · `docs/` (incl. `fork-overview.md`) · `scripts/` · `patches/` (Bazel third-party)

## AGENTS.md is canonical for Rust conventions — read it

Codex (the product) auto-reads **`AGENTS.md`**; Claude Code does **not**, so read `./AGENTS.md` before non-trivial Rust work — it is the source of truth for Rust style/test/API rules (async-trait shape, app-server v2 payload rules, TUI/ratatui styling, snapshot-test workflow, module-size limits). There is also a nested `codex-rs/tui/src/bottom_pane/AGENTS.md`. This file keeps only a distilled quick-reference below; on any conflict, `AGENTS.md` wins.

## Commands

All Rust commands run from the **`codex-rs/`** directory; the `justfile` (at repo root, `set working-directory := "codex-rs"`) is the source of truth.

```bash
just fmt                    # format Rust + Python SDK. Run after Rust changes; no approval needed.
just test -p codex-tui      # test ONE crate (preferred). Append a name to filter to a single test.
just test                   # full suite (slow). Ask the user before running this.
just fix -p <crate>         # clippy --fix for a crate (scope with -p to avoid workspace-wide builds)
just clippy -p <crate>      # clippy without fixing
just codex   (alias: just c)  # run codex from source: cargo run --bin codex
just exec "<prompt>"        # codex exec (headless)
just mcp-server-run         # run `codex mcp-server`
```

- Tests run on **`cargo nextest`** (not `cargo test`) — install with `cargo install --locked cargo-nextest`. Snapshot tests use **`cargo-insta`** (`cargo install --locked cargo-insta`); see AGENTS.md for the accept workflow.
- Rust builds hold a lock and can be **slow** — be patient, never kill them by PID.
- **Regenerate generated artifacts in the same change** when you touch their inputs: `just write-config-schema` (after `ConfigToml` changes), `just write-app-server-schema` (app-server protocol), `just write-hooks-schema` (hooks).
- **After changing `Cargo.toml`/`Cargo.lock`:** run `just bazel-lock-update` then `just bazel-lock-check` and commit the `MODULE.bazel.lock` update. Bazel must stay in sync with Cargo — if you add `include_str!`/`include_bytes!`/`sqlx::migrate!`, update that crate's `BUILD.bazel` or Bazel builds break even when Cargo passes.
- JS/Markdown formatting (root): `pnpm format` / `pnpm format:fix`.

## Critical conventions (distilled — full list in AGENTS.md)

- **Never touch `CODEX_SANDBOX_NETWORK_DISABLED_ENV_VAR` or `CODEX_SANDBOX_ENV_VAR` code.** Tests rely on these to early-exit under the sandbox you run in.
- **Resist adding to `codex-core`.** It's already the largest crate. Prefer an existing crate or a new one; refactor to avoid growing it.
- **Keep modules small** (target <500 LoC, hard-think above ~800). Add new modules instead of growing hot files like `tui/src/chatwidget.rs`, `tui/src/app.rs`, `tui/src/bottom_pane/*`.
- **Crate names are `codex-` prefixed** (the `core/` dir is crate `codex-core`).
- **UI changes need `insta` snapshot coverage**; inline `format!` args; make `match` exhaustive; prefer enums/newtypes over bare bool/`Option` params (or use `/*param_name*/` comments per the `argument_comment_lint`).
- After Rust changes: `just fmt`, then `just test -p <crate>`, then `just fix -p <crate>`. Run the full `just test` only for changes in `core`/`common`/`protocol`, and ask first.

> Keeping these CLAUDE.md files current with upstream is covered in `docs/fork-overview.md` → "Keeping the agent docs current".
