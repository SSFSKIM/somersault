# Repo overview

Tool-neutral orientation for the **somersault monorepo**. It is the single source of truth for repo
structure and the codex-submodule workflow, referenced by the per-agent context files — `AGENTS.md`
(Codex and other AGENTS.md readers) and `CLAUDE.md` (Claude Code) — so the repo story lives in one
place and does not drift between them.

## What this repo is

The home of **CC-to-SDK**: a customizable replication of Claude Code built on the **Claude Agent
SDK**, shipping the `ccx` binary + library. Everything else in the repo is reference material or an
adjacent research surface. The product has its own `CLAUDE.md`/`AGENTS.md` hierarchy — read
`CC-to-SDK/CLAUDE.md` first for the product map, the parity scorecard, and the working conventions.

| Path | What it is | Build? |
|---|---|---|
| `CC-to-SDK/` | **The product.** `harness/` (the `ccx` binary + library), `app-server/` (codex-app-server-protocol front-end), live-SDK `probes/`, `reforge/` (differential engine harness), `docs/parity/` (scorecard + drift ritual), `docs/superpowers/` (specs/plans). | Yes (npm per package) |
| `codex/` | **Submodule** → [`SSFSKIM/codex`](https://github.com/SSFSKIM/codex): OpenAI's Codex, a production Rust agent harness (~90-crate Cargo workspace), plus per-crate agent navigation docs (`codex-rs/{core,tui,app-server}/CLAUDE.md`). A worked example to study and compare against — the SQ/EQ loop, per-OS sandboxing, the app-server JSON-RPC hub. | Not here (in its own repo) |
| `ptc-surface/` | Programmatic-tool-calling (PTC) research surface — persistent-IPython-kernel tool calling for Claude Code. | No |
| `docs/` | Repo-level docs (this file). Product docs live under `CC-to-SDK/docs/`. | — |

## The codex submodule

- Populate on demand: `git submodule update --init codex` (it is large; skip unless you need it).
- **Work on codex happens in its own repo**, not through the submodule: `SSFSKIM/codex` is a
  standalone copy of `openai/codex` (not a GitHub fork — the fork slot is held by the archived
  `codex_somersault`). It carries exactly one commit on top of upstream: the per-crate agent docs.
- Upstream sync (in a clone of `SSFSKIM/codex`): `git remote add upstream
  https://github.com/openai/codex.git && git fetch upstream && git merge upstream/main`, resolve
  (the doc commit rarely conflicts), push — then bump the submodule pin here.
- Inside the submodule, upstream's `AGENTS.md` is canonical for Rust conventions; the per-crate
  `CLAUDE.md`/`AGENTS.md` pairs are byte-identical mirrors — edit both together, verify with
  `for c in core tui app-server; do cmp codex-rs/$c/CLAUDE.md codex-rs/$c/AGENTS.md; done`.
- After an upstream merge that moves files or reshapes crates, refresh the navigation maps — a
  stale map is worse than none.

## History

Extracted 2026-08-31 — with full commit history (2,500+ commits) — from
[`SSFSKIM/codex_somersault`](https://github.com/SSFSKIM/codex_somersault) (archived), a fork of
`openai/codex` this project grew inside. The extraction kept every CC-to-SDK commit and dropped the
codex Rust tree (now the submodule) and the reference-only Claude Code source snapshot (stripped
from history, not just the tip). Pre-extraction paths cited by old session reports under
`.doperpowers/` (e.g. `codex-rs/...`, `Claude Code Src/...`) resolve in the archive, not here.
