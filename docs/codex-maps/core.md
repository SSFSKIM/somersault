<!-- Mirror file: codex-rs/core/CLAUDE.md and codex-rs/core/AGENTS.md are byte-identical — edit both together. Claude Code reads CLAUDE.md; Codex (and other AGENTS.md agents) read AGENTS.md. -->
# codex-core — crate guide

Guidance for working in the `codex-core` crate. Read the repo-root `CLAUDE.md` and `AGENTS.md` first; this file only adds core-specific structure and gotchas. Keep it lean.

## What this crate is

The agent's business logic — the implementation behind the SQ/EQ loop described in `docs/fork-overview.md`. Every Rust UI (`tui`, `exec`, `app-server`) drives this crate; it should stay UI-agnostic and ideally become a reusable library.

**The prime directive for this crate (from AGENTS.md): resist adding code here.** It's already the largest crate (~44k LoC). Before adding a concept, ask whether it belongs in another existing crate, or warrants a *new* crate in the workspace. Push back on the same in review. New code that doesn't need `core`'s internals should not live here.

## Public surface is small — respect it

Almost everything is `mod` / `pub(crate)`; the real exported API (see `lib.rs`) is roughly: `CodexThread` (+settings/snapshot types), `ThreadManager` (+`NewThread`, `ForkSnapshot`, `StartThreadOptions`), `TurnContext`, the `config`/`exec`/`context`/`sandboxing`/`skills` modules, `McpManager`, `AgentsMdManager`, `StateDbHandle`. Add to the public surface deliberately — exporting an internal type makes it a contract other crates depend on across upstream merges.

## Internal map (where things live)

**Entry / lifetime.**
- `codex_thread.rs` — `CodexThread`, the public handle: `submit(Op)` / `next_event()` / `steer_input`.
- `thread_manager.rs` — owns multiple threads (start / resume / fork). Where a session is born.

**The loop — `session/`.** This is the heart.
- `session/session.rs` — `Session`: one per conversation; holds config, the event sender, services (MCP, skills, plugins), and the single `ActiveTurn`.
- `session/handlers.rs` — the **submission loop**: receives `Submission`s, matches on `Op`, dispatches. Start here to trace what an incoming `Op` does.
- `session/turn.rs` + `session/turn_context.rs` — a `Turn` (one user-input→response cycle) and the per-turn config snapshot (`TurnContext`) read throughout the codebase.
- `session/{input_queue,multi_agents,review,mcp,rollout_reconstruction}.rs` — input buffering, sub-agent fan-out, review turns, per-session MCP wiring, rebuilding a session from its rollout.

**What a turn runs — `tasks/`.** A `Turn` executes a `SessionTask` (trait in `tasks/mod.rs`). Implementations: `RegularTask` (normal agent turn — the common path), `CompactTask` (history compaction), `ReviewTask` (`/review`), `UserShellCommandTask` (a `!`-style shell turn). Add new turn *kinds* here, not by branching inside `turn.rs`.

**Model I/O.** `client.rs` + `client_common.rs` — `ModelClient`, the Responses-API streaming loop (request build, SSE parsing, retries). `stream_events_utils.rs` maps stream chunks to protocol events.

**Tools — `tools/`.** `router.rs` (`ToolRouter`: `build_tool_call` parses a model tool call → `dispatch_tool_call_*` routes it), `registry.rs` (which tools exist), `orchestrator.rs` + `parallel.rs` (sequencing / parallel calls), `sandboxing.rs` + `network_approval.rs` (gating), `code_mode/`. One file per tool in **`tools/handlers/`** — `shell`, `apply_patch` (grammar in `apply_patch.lark`), `unified_exec`, `mcp`, `multi_agents`(`_v2`), `plan`, `goal`, `request_permissions`, `request_user_input`, `view_image`, `tool_search`, etc. To change a tool's behavior, start at its handler; for MCP tool-call mutation route through `codex-mcp`'s `mcp_connection_manager.rs` (per AGENTS.md).

**Command execution.** `exec.rs` + `unified_exec/` (process spawning/management, head/tail buffering), `exec_policy.rs` (allowed-command gating), `shell.rs` / `shell_snapshot.rs`.

**Sandbox.** `sandboxing/`, `landlock.rs` (Linux), `windows_sandbox.rs`, `windows_sandbox_read_grants.rs`. The per-OS support matrix and helper expectations are in this crate's `README.md` — read it before touching sandbox code, and never touch the `CODEX_SANDBOX*` env-var code (root CLAUDE.md / AGENTS.md).

**Prompt assembly.** `context/` — many small instruction *fragments* injected into the model prompt (skills, plugins, apps, permissions, environment, collaboration mode, …); each lives in its own file, prompt text under `context/prompts/`. `context_manager/` — the conversation history (normalize / updates). `compact.rs` + `compact_remote*.rs` — context compaction. `agents_md.rs` — `AgentsMdManager` (how Codex itself discovers and layers `AGENTS.md`).

**Config — `config/`.** `Config`, permissions (`permissions.rs`, `resolved_permission_profile.rs`), `schema.rs`. If you change `ConfigToml` or nested types, run `just write-config-schema` and commit `core/config.schema.json` (AGENTS.md).

**Extension subsystems (live inside core today).** `agent/` (sub-agents; built-in roles `explorer`/`awaiter` as `.toml`), `guardian/` (optional auto-reviewer for approvals; prompts in `policy.md`/`prompt.rs`), `hook_runtime.rs` (lifecycle hook execution), `skills/`, `plugins/`, `apps/`, `connectors.rs`, `goals.rs`. These are the most likely surfaces to extend for this fork — prefer adding a sibling crate over growing these when the new code doesn't need core internals.

**Persistence.** `rollout/` + `thread_rollout_truncation.rs` (the session rollout log), `state_db_bridge.rs` (SQLite state via `codex-state`).

## Conventions & gotchas

- **Changes here are "core."** Per root CLAUDE.md, after passing `just test -p codex-core` for changes touching core/common/protocol, run the full `just test` (ask the user first).
- **Don't grow hot files.** Same module-size discipline as the rest of the repo — add a new module/file rather than extending a large one; move related tests with the code.
- **Tests:** unit tests sit next to modules as `*_tests.rs`; integration tests in `core/tests/`; snapshots in `*/snapshots/`. Prefer the `core_test_support::responses` helpers (mock SSE / assert outbound `/responses` bodies) for end-to-end tests — see AGENTS.md "Integration tests (core)" for the patterns.
- **Don't call `reset_client_session` unnecessarily** (AGENTS.md) — let the incremental check decide whether to reuse the request.
- Run `just test -p codex-core` (nextest); be patient with Rust lock contention, don't kill by PID.
