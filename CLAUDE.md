# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repo is the **somersault monorepo**. The main project is **`CC-to-SDK/`** — a customizable
replication of Claude Code on the **Claude Agent SDK**, shipping the `ccx` binary + library.
**Read [`docs/repo-overview.md`](docs/repo-overview.md) first** — it is the source of truth for repo
structure, the codex-submodule workflow, and the extraction history. `CC-to-SDK/CLAUDE.md`
(auto-loads as you enter it) is canonical for the product: its map, commands, parity scorecard, and
working conventions live there, not here.

## Repository map

- **`CC-to-SDK/`** — the product (own `CLAUDE.md`): `harness/` (`ccx`), `app-server/`, `probes/`,
  `reforge/`, `docs/parity/`, `docs/superpowers/`.
- **`codex/`** — git submodule → [`openai/codex`](https://github.com/openai/codex), pinned to an
  upstream commit. A reference example, not built here; usually **not checked out** — run
  `git submodule update --init codex` only when you need to read it. Never edit inside the
  submodule; to move it forward, bump the pin (see the overview). Crate navigation maps:
  `docs/codex-maps/`.
- **`ptc-surface/`** — programmatic-tool-calling research surface.
- `docs/` — repo-level docs only; product docs belong under `CC-to-SDK/docs/`.

## Conventions

- Work almost always happens in `CC-to-SDK/` — defer to its `CLAUDE.md` and per-package docs.
- `AGENTS.md` files here are symlinks to their sibling `CLAUDE.md` (one story, two readers). Keep
  them paired when adding new ones.
- Old session reports under `.doperpowers/` may cite pre-extraction paths (`codex-rs/...`,
  `Claude Code Src/...`); those resolve in the archived `codex_somersault` repo, not here.
