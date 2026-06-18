# Interactive Daemon Console (`cc-harness-console`) — Design

> **Phase 3, increment 2 of 3.** Increment 1 shipped `cc-harness top` — a read-only daemon dashboard. This
> increment makes the daemon **interactive**: navigate the live session pool, **inject prompts** (the daemon
> `submit` op streams the turn back), and drive **control ops** (interrupt / setModel / setPermissionMode /
> compact / spawn / stop / fork / proactive). It is the operator console. Increment 3 (the polished
> Claude-Code-style chat REPL — rich tool rendering, permission dialogs, pickers) remains a later spec; the
> **permission-prompt architecture fork is deferred to it** (this increment injects prompts under the
> session's existing permission mode).

## §1 — Goal

A new terminal command `cc-harness-console` (package `cc-harness-tui`) that attaches to a running daemon and
presents a **master-detail** UI: a left pool list (auto-refreshed) and a right detail pane that shows the
selected session's recent transcript + a live **operator-grade** streaming pane, with a chat composer to
inject prompts and keybindings to drive control ops (destructive ones gated by a confirm dialog). Built on
**Ink** in a **separate package** so the lean `cc-harness` core stays free of react/ink; the core gains a
small, deliberate **public `DaemonClient`** so a separate package can consume the daemon wire without
duplicating the protocol.

## §2 — Grounding (verified against source, 2026-06-18)

- **The daemon is fully drivable over its UDS op protocol** — read-only was an increment-1 *choice*. Verified
  ops (`src/daemon/server.ts`, `types.ts`):
  - `submit` → streams `{ type:"chunk", message }` lines then `{ type:"done", result }` (`server.ts:87`).
  - `control` frames `interrupt` / `set_model` / `set_permission_mode` / `set_thinking` / `context_usage` /
    `account_info`, and **`initialize` → `{ ok:true, models, commands, mcpServers }`** (the session's
    `capabilities()`, `src/bridge/control.ts:9`) — this is how the console gets the model list for the
    setModel cycle.
  - `compact` → `CompactOutcome`; `spawn({model?,restart?,resume?})` → id; `stop(id)`; `fork(id)` →
    `{id,sessionId}`; `start_proactive`/`stop_proactive`; `list` → `ListEntry[]` (pool + proactive, from
    increment 1); `usage`/`init`.
  - Each op is **one request per connection**; `submit`'s chunk stream arrives over that one connection via
    `daemonRequest`'s `onLine` callback before `{done}`.
- **`daemonRequest(socketPath, op, onLine?)` and `daemonSocketPath` are ALREADY public** (`src/index.ts:12`).
  So the data-layer expansion is modest: a typed client over an already-exposed wire.
- **Increment 1's data layer** (`src/monitor/snapshot.ts` `collect` + `MonitorClient`, `src/monitor/client.ts`
  `daemonMonitorClient`) is currently **CLI-internal**. It is renderer-agnostic and computes ctx% +
  aggregates proactive — reusable as-is by promoting it.
- **The public surface is pinned** by `test/unit/index.test.ts` (`import * as api`, per-export assertions, and
  a "does NOT export internal plumbing" guard). Adding exports requires adding assertions there.
- **Ink** (react + ink) is the standard declarative TUI lib; **`ink-testing-library`** provides `render()` →
  `lastFrame()` + `stdin.write()` for keyless component tests. Node `>=18` (matches the core).

## §3 — Scope

**In:** (1) a deliberate, bounded **public-API expansion** of `cc-harness` — a typed `DaemonClient`
(`connectDaemon`) + the promoted `collect`/snapshot types; (2) a new **`CC-to-SDK/tui/`** package
(`cc-harness-tui`) with an Ink master-detail console, bin `cc-harness-console`; (3) tests at both layers + one
gated live e2e.

**Out (non-goals → increment 3, the chat REPL):**
1. **Rich tool-result rendering** (diffs, full tool outputs) — increment 2 shows text + `⚙ Tool(arg)` markers.
2. **Inline permission dialogs** (`canUseTool` prompts) — the deferred architecture fork; the console injects
   under the session's existing permission mode.
3. **Pickers / slash-commands / vim keybindings / output-style picker** — increment 2's setModel/setPermissionMode
   are minimal inline cycles, not rich pickers.
4. **Replacing `cc-harness top`** — the lightweight read-only dashboard stays in core and coexists.
5. **Persisted session-store mutation in the UI** (rename/tag/delete) — not pool-focused; deferred.
6. **Enabling fork-wide GitHub Actions** — out of band (Actions is disabled on the fork; the new package's CI
   is moot until that changes).

## §4 — Design

### 4.A — Packages

```
CC-to-SDK/harness/   cc-harness        (lean core; gains the public DaemonClient — NO ink)
CC-to-SDK/tui/       cc-harness-tui     (NEW: react + ink + ink-testing-library; depends on cc-harness)
                                        bin: cc-harness-console
```

`cc-harness top` (in core) is untouched and coexists — the zero-dep read-only glance vs the heavier
interactive console.

### 4.B — Core change: public `DaemonClient` (extends increment 1's adapter)

Promote the data layer to a clean, **Ink-free** public API, reusing the existing wire:

```ts
// the read subset collect() already consumes (increment 1):
interface MonitorClient { list(): Promise<ListEntry[]>; contextUsage(id: string): Promise<unknown>; }

// the full operator client = read subset + drive ops:
interface DaemonClient extends MonitorClient {
  submit(id: string, prompt: string, onChunk: (m: unknown) => void): Promise<{ result: unknown }>;
  control(id: string, frame: ControlFrame): Promise<ControlResponse>;   // interrupt/set_model/set_permission_mode/set_thinking/initialize/...
  compact(id: string): Promise<CompactOutcome>;
  spawn(opts?: { model?: string; restart?: "no"|"on-failure"; resume?: string }): Promise<string>;
  stop(id: string): Promise<void>;
  fork(id: string): Promise<{ id: string; sessionId?: string }>;
  startProactive(id: string, config?: ProactiveConfigInput): Promise<ProactiveStatus>;
  stopProactive(id: string): Promise<void>;
}
function connectDaemon(socketPath: string): DaemonClient;   // thin typed wrapper over daemonRequest (no protocol dup)
```

Each method wraps `daemonRequest` with the matching op and throws on `{ ok:false }` (callers handle). `submit`
forwards chunk lines to `onChunk` and resolves with the `{done}` result. Increment 1's `daemonMonitorClient`
becomes the read subset of this (or is re-expressed via it); `collect(client, opts)` is unchanged and accepts
the `MonitorClient` subset.

**Public-API expansion** (`src/index.ts` + `test/unit/index.test.ts` pin updated; API-STABILITY.md tier =
**advanced-seam**): add `connectDaemon`, `collect`, and types `DaemonClient`, `MonitorClient`,
`DashboardSnapshot`, `SessionRow`, `ListEntry`, plus re-export `ControlFrame`/`ControlResponse` (already
defined in `bridge/types.ts`). This is the only core code change beyond the small refactor; `cc-harness top`
re-points to the public client (or is left as-is — its internal import still resolves).

### 4.C — The Ink console (`cc-harness-tui`)

Master-detail, modal focus. A `useDaemon(socketPath)` hook owns: an interval poll of `collect` for the pool,
the selection index, the active `submit` stream (accumulating chunks into a transcript), and the focus mode
(`list` | `input`). Components:
- **`<Pool>`** — left list of `SessionRow`s (id, status glyph, model, ctx%); highlights the selection.
- **`<Detail>`** — right pane: recent-turn scrollback + the live streaming pane (operator-grade: assistant
  text + `⚙ ToolName(arg)` markers derived from tool_use blocks; no diffs/results).
- **`<Composer>`** — chat input (Ink `<TextInput>`), visible/focused in `input` mode.
- **`<StatusBar>`** — daemon state + context-sensitive keybindings.
- **`<ConfirmDialog>`** — yes/no overlay for destructive ops.

Focus/keys: `j/k`/arrows select (list mode) · `Enter` → focus composer (submit on return → stream into
`<Detail>`) · `Esc` → back to list · `q`/Ctrl-C → quit. List-mode keys — on the **selected session**:
`i` interrupt · `m` setModel (inline cycle over `control:initialize`'s `models`) · `p` setPermissionMode
(cycle the 6 modes) · `/` compact · `f` fork · `P` toggle proactive · `x` **stop → `<ConfirmDialog>`**;
**pool-level** (not on the selection): `n` spawn (new session, daemon-default model).

### 4.D — Control ops + confirm-before-mutate

Benign ops (`interrupt`, `setModel`, `setPermissionMode`, `compact`, `fork`, proactive toggle, `spawn`) fire
immediately and surface their `ControlResponse`/outcome in the status bar. **Destructive** ops (`stop`) route
through `<ConfirmDialog>` (explicit y/n) before calling the client. A failed op (`{ok:false}`) shows its error
in the status bar; it never crashes the app.

### 4.E — Error handling & teardown (the recurring discipline)

- **Daemon down** → `collect` returns `daemonUp:false` (increment 1 behavior) → a waiting state; the poll
  keeps retrying and recovers when the daemon appears.
- **A `submit` stream that errors** → shown inline in `<Detail>`; the app stays alive.
- **Teardown** — on quit/Ctrl-C/unmount: stop the poll interval, abort any in-flight `submit` connection,
  restore the terminal, and `useApp().exit()` exactly once (idempotent). This is the **teardown-liveness** bug
  class carried over from increment 1 — designed in, with a test.

## §5 — Verification

GitHub Actions is disabled fork-wide, so correctness rests on local layers:
1. **Core `DaemonClient`:** unit (DI fake) + a **keyless real-UDS integration** test — stand up a real
   `DaemonServer` with a DI-faked supervisor, `connectDaemon` at the socket, exercise `submit` (assert chunks
   stream + `{done}` result) and `control` (assert round-trip), like increment 1's integration pattern.
2. **Updated index pin:** `test/unit/index.test.ts` asserts the new exports present and internals still hidden;
   `verify:pack` confirms the package still imports.
3. **tui components (`ink-testing-library`, keyless):** render each component with a fake `DaemonClient`;
   assert `lastFrame()`; simulate keypresses (`stdin.write`) → assert focus/mode transitions, the confirm-dialog
   gate on `stop`, and stream accumulation in `<Detail>`.
4. **One gated live e2e** (`ANTHROPIC_API_KEY`): drive a real daemon session through `connectDaemon` (spawn →
   submit → assert streamed text → interrupt/stop). Skips cleanly keyless.

## §6 — Testing summary

- **Core:** `test/unit/daemon-client.test.ts` (DI + real-UDS integration for submit-stream + control),
  updated `test/unit/index.test.ts`. The increment-1 monitor tests stay green (data layer behavior unchanged).
- **tui:** `tui/test/*.test.tsx` per component (`<Pool>`/`<Detail>`/`<Composer>`/`useDaemon`/confirm-gate/
  teardown) via `ink-testing-library`; `tui/test/live/console.e2e.test.ts` (gated).
- New dev deps live in the **tui** package only (`ink`, `react`, `ink-testing-library`, `ink-text-input`,
  `@types/react`); core deps unchanged.

## §7 — Non-goals (restated)

Per §3: no rich tool-result/diff rendering, no inline permission dialogs (the deferred fork), no
pickers/slash-commands/vim keybindings, no replacing `cc-harness top`, no persisted-store mutation in the UI,
no Actions-enablement. The permission-prompt architecture (daemon-attached `canUseTool` wire round-trip vs
in-process lib-`Session`) is decided in **increment 3's** spec.
