# somersault

A monorepo centered on **CC-to-SDK**: a customizable replication of Claude Code built on the
[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview), shipping the `ccx`
binary and library, plus the reference material that informs it.

## Layout

| Path | What it is |
|---|---|
| `CC-to-SDK/` | **The product.** `harness/` (the `ccx` binary + library), `app-server/` (codex-app-server-protocol front-end for the harness), live-SDK `probes/`, `reforge/` (differential engine harness), parity scorecard (`docs/parity/`), design specs (`docs/superpowers/`). |
| `codex/` | Git **submodule** → [`SSFSKIM/codex`](https://github.com/SSFSKIM/codex): OpenAI's Codex (a production Rust agent harness) plus per-crate agent navigation docs — kept as a worked example of a coding-agent harness, not built here. |
| `ptc-surface/` | Programmatic-tool-calling (PTC) research surface — persistent-IPython-kernel tool calling for Claude Code. |
| `docs/` | Repo-level docs; start at [`docs/repo-overview.md`](docs/repo-overview.md). |

## History

This repository was extracted on 2026-08-31 — with full commit history — from
[`SSFSKIM/codex_somersault`](https://github.com/SSFSKIM/codex_somersault) (archived), a fork of
[`openai/codex`](https://github.com/openai/codex) that had grown this project inside it. The
extraction kept every CC-to-SDK commit and dropped the codex Rust tree (now the `codex/`
submodule) and reference-only material.
