# CLAUDE.md — tui

`cc-harness-tui`: ships **two bins**:
- **`cc-harness-console`** (incr 2) — interactive Ink daemon console; consumes `connectDaemon`/`DaemonClient` from `cc-harness`.
- **`cc-harness-chat`** (incr 3) — in-process chat REPL; drives a live `openSession`/`Session` with rich tool rendering and inline permission dialogs.

Sibling of `harness/`; depends on it via `file:../harness`. Parent context: `../CLAUDE.md` (CC-to-SDK) + repo root `../CLAUDE.md`.

## Build-first rule (important)

`cc-harness` **must be built before** running `npm run typecheck` or any test in `tui/`:

```bash
cd ../harness && npm run build
```

tsc resolves `cc-harness` types via `harness/dist/index.d.ts` (gitignored), and `useDaemon` imports the
real `collect` value. **Rebuild after any core change** or you'll see phantom "Cannot find module" errors.

## Commands (run from `tui/`)

```bash
npm run typecheck           # tsc --noEmit — fast correctness gate; run after every change
npx vitest run              # full keyless suite (components + app + useDaemon unit tests)
npm run build               # tsc → dist/ (emits dist/cli.js)
npm run cli                 # tsx src/cli.tsx — launch the console
```

- **Live test** (`test/live/`) gated on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (gitignored). Run keyed:
  `set -a; . ../.env; set +a; npx vitest run test/live`. Skips cleanly without a key.

## Module map

### Daemon console (`cc-harness-console`)
- **`useDaemon.ts`** — poll loop + selection + submit stream + control ops (model/permission/compact/fork/proactive/stop/spawn) + idempotent teardown
- **`format.ts`** — pure, operator-grade stream-line formatter (text + tool-use markers)
- **`Pool.tsx`** — session-list panel (id, model, ctx%, status, selection highlight)
- **`Detail.tsx`** — right-side session detail + stream output
- **`Composer.tsx`** — text-input bar for submitting prompts
- **`StatusBar.tsx`** — bottom bar: daemon up/down, focus mode, status message, key hints
- **`ConfirmDialog.tsx`** — double-border modal for destructive ops (y/Y confirm, n/N/Esc cancel)
- **`App.tsx`** — master-detail composition + ink `useInput` key routing + confirm-gated stop
- **`cli.tsx`** — bin entry: parses `--socket`, renders `<App>`

### Chat REPL (`cc-harness-chat`)
- **`render.ts`** — pure rich tool-rendering formatter (generic + bespoke Edit/Write/Bash/Read); the chat REPL's superset of `format.ts`
- **`uiBroker.ts`** — a `PermissionBroker` (from `cc-harness`) whose `request()` is fulfilled by a late-bound React handler
- **`useChat.ts`** — owns the in-process `Session` (default mode) + transcript + submit stream + permission state + mode switch + idempotent teardown
- **`Transcript.tsx` / `PermissionDialog.tsx` / `ChatStatusBar.tsx`** — chat REPL panes
- **`ChatApp.tsx`** — chat composition (transcript + composer/dialog + status); `chat.tsx` — `cc-harness-chat` bin entry

## Conventions

- **NO Prettier** (dense hand-style). Match surrounding code — compact, multi-statement lines.
- **ESM `.js` specifiers** in imports (`from "./useDaemon.js"`); bare `"cc-harness"` for core imports.
- **Components tested keyless** via `ink-testing-library` (no API key needed).
- **ink `useInput` timing discipline:** `useInput` subscribes in a passive effect — tests **must `await` a
  tick (or use `waitFor`/`pressUntil`) BEFORE writing keys** so the subscription is live. This is the pattern
  that keeps the app and component tests deterministic.
