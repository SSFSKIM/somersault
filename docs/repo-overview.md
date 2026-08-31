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
| `codex/` | **Submodule** → [`openai/codex`](https://github.com/openai/codex), pinned to an upstream commit: OpenAI's Codex, a production Rust agent harness (~90-crate Cargo workspace). A worked example to study and compare against — the SQ/EQ loop, per-OS sandboxing, the app-server JSON-RPC hub. Navigation maps: `docs/codex-maps/`. | Not here (upstream) |
| `ptc-surface/` | Programmatic-tool-calling (PTC) research surface — persistent-IPython-kernel tool calling for Claude Code. | No |
| `docs/` | Repo-level docs (this file). Product docs live under `CC-to-SDK/docs/`. | — |

## The codex submodule

- Populate on demand: `git submodule update --init codex` (it is large; skip unless you need it).
- The submodule points **directly at `openai/codex`**, pinned to an upstream-main commit — there is
  no intermediate fork to maintain. To advance it: `cd codex && git fetch origin && git checkout
  <newer upstream sha>`, then commit the updated gitlink here.
- The submodule is read-only reference — never commit changes inside it. Rust conventions inside
  it are upstream's own `AGENTS.md`.
- Per-crate navigation maps for reading the codex source live in **`docs/codex-maps/`**
  (`core.md`, `tui.md`, `app-server.md`). They are written against the pinned commit — refresh
  them when a pin bump moves files or reshapes crates; a stale map is worse than none.

## History

Extracted 2026-08-31 — with full commit history (2,500+ commits) — from
[`SSFSKIM/codex_somersault`](https://github.com/SSFSKIM/codex_somersault) (archived), a fork of
`openai/codex` this project grew inside. The extraction kept every CC-to-SDK commit and dropped the
codex Rust tree (now the submodule) and the reference-only Claude Code source snapshot (stripped
from history, not just the tip). Pre-extraction paths cited by old session reports under
`.doperpowers/` (e.g. `codex-rs/...`, `Claude Code Src/...`) resolve in the archive, not here.
