# CLAUDE.md — harness

The harness: a TypeScript library/service wrapping the Claude Agent SDK, published as the npm
package **`cc-harness`** and shipping the **`ccx`** binary (foreground interactive REPL by default,
`-p`/`--bg` for headless/detached runs, `ccx attach`). Parent context is `../CLAUDE.md` (CC-to-SDK) +
the repo root. See `../docs/parity/coverage.md` for what each surface implements.

## Commands (run from `harness/`)

```bash
npm run typecheck                       # tsc --noEmit — the fast correctness gate (run after every change)
npm run test:unit                       # vitest run test/unit — DI-based, no API key, fast (preferred)
npm run test:tui                        # vitest run test/tui — the Ink chat REPL, keyless (ink-testing-library)
npx vitest run test/unit/<file> -t "x"  # one file / filter to one test
npm run test:resize-matrix              # the QA-2 width matrix (Wave R A12) — builds, drives ccx under tmux; skips cleanly with no tmux
                                        # CI runs it on node 22 with RESIZE_MATRIX_REQUIRE_TMUX=1, which turns that skip into a failure
npm run build                           # tsc -p tsconfig.build.json → dist/ (proves public .d.ts resolve)
npm run cli                             # tsx src/cli.ts
```

- **Live tests are gated** on `ANTHROPIC_API_KEY` **or** `CLAUDE_CODE_OAUTH_TOKEN` (`const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip`) — there is **no dotenv autoload**, so they skip cleanly without either. Run them keyed from here: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`. The OAuth token (from `claude setup-token`) bills your **Pro/Max subscription** instead of metered API credits — but `ANTHROPIC_API_KEY` shadows it if both are set, so keep the API-key line commented in `.env` (probe 28 verified `accountInfo()` reports `{tokenSource:"CLAUDE_CODE_OAUTH_TOKEN", apiProvider:"firstParty"}` with no key present). Live tests cost tokens/quota and take ~10–90 s each; the controller runs them, implementers stop at the clean keyless skip.
- After a subagent edit you may see phantom **"Cannot find module" / "property does not exist"** LSP diagnostics — they are stale; trust a clean `npm run typecheck` + green vitest over them.
- `test/contract/` shells out to a real **`python3`** (it pipes our output through doperpowers' actual filter) — the default `npm test` picks it up, so a machine without `python3` on PATH fails there rather than skipping.
- **`test/tui/` renders real Ink components via `ink-testing-library`** (no API key needed). `useInput` subscribes in a passive effect, so a test **must `await` a tick (or use `waitFor`/`pressUntil`) BEFORE writing keys** — writing keys immediately after render races the subscription and drops them. This discipline is what keeps the chat REPL's app/component tests deterministic.

## `src/` module map

- **`index.ts`** — the curated **public API** barrel. Add exports here deliberately; `test/unit/index.test.ts` pins the surface.
- **`config/`** — `resolveOptions(config)` builds the SDK `Options`. **The single seam most features wire through** (`createHarness` + lib `Session` both call it). NB: as of Increment A the **daemon also routes through it** (`daemon/supervisor.ts` `makeSession`), overlaying a per-session `sessionOptions` factory and the daemon permission broker (`canUseTool`).
- **`harness.ts`** — `createHarness` / `resumeHarness`: one-shot `run`/`stream` (single `query()` turn).
- **`session/`** — lib interactive multi-turn `Session` (`openSession`/`resumeSession`, `.sessionId` capture, compact/control/rewind). `session/chatSession.ts` is the REPL-facing contract (`ChatSession` + the optional `DecisionFeed`/`BgTasks`/`SessionEvents`/`RewindOps` mixins) that both the lib `Session` and the remote adapter satisfy structurally. `sessions/` — read API (`listSessions`/`getSessionMessages`) + `forkSession` + `rows.ts` (content-shape classifier of persisted transcript rows — `rowKind`/`rewindAnchorsFrom`/`lastAssistantText`; shared by the rewind picker and transcript replay so they can't drift).
- **`daemon/`** — long-lived multi-session service: `supervisor` (pool + restart) + UDS `server` + `registry` (`DaemonSession extends Session`).
- **`cli/`** — the `ccx` bin: `main.ts`/`args.ts` (grammar + dispatch), `attach.ts` (resolve a fleet target to a live socket + build the disk-transcript replay lines for `ccx attach`), `spawn.ts`/`worktree.ts`/`lifecycle.ts`/`agents.ts` (fleet ops), `bin.ts` (entry).
- **`client/`** — `chatAdapter.ts` (`remoteChatSession`: a lazily-connecting `ChatSession & DecisionFeed & BgTasks & SessionEvents` over `remote.ts`'s `RemoteChatSession`; the REPL's only session type, used by both the in-process loopback host and `ccx attach`) + `remote.ts`.
- **`tui/`** — the Ink chat REPL, dynamic-imported so headless paths (`-p`, `--bg`) never load React: `chatMain.tsx` is the import target (`runChatClient`), `useChat.ts` is event-driven over a `ChatSession & DecisionFeed & BgTasks & SessionEvents & RewindOps` (turn/message/decision/tasks_changed/state all arrive off the host event stream; `submit`/`answerDecision` are command channels only), plus the rendering/editing components (`ChatApp.tsx`, `Transcript.tsx`, `ChatComposer.tsx`, `ChatStatusBar.tsx`, `PermissionDialog.tsx`, `QuestionDialog.tsx`, `PlanDialog.tsx`, `BgTasksPanel.tsx`, `SessionPicker.tsx`, `ModelPicker.tsx`, `TaskPanel.tsx`, `RewindPicker.tsx` — the Esc-Esc rewind picker, C5 — and `ShortcutsOverlay.tsx` — the `?` keymap help, C5) and pure helpers (`render.ts`, `replay.ts`, `commands.ts`, `commandComplete.ts`, `editor.ts`, `fileComplete.ts`, `liveTurn.ts`, `markdown.ts`, `thinkLevels.ts`, `usageFormat.ts` — `/usage`/status-bar plan-usage formatters, C5 — `highlight.ts` — zero-dep regex syntax highlighter for fenced code, C5 — and `copy.ts` — clipboard DI for `/copy`, C5).
- **`swarm/`** (coordinator + bus + teammates) · **`tasks/`** (durable Task MCP server) · **`context/`** (`cc-context` tool) · **`compaction/`** (`cc-compact` tool) · **`proactive/`** (heartbeat) · **`kairos/`** (assistant persona) · **`bridge/`** (control protocol) · **`hooks/`** (programmatic SDK hooks — builders + `mergeHooks`).

## Conventions

- **Dense hand-style, NO Prettier.** Match the surrounding code (compact, multi-statement lines where the file already does so) — do not reformat.
- **ESM:** import specifiers **end in `.js`** (`from "./types.js"`) even though sources are `.ts`.
- **DI-by-deps:** inject SDK functions (e.g. a fake `QueryFn`) so unit tests run without the network; live tests exercise the real SDK. Mirror the existing `deps = { ... }` default-param pattern.
- **TDD:** failing test → red → minimal impl → green → `typecheck`. New public exports + behavior get a test.
- Keep modules small and focused; prefer a new module over growing a hot file.
