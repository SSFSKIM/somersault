# somersault

A monorepo that grew around **CC-to-SDK**, a replication of the Claude Code terminal UI on the
[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview) (`ccx`). That program closed
on 2026-09-09; the repo now hosts the **TUI-to-GUI study** (`tui-to-gui/`), research and
spec-writing on how every Claude Code terminal surface translates into a GUI, consumed by the
afleet macOS workspace. CC-to-SDK stays as evidence: its parity scorecard records canon quirks
verified against the binary.

## Layout

| Path | What it is |
|---|---|
| `tui-to-gui/` | **The active program.** The TUI-to-GUI translation study: `README.md` is the map, `SHARED-BRIEF.md` the method, `surfaces/` the per-family surface cards (A–H). Consumer: `~/developer/github/afleet`. |
| `CC-to-SDK/` | **Closed program (2026-09-09), kept as evidence.** `harness/` (the `ccx` binary + library), `app-server/` (codex-app-server-protocol front-end for the harness), live-SDK `probes/`, `reforge/` (differential engine harness), parity scorecard (`docs/parity/`), design specs (`docs/superpowers/`). |
| `codex/` | Git **submodule** → [`openai/codex`](https://github.com/openai/codex), pinned to an upstream commit: OpenAI's Codex, a production Rust agent harness — kept as a worked example of a coding-agent harness, not built here. Per-crate navigation maps: [`docs/codex-maps/`](docs/codex-maps/). |
| `ptc-surface/` | Programmatic-tool-calling (PTC) research surface — persistent-IPython-kernel tool calling for Claude Code. |
| `docs/` | Repo-level docs; start at [`docs/repo-overview.md`](docs/repo-overview.md). |

## History

This repository was extracted on 2026-08-31 — with full commit history — from
[`SSFSKIM/codex_somersault`](https://github.com/SSFSKIM/codex_somersault) (archived), a fork of
[`openai/codex`](https://github.com/openai/codex) that had grown this project inside it. The
extraction kept every CC-to-SDK commit and dropped the codex Rust tree (now the `codex/`
submodule) and reference-only material.
