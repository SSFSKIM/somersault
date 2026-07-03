<!-- Mirror file: codex-rs/app-server/CLAUDE.md and codex-rs/app-server/AGENTS.md are byte-identical — edit both together. Claude Code reads CLAUDE.md; Codex (and other AGENTS.md agents) read AGENTS.md. -->
# codex-app-server — crate guide

Guidance for the `codex-app-server` crate and its tightly-coupled sibling `app-server-protocol`. Read the repo-root `CLAUDE.md` and `AGENTS.md` first — AGENTS.md's **"App-server API Development Best Practices"** section is the authoritative rulebook for payload shape/naming and is not repeated here. The crate's `README.md` is the authoritative API reference (every method + examples) and **must be updated when API behavior changes** (AGENTS.md).

## What this crate is

`codex app-server` is the JSON-RPC 2.0 (MCP-style, header omitted) interface that wraps `codex-core` for **every rich client**: the VS Code extension, the TUI (`tui/` via `app_server_session.rs`), and SDKs. It is the hub described in `docs/fork-overview.md` — clients never touch `core` directly; they speak this protocol.

Three primitives (README "Core Primitives"): **Thread** (conversation) → **Turn** (one user-input→response cycle) → **Item** (user message, agent reasoning, shell command, file edit, …). Lifecycle: `initialize`/`initialized` once per connection → `thread/start` (or `resume`/`fork`) → `turn/start` → stream `item/*` + deltas → `turn/completed`.

## The one rule for this crate: v2 only

API surface lives in the **separate `app-server-protocol` crate** (`../app-server-protocol/`), split physically:
- `protocol/v1.rs` — **frozen** legacy types (init, exec/patch approvals). Do not add here.
- `protocol/v2/` — **active** development; one file per domain (`thread.rs`, `turn.rs`, `item.rs`, `config.rs`, `mcp.rs`, `permissions.rs`, `plugin.rs`, …). **All new methods, params, and notifications go here.**
- `protocol/common.rs` — shared types; `event_mapping.rs` — maps core events → protocol items; `experimental_api.rs` — `#[experimental(...)]` gating; `export.rs` — TS / JSON-Schema generation.

Wire conventions (full list in AGENTS.md): camelCase via `#[serde(rename_all="camelCase")]`; `<resource>/<method>` with singular resource; `*Params`/`*Response`/`*Notification` naming; `#[ts(export_to="v2/")]` on v2 types; never `skip_serializing_if` on v2 payloads; client→server optional fields use `#[ts(optional = nullable)]`; new list methods use cursor pagination (`cursor`/`limit` → `data`/`next_cursor`).

## Architecture map (this crate)

The server is a **request router + a reverse event mapper** around `core`'s `ThreadManager`.

- **Transports — `transport.rs`** (stdio default, `ws://`, `unix://`, `off`) and **`in_process.rs`** (in-memory channels; the path the TUI uses — same server code, no process boundary). `app-server-daemon/` runs it as a long-lived daemon; `app-server-client/` is the Rust client; `app-server-test-client/` + `app-server-transport/` support testing.
- **Inbound dispatch — `message_processor.rs`.** `MessageProcessor::process_request` → `handle_client_request` matches the `ClientRequest` enum and delegates to a domain processor in **`request_processors/`** (`thread_processor.rs`, `turn_processor.rs`, `config_processor.rs`, `mcp_processor.rs`, `command_exec_processor.rs`, `fs_processor.rs`, `plugins.rs`, …). **To add an endpoint: add the type in `protocol/v2/`, a `ClientRequest` arm, and a handler in the matching processor.**
- **Outbound events — `bespoke_event_handling.rs`** (largest file). Translates core `Event`/`EventMsg` into client notifications (`item/started`, `item/completed`, `turn/completed`, approval requests, …). This is where a new core event becomes a wire notification.
- **Outbound plumbing — `outgoing_message.rs`** (connection routing, per-thread scoped senders), `request_serialization.rs`, `thread_state.rs` / `thread_status.rs` (subscription + status tracking), `connection_rpc_gate.rs` (the initialize handshake gate).
- **Config service — `config_manager.rs` / `config_manager_service.rs`**, hot-reload via `config/*` methods; `fs_watch.rs`, `skills_watcher.rs`, `mcp_refresh.rs` watch and push change notifications.

## Conventions & gotchas

- **Regenerate schema fixtures when API shapes change:** `just write-app-server-schema` (and `--experimental` when experimental fixtures are affected). Validate with **`just test -p codex-app-server-protocol`**. Dump current schema for clients via `codex app-server generate-ts` / `generate-json-schema`.
- **Keep Rust and TS renames aligned** — a `#[serde(rename=...)]` needs a matching `#[ts(rename=...)]`; discriminated unions need both `#[serde(tag="type")]` and `#[ts(tag="type")]`.
- IDs are plain `String` at the boundary; timestamps are integer Unix seconds named `*_at`.
- `#![deny(clippy::print_stdout, clippy::print_stderr)]` is set crate-wide — stdout/stderr are the transport; never print. Use tracing (`RUST_LOG`, `LOG_FORMAT=json`).
- Don't add boilerplate tests that only assert experimental field markers — rely on schema generation/tests plus behavioral coverage (AGENTS.md).
- Test this crate with `just test -p codex-app-server`; be patient with Rust lock contention, don't kill by PID.
