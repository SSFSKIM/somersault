<!-- Mirror file: codex-rs/tui/CLAUDE.md and codex-rs/tui/AGENTS.md are byte-identical — edit both together. Claude Code reads CLAUDE.md; Codex (and other AGENTS.md agents) read AGENTS.md. -->
# codex-tui — crate guide

Guidance for the `codex-tui` crate (the fullscreen Ratatui terminal UI). Read the repo-root `CLAUDE.md` and `AGENTS.md` first — AGENTS.md's "TUI style conventions", "TUI code conventions", and "Text wrapping" sections are authoritative and not repeated here. This file adds architecture and local gotchas.

## What this crate is

The interactive terminal client, built with [Ratatui](https://ratatui.rs/). It is **not** a direct consumer of `codex-core` — it is an **app-server client**. The event loop talks to a (in-process or spawned) `codex app-server` over the JSON-RPC `app-server-protocol`, the same protocol an IDE uses. Practically: TUI changes that touch the wire (new request/notification) are app-server v2 changes — coordinate with `app-server/` and `app-server-protocol/` and follow AGENTS.md's "App-server API" rules.

## Styling is governed — don't freelance colors

`styles.md` (in this dir) is the canonical color/emphasis guide: default fg, `dim` for secondary, `cyan` selection, `green` add, `red` error, `magenta` for Codex; avoid custom colors, `white`/`black`, `blue`/`yellow`. `clippy.toml` tries to catch violations. Use ratatui `Stylize` helpers (`"x".dim()`, `.bold()`, `.into()`) over manual `Style`/`Span::styled` — full conventions in AGENTS.md. For wrapping, use `wrapping.rs` / `line_truncation.rs` / `live_wrap.rs` / `transcript_reflow.rs` rather than hand-rolling.

## Architecture map

**Entry & loop.** `lib.rs::run_main` → `run_ratatui_app` → `App::run` (`app.rs`, the `select!` loop ~`app.rs:1106`). The loop multiplexes **terminal input events** against **`app_server.next_event()`** and drives everything via the `AppEvent` enum (`app_event.rs`), sent through `app_event_sender.rs`. Event handling is split across `app/` (e.g. `event_dispatch.rs`, `thread_events.rs`, `app_server_events.rs`, `session_lifecycle.rs`).

**The core boundary.** `app_server_session.rs` is the facade: it owns the typed JSON-RPC calls (`thread/start`, `turn/start`, approvals, config) via `codex-app-server-client`, keeping request/response plumbing out of `App`/`ChatWidget`. `AppServerTarget` selects in-process vs spawned server. Look here (not in `core`) for how the UI starts turns and receives streamed items.

**The chat surface — `chatwidget.rs` + `chatwidget/`.** The central widget that renders the conversation and orchestrates turn/tool/streaming lifecycle. Per AGENTS.md, keep `chatwidget.rs` itself focused on **orchestration**; behavior lives in the many small modules under `chatwidget/` (`turn_lifecycle.rs`, `tool_lifecycle.rs`, `streaming.rs`, `slash_dispatch.rs`, `permission_popups.rs`, `plugins.rs`, …). Add new behavior as a module there, not as a method on `chatwidget.rs`.

**The input area — `bottom_pane/`.** The composer + all overlays. `chat_composer.rs` (~11k LoC) and `textarea.rs` are the text-entry state machines; `mod.rs`, `footer.rs`, `approval_overlay.rs`, `list_selection_view.rs`, `request_user_input/`, `mcp_server_elicitation.rs`, etc. are the views. **This folder has its own `AGENTS.md`** — when you change the paste-burst or chat-composer state machines, keep the module docs and `docs/tui-chat-composer.md` in sync.

**Rendering the transcript.** `history_cell/` + `exec_cell/` (the cells that make up scrollback), `markdown_render.rs` / `markdown_stream.rs` (markdown), `diff_render.rs` (patches), `streaming/controller.rs` (incremental render of streamed output), `render/`, `insert_history.rs`, `pager_overlay.rs`.

**Input mapping & misc.** `keymap.rs` / `keymap_setup.rs` (key bindings), `onboarding/`, `resume_picker.rs` / `session_resume.rs`, `theme_picker.rs` / `color.rs` / `terminal_palette.rs`, `status/` + `status_indicator_widget.rs`, `notifications/`, `voice.rs` / `audio_device.rs` (realtime), `tui/` + `custom_terminal.rs` (terminal backend abstraction).

## Conventions & gotchas

- **Hot files to NOT grow** (AGENTS.md): `chatwidget.rs`, `bottom_pane/chat_composer.rs`, `bottom_pane/footer.rs`, `bottom_pane/mod.rs`, `app.rs`. They already attract unrelated changes — spread into new modules under `chatwidget/` or `bottom_pane/`.
- **UI changes require `insta` snapshot coverage** (AGENTS.md "Snapshot tests"). Add or update snapshots and accept them as part of the PR so UI diffs stay reviewable. Snapshots live in `*/snapshots/`; use `test_backend.rs` / `test_support.rs` for rendering tests.
- **Test:** `just test -p codex-tui`. Snapshot workflow: `cargo insta pending-snapshots -p codex-tui`, review the `.snap.new`, then `cargo insta accept -p codex-tui`. Install with `cargo install --locked cargo-insta` if missing. Be patient with Rust lock contention; don't kill by PID.
- Wire-protocol conversions between TUI and app-server types live in files like `app_server_approval_conversions.rs` and `permission_compat.rs` — reuse them rather than reinventing field mapping.
