# Increment 6 — Slash commands (`cc-harness-chat`)

**Status:** approved design (brainstorm complete) · 2026-06-19
**Topic:** give the in-process chat REPL a real slash-command surface — `/model` `/compact` `/context`
`/clear` `/help` `/resume` — intercepted locally and dispatched to engine ops already built and verified.

## Product framing

`cc-harness` (the lib) is the **backend engine**; the program's north star is **interactive Claude Code
reproduction** (an interactive agent + daemon, not a headless service). This is **increment 6** of the
Phase-3 interactive track (after: 1 `top` · 2 console · 3 chat REPL · 4 daemon permissions · 5 live
streaming). It delivers runway items **B (slash commands)** + **C (model switch, folded into `/model`)**.

The dividend of the engine-first architecture: every command here drives a lever **already built and
live-verified** — `setModel`, `Session.compact`, `getContextUsage`/`summarizeUsage`, `listSessions`/
`resumeSession`. This increment is the *interactive surface* over them, not new engine capability.

## Goal

In `cc-harness-chat`, typing a `/command` runs it locally and shows the result in the transcript — switch
model, compact, inspect context, clear the screen, list commands, and resume a prior session — without the
command ever reaching the model.

## Probe-verified premises (A1 live-probe-first — the grounding that set the architecture)

**Probe 21** (`probes/probes/21-slash-command-routing.ts`, model `claude-sonnet-4-6`, streaming-input path)
established how the SDK treats a `/command` submitted as a prompt:

- **`supportedCommands()` returns 94 — but they are the local project's *skills/custom commands*** (`browse`,
  `codex`, `investigate`, `claude-md-setup`, …), not the built-in CC set. A few built-ins appear (`/compact`,
  `/context`, `/clear`, `/init`); `/model`, `/resume`, `/help`, `/cost`, `/status` do **not**.
- **The SDK has a command router, but it is split (all turns return `subtype=success`):**
  - **Executes headless:** `/compact` (`status` frame, "Not enough messages to compact."), `/context`
    (returns a formatted "## Context Usage … 18.5k / 200k (9%)" report), `/cost` (a cost report).
  - **Rejects "…isn't available in this environment.":** `/model`, `/help`, `/status`.
  - **Unknown → "Unknown command: /x".**

**Architectural consequence (decisive):** a consistent, deterministic command surface **cannot** lean on the
SDK's env-gated router — the commands we most want (`/model`, `/help`, `/resume`) are explicitly *not
available* as pass-through. So the REPL **intercepts slash commands locally** and dispatches to the engine
ops it controls (exactly how real Claude Code's REPL works — it never sends slash commands to the model).

## Locked decisions

- **Command set:** `/model` `/compact` `/context` `/clear` `/help` `/resume` (six).
- **Dispatch:** intercept-local; slash commands never reach the model. Unknown → a local "Unknown command"
  line (NOT passed through; project-skill pass-through deferred).
- **Session ownership:** `useChat` takes a **`makeSession(resume?) => ChatSession` factory** and owns the
  session in state, so `/resume` can swap it (dispose current → open resumed). (Today it takes a pre-built
  session.)
- **`/resume` display:** **marker + continue** — clear the display, show `↻ resumed "<summary>" (<id8>)`,
  continue live (SDK context IS resumed; no `getSessionMessages` replay).
- **`/clear`:** clears the on-screen scrollback **only** — the session's context is unchanged (a long-lived
  `query()` can't be context-reset without a new session; matching CC's context-reset is deferred).
- **Engine signatures (confirmed, all `cc-harness` public exports):**
  - `listSessions(opts?) => Promise<SDKSessionInfo[]>` (`{sessionId, summary, firstPrompt, gitBranch, cwd, tag, createdAt, lastModified}`).
  - `resumeSession(id, config) => Session` (= `openSession({...config, resume:id})`).
  - `CompactOutcome = { ok, result?, error?, preTokens?, postTokens? }` (from `Session.compact()`).
  - `summarizeUsage(raw) => { percentUsed, tokensUsed, maxTokens, tokensRemaining, status }`.
  - `ChatSession` gains `setModel(model?)` and `compact()` (the real `Session` already provides both).

## Architecture

A pure parser/formatter module + `useChat` orchestration + one new modal. Slash commands are caught in
`useChat.submit` before any `session.submit`.

```
Composer → useChat.submit(input)
   │ parseCommand(input)
   ├─ null → session.submit(...)        (normal turn, unchanged)
   └─ {name,args} → dispatch:
        /model    → session.setModel(args) + setModel state + append formatModel
        /compact  → await session.compact() → append formatCompact(outcome)
        /context  → await session.getContextUsage() → summarizeUsage → append formatContext
        /clear    → setLines([])                       (display only)
        /help     → append formatHelp(COMMANDS)
        /resume   → openPicker()  → SessionPicker (listSessions) → pickSession({id,summary})
                       → setSession(makeSession(id)); setLines([formatResumed]); (effect disposes old, wires new)
        unknown   → append formatUnknown(name)         (NOT sent to model)
```

`commands.ts` is pure (parse + table + formatters → `RenderLine[]`); `useChat` does the async engine calls
and owns session-swap + picker state; `SessionPicker.tsx` is the `/resume` modal.

## Components

### `tui/src/commands.ts` (create — pure, no React/SDK side effects)
```ts
export interface ParsedCommand { name: string; args: string }
export function parseCommand(input: string): ParsedCommand | null;     // leading "/" → {name,args}; else null
export const COMMANDS: { name: string; summary: string }[];            // the 6, drives /help + validity
export function formatHelp(): RenderLine[];
export function formatCompact(o: CompactOutcome): RenderLine[];         // "✦ compacted 31k → 6k" / "nothing to compact"
export function formatContext(s: ContextUsageSummary): RenderLine[];    // "ctx 9% · 18.5k / 200k · ok"
export function formatModel(next?: string, current?: string): RenderLine[];  // set vs show-current
export function formatResumed(summary: string, id: string): RenderLine[];    // "↻ resumed "…" (id8)"
export function formatUnknown(name: string): RenderLine[];             // "Unknown command: /x · try /help"
```
`CompactOutcome`/`ContextUsageSummary` are imported as types from `"cc-harness"`. Token formatting (e.g.
`31k`) is a small local helper.

### `tui/src/SessionPicker.tsx` (create — the `/resume` modal)
Props `{ sessions: SDKSessionInfo[]; onPick(info): void; onCancel(): void }`. Renders a bordered, selectable
list (summary/firstPrompt + short id + lastModified); `↑/↓` move, `Enter` picks, `Esc` cancels; "no sessions"
when empty. A pure presentational component driven by an index in its own `useState` + `useInput`.

### `tui/src/useChat.ts` (modify)
- **Signature change:** `useChat(makeSession, ui, opts)` where `makeSession: (resume?: string) => ChatSession`.
  Session lives in state: `const [session, setSession] = useState(() => makeSession())`. The existing
  session-keyed effect (set broker handler; cleanup: dispose + clear handler) now keys on the state session,
  so swapping disposes-old/adopts-new for free.
- **`submit`** gains a guard at the top: `const cmd = parseCommand(prompt); if (cmd) return handleCommand(cmd);`
  before the existing turn logic. Commands are gated behind `!busy` like submit.
- **`handleCommand(cmd)`** switches on `cmd.name`, awaits the engine op, appends formatted lines; failures →
  a red `✗ <message>` line (never throws into React); all `setState` disposed-guarded.
- **Picker state:** `picker: { open: boolean; sessions: SDKSessionInfo[] }`; `openPicker()` (loads
  `listSessions` via an injected dep), `pickSession(info)` (→ swap + marker + close), `closePicker()`.
- **`ChatSession` interface** gains `setModel(model?: string): Promise<void>` and `compact(): Promise<CompactOutcome>`.
- **`deps`** (DI, default real): `{ listSessions: (opts?) => Promise<SDKSessionInfo[]> }` so tests run offline.
- `ChatState` gains `picker`.

### `tui/src/ChatApp.tsx` (modify)
Render `<SessionPicker>` when `state.picker.open` (gated like the permission dialog — its own input owns the
keyboard); the global `useInput` (Esc/Tab) is inactive while the picker or a permission dialog is up. No other
behavior change.

### `tui/src/chat.tsx` (modify)
Build a factory instead of a session: `const makeSession = (resume?: string) => openSession({ ...base, ...(resume ? { resume } : {}) })` and pass `makeSession` to `<ChatApp>`.

## Error handling
- Failed engine op (`setModel`/`compact`/`getContextUsage`/`listSessions` rejects) → red `✗ <message>` line;
  REPL stays live.
- `/resume` while busy → disallowed (same `!busy` gate); picker `Esc` cancels with no swap; empty list shows
  "no sessions".
- **Session swap is teardown-safe:** the old session disposes through the same disposed-guarded effect; a
  parked permission promise denies on swap (the `uiBroker` handler stays bound to the hook, re-wired to the
  new session by the effect).
- Unknown/empty command → local line; never submitted to the model.

## Testing
- **`commands.test.ts` (keyless):** `parseCommand` (`/model x`→`{model, x}`; `/help`→`{help, ""}`; `hi`→null;
  bare `/`→null); each formatter's output; `formatHelp` lists every `COMMANDS` entry.
- **`useChat.test.tsx` (keyless, fake session + fake `listSessions` dep):** `/model x` → `setModel("x")` called
  + status model updates; `/compact` → appends the formatted outcome; `/context` → appends the digest; `/clear`
  → lines emptied; `/help` → lists commands; `/resume` → opens picker, and a pick **swaps the session (old
  disposed exactly once, marker shown)**; unknown `/x` → local line, `submit`/`session.submit` NOT called.
- **`SessionPicker` component test (keyless):** ink-testing-library with the **`useInput` passive-effect timing
  discipline** (await a render tick before keys); `↓`+`Enter` fires `onPick` with the right session; `Esc`
  fires `onCancel`; empty list renders "no sessions".
- **One gated live test** (`tui/test/live/`, `ANTHROPIC_API_KEY`): a real `openSession` — submit one real turn,
  then run `/context` and assert the appended digest reports non-zero tokens and a percent (proves the full
  command path: dispatch → `getContextUsage()` → `summarizeUsage()` → `formatContext` → transcript). `/context`
  is chosen over `/compact` because it's deterministic (a short session yields "not enough messages to
  compact"). `try/finally` teardown.

## Out of scope (explicit)
- Passing unknown slash commands through to the SDK so project **skill-commands** (`/codex`, `/investigate` —
  the 94 in `supportedCommands()`) run — a deliberate power feature, deferred.
- `/resume` transcript **replay** via `getSessionMessages` (marker+continue only).
- Context-resetting `/clear`; `/cost` (cosmetic); multiline input, `@`-mentions, history (runway E); rich
  live-region tool diffs (runway D).
- Exposing all six permission modes via a `/mode` command — the Tab cycle (default↔bypass) stays as-is.

## Global constraints (verbatim)
- **NO Prettier — dense hand-style;** match surrounding compact lines.
- **ESM `.js` import specifiers** in `tui/` (`from "./commands.js"`); bare `"cc-harness"` for engine imports.
- **ink `useInput` passive-effect timing discipline** in component/app tests; **never** raw `stdin.on`; **never**
  mutate shared components.
- Keep modules small/focused: `commands.ts` (pure) + `SessionPicker.tsx` (presentational) exist precisely to
  keep `useChat.ts`/`ChatApp.tsx` lean.
- No new `cc-harness` public exports (all work in `tui/`, consuming existing exports) → no API-STABILITY /
  index.test pin, no harness rebuild.
- Live tests gate on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (never committed/printed); keyless suites skip
  cleanly.
- `tui/` build-first rule applies for typecheck, but this increment needs no harness rebuild (no engine change).
