# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repo is the **somersault monorepo**. The active project is **`tui-to-gui/`** — a research and
spec-writing study of how every Claude Code terminal surface translates into a GUI, consumed by
the afleet macOS app at `~/developer/github/afleet` (read-only from here). The earlier main
project, **`CC-to-SDK/`** (a replication of the Claude Code TUI on the Claude Agent SDK, `ccx`),
closed on 2026-09-09 and is kept as evidence.
**Read [`docs/repo-overview.md`](docs/repo-overview.md) first** — it is the source of truth for repo
structure, the codex-submodule workflow, and the extraction history. `CC-to-SDK/CLAUDE.md`
(auto-loads as you enter it) is canonical for the product: its map, commands, parity scorecard, and
working conventions live there, not here.

## Repository map

- **`tui-to-gui/`** — the active study: `README.md` (map, decisions, backlog), `SHARED-BRIEF.md`
  (method and card schema), `surfaces/A–H` (surface cards). Canon is Claude Code 2.1.263 via the
  spec library at `~/claude-code-bundle/2.1.263/SPEC/`.
- **`CC-to-SDK/`** — the closed TUI clone, kept as evidence (own `CLAUDE.md`): `harness/` (`ccx`), `app-server/`, `probes/`,
  `reforge/`, `docs/parity/`, `docs/superpowers/`.
- **`codex/`** — git submodule → [`openai/codex`](https://github.com/openai/codex), pinned to an
  upstream commit. A reference example, not built here; usually **not checked out** — run
  `git submodule update --init codex` only when you need to read it. Never edit inside the
  submodule; to move it forward, bump the pin (see the overview). Crate navigation maps:
  `docs/codex-maps/`.
- **`ptc-surface/`** — programmatic-tool-calling research surface.
- `docs/` — repo-level docs only; product docs belong under `CC-to-SDK/docs/`.

## Conventions

- Study work happens in `tui-to-gui/`; `CC-to-SDK/` is read for its verified canon quirks (`docs/parity/tui-ux.md`), not developed further. Inside it, defer to its `CLAUDE.md`.
- `AGENTS.md` files here are symlinks to their sibling `CLAUDE.md` (one story, two readers). Keep
  them paired when adding new ones.
- Old session reports under `.doperpowers/` may cite pre-extraction paths (`codex-rs/...`,
  `Claude Code Src/...`); those resolve in the archived `codex_somersault` repo, not here.
