# CLAUDE.md — tui

`cc-harness-tui`: the interactive **Ink** terminal console (`cc-harness-console` bin) for the cc-harness daemon.
Consumes the core's public `connectDaemon`/`DaemonClient` from `cc-harness`. Sibling of `harness/`; depends on
it via `file:../harness`. Parent context: `../CLAUDE.md` (CC-to-SDK) + repo root `../CLAUDE.md`.

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

- **`useDaemon.ts`** — poll loop + selection + submit stream + control ops (model/permission/compact/fork/proactive/stop/spawn) + idempotent teardown
- **`format.ts`** — pure, operator-grade stream-line formatter (text + tool-use markers)
- **`Pool.tsx`** — session-list panel (id, model, ctx%, status, selection highlight)
- **`Detail.tsx`** — right-side session detail + stream output
- **`Composer.tsx`** — text-input bar for submitting prompts
- **`StatusBar.tsx`** — bottom bar: daemon up/down, focus mode, status message, key hints
- **`ConfirmDialog.tsx`** — double-border modal for destructive ops (y/Y confirm, n/N/Esc cancel)
- **`App.tsx`** — master-detail composition + ink `useInput` key routing + confirm-gated stop
- **`cli.tsx`** — bin entry: parses `--socket`, renders `<App>`

## Conventions

- **NO Prettier** (dense hand-style). Match surrounding code — compact, multi-statement lines.
- **ESM `.js` specifiers** in imports (`from "./useDaemon.js"`); bare `"cc-harness"` for core imports.
- **Components tested keyless** via `ink-testing-library` (no API key needed).
- **ink `useInput` timing discipline:** `useInput` subscribes in a passive effect — tests **must `await` a
  tick (or use `waitFor`/`pressUntil`) BEFORE writing keys** so the subscription is live. This is the pattern
  that keeps the app and component tests deterministic.
