# Increment B — Chat REPL UX Fidelity (design)

**Status:** approved (user, 2026-06-20) — ready for writing-plans.
**Goal:** Close the three chat-REPL UX gaps the 2026-06-20 audit found against real Claude Code, all in
`cc-harness-chat`: markdown rendering (#11), an immediate "thinking…" indicator (#10), and a `/model`
picker (#8). Entirely `tui/` — **no harness change**.

## Context — what the audit + probes established

- **#11 markdown:** `render.ts:48` (scrollback) and `liveTurn.ts:126` (live) both do `String(text).split("\n")`
  → assistant text renders as **raw plaintext** (markdown syntax visible literally). CC uses
  `marked`+`cli-highlight`+`chalk`. We keep the tui's **pure-data `RenderLine` model** instead.
- **#10 thinking indicator:** `useChat.submit` sets `setStreaming([])` + `setBusy(true)` before the turn; the
  transcript stays **empty between submit and the first streamed frame**. Only the status bar shows
  `⟳ streaming`. `liveTurn` already renders thinking *once it streams*; the gap is purely the pre-first-frame
  window. (Under the Increment-A `xhigh` default, thinking streams readily — but the latency gap and
  non-thinking turns still need a placeholder.)
- **#8 /model picker:** today `/model <name>` is **blind free-text** (`useChat.ts:94`). **Probe 27
  (committed `08bd1129b1`) flipped the premise:** `supportedModels()` from the chat lib `Session` path
  returns a **rich, non-empty list headlessly** — 6 models (`default`, `opus[1m]`, `sonnet`, `sonnet[1m]`,
  `haiku`, `claude-opus-4-8`), each with `displayName`, `description`, `supportsEffort`,
  `supportedEffortLevels`, `supportsAutoMode`. (This contradicts the dashboard `m`-bug *static trace* that
  said "empty headless" — that was inference, not a live run; the live run proves the list is reachable.
  This is a note for Increment C, not this increment.) `Session.capabilities()` (`session/session.ts:127`,
  public) returns `{models, commands, mcpServers}` and is reachable from the `openSession` object.
  `SessionPicker.tsx` is the existing modal template.

## Decisions (locked by user)

| Axis | Decision |
|---|---|
| Markdown implementation | Lightweight pure inline parser (`tui/src/markdown.ts`), no deps, stays in the `RenderLine` model |
| Thinking indicator | Animated spinner + elapsed seconds, one `setInterval` active only during the gap |
| `/model` source | Live `supportedModels()` via `session.capabilities()` (probe 27) |
| Scope | All three findings in one increment; entirely `tui/`, no harness change |
| Picker scope | Model-only (effort/thinking stays with `/think`, increment 11); free-text `/model <name>` preserved |
| Markdown on thinking | Thinking blocks stay dim/plain — NOT markdown-parsed (reasoning, not formatted output) |

## Architecture

Three independent components, one shared render-model extension.

### Shared: extend `RenderLine`

`render.ts` `RenderLine` gains two optional fields:
```ts
export interface RenderLine { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; }
```
`Transcript.tsx`'s `<Line>` honors them: `<Text color={l.color} dimColor={l.dim} bold={l.bold} italic={l.italic}>`.
Additive and backward-compatible — every existing `RenderLine` producer is unaffected.

### Component 1 — `tui/src/markdown.ts` (markdown #11)

A pure module, no React/SDK/deps:
```ts
export function renderMarkdown(text: string): RenderLine[]
```
Maps a multi-line markdown string to styled `RenderLine[]`. Handled cases (the set assistant replies use):
- **Inline** (within a line): `**bold**`/`__bold__` → `bold`; `*italic*`/`_italic_` → `italic`;
  `` `code` `` → `color:"cyan"`. A line that is ENTIRELY one span (e.g. the whole line is `**…**`) takes
  that span's style; a line that MIXES styles has its markers stripped and renders as clean text with no
  per-span color (each `RenderLine` carries one style set). See **"Inline-span limitation" below** for the
  explicit, accepted boundary and how the tests pin it.
- **Block-level** (whole line): `# `/`## `/`### ` headers → `bold` (strip the `#`s); `- `/`* `/`+ ` bullets
  → `• ` prefix; `1. ` numbered → keep the number; `> ` blockquote → dim, `│ ` prefix; fenced ```` ``` ````
  code fences → the lines between fences render `dim` and indented (`  `), the fence lines themselves are
  dropped.
- **Plain text** (no markdown syntax) → one `RenderLine` per line, unchanged (fast path).

**Inline-span limitation (explicit, accepted):** because `RenderLine` carries ONE set of style flags per
line, a line that mixes styles (e.g. `**bold** and normal`) cannot render each span differently within the
single line. The parser's contract for a mixed-style line is: **strip the markdown markers** so no literal
`**`/`` ` ``/`_` is shown, and apply the style of a span only when it covers the whole line (e.g. a line
that is entirely `**…**` → `bold`; a line that is entirely `` `…` `` → cyan). Partial-line spans render as
clean text with markers removed but no per-span color. This is the YAGNI boundary of the lightweight
parser; full per-span styling (CC's `<Ansi>` approach) is explicitly out of scope. The unit tests assert
exactly this contract (markers stripped, whole-line styles applied) so the limitation is pinned, not
accidental.

Wiring: `render.ts:48` (assistant text block) and `liveTurn.ts:126` (the `text` branch of `renderBlock`)
replace their `String(text).split("\n").map(...)` with `renderMarkdown(text)`. **Thinking blocks are NOT
routed through it** — `render.ts:49` and `liveTurn.ts:128-129` keep emitting dim plain lines. User-echo
lines (`› …`) and tool/diff lines are unchanged.

### Component 2 — `tui/src/ThinkingIndicator.tsx` (#10)

A small Ink component rendered in `ChatApp` when `state.busy && state.streaming.length === 0`:
```tsx
export function ThinkingIndicator({ startedAt, now }: { startedAt: number; now?: () => number })
```
- One `setInterval` (≈120 ms) drives a spinner frame index + recomputes elapsed seconds; the interval is
  created in a `useEffect` and **cleared on unmount** — and the component is only mounted during the gap
  window, so the timer exists only while waiting.
- Renders one line: `<spinner-frame> Thinking… <Ns>` (e.g. `✨ Thinking… 3s`), dim.
- `now` is injectable for deterministic tests (default `Date.now`); spinner frames are a fixed array cycled
  by `index % frames.length`.

`useChat` exposes the gap signal: it already has `busy`; add a `turnStartedAt` timestamp (set when a
non-command submit begins, read by the indicator). `ChatApp` mounts `<ThinkingIndicator>` conditionally so
the timer is born and torn down with the gap.

### Component 3 — `tui/src/ModelPicker.tsx` + `/model` picker (#8)

`<ModelPicker>` mirrors `SessionPicker.tsx` (↑/↓ · Enter · Esc), listing the live models:
```tsx
export interface ModelInfo { value: string; displayName?: string; description?: string }
export function ModelPicker({ models, onPick, onCancel }: { models: ModelInfo[]; onPick: (m: ModelInfo) => void; onCancel: () => void })
```
Each row shows `displayName` (fallback `value`) + dim `description`; `inverse` highlight on the cursor;
Enter → `onPick`, Esc → `onCancel`.

`useChat` integration (mirrors the existing `picker`/`SessionPicker` state machine used by `/resume`):
- Add a `modelPicker: { open: boolean; models: ModelInfo[] }` state (or extend the existing picker
  discriminant — implementer's call per the plan; the spec requires only that it not collide with the
  session picker).
- `/model` (no arg): `await session.capabilities()`, map `.models` to `ModelInfo[]`, open the picker. On
  pick: `await session.setModel(value)` + `setModel(value)` (status bar) + append a `formatModel(value)`
  line. On empty/throw: append a dim notice, no modal.
- `/model <name>` (with arg): **unchanged** — the existing free-text fast-path
  (`setModel(args)` + status update).
- `ChatApp` renders `<ModelPicker>` when its picker is open, with the same "dialog owns input" gating the
  `SessionPicker` already uses (Tab/Esc global keys inactive while a picker is up).

`ChatSession` interface (in `useChat.ts`) gains:
```ts
capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
```
The real `openSession` object already implements it (`session/session.ts:127`); the test `fakeSession`
gets a stub returning a small fixed model list. **No harness change** — this is an interface declaration
over an existing public method.

### Why this shape (isolation)

Three new focused modules (`markdown.ts`, `ThinkingIndicator.tsx`, `ModelPicker.tsx`), each one
responsibility, each independently testable. The only shared change is the additive `RenderLine` fields.
`useChat` gains a model-picker branch (parallel to its session-picker branch) and a `turnStartedAt`
timestamp — no restructure. `render.ts`/`liveTurn.ts` each change exactly one line (the text branch).

## Out of scope (explicit)

- Full CommonMark/GFM (tables, nested lists, per-span inline styling within a mixed line) — the lightweight
  parser's accepted boundary (see Inline-span limitation).
- Syntax highlighting of fenced code (CC's `cli-highlight`) — fences render dim/indented, not highlighted.
- Markdown on thinking blocks, user echoes, tool/diff lines.
- Effort/thinking selection in the model picker — `/think` (increment 11) owns that.
- The dashboard `m`-cycle bug (#6) and any console change — Increment C. (Probe 27's finding that
  `supportedModels()` IS reachable headless is recorded here for C's benefit but acted on only there.)
- Any harness/lib change.

## Global constraints

- TypeScript, **ESM** import specifiers end in `.js`; **dense no-Prettier** hand-style (match surrounding
  code; do not reformat untouched lines). Bare `"cc-harness"` for core imports.
- Entirely under `tui/src/` + `tui/test/`. Build `harness/` before `tui/` typecheck (per `tui/CLAUDE.md`).
- Components tested **keyless** via `ink-testing-library`; **`useInput` timing discipline** — await a
  tick / `waitFor` before writing keys so the subscription is live; use real escape sequences.
- Test files run **sequentially** (`vitest.config.ts` `fileParallelism:false`); never mutate the shared
  `Composer.tsx`.
- Live tests gate on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (never commit/print it); skip cleanly
  without a key. The controller runs the keyed pass; implementers stop at the clean keyless skip.
- After changes: `npm run typecheck` (exit 0) + `npx vitest run` (green) from `tui/`. Trust a clean
  typecheck + green vitest over phantom stale-cache LSP diagnostics.
- Git: commit completed work to `main`; **no `Co-Authored-By`**; no push without an explicit request.

## Testing strategy

- **Unit (keyless):**
  - `markdown.ts`: a table of cases — bold/italic/inline-code whole-line styles; `#`/`##` headers; `-`/`*`/`1.`
    lists → `•`/number; fenced block → dim+indented, fences dropped; blockquote → dim+`│`; plain passthrough;
    and the inline-span limitation (mixed-style line → markers stripped, no per-span color).
  - `ModelPicker`: renders `displayName`+`description`; ↑/↓ moves the cursor; Enter calls `onPick` with the
    selected `ModelInfo`; Esc calls `onCancel`. (await-tick before keys.)
  - `ThinkingIndicator`: with injected `now`, shows a frame + elapsed; asserts the line content; (the
    mount/unmount gap behavior is covered via `useChat`/`ChatApp` — it renders only when `busy && empty`).
  - `useChat`: `/model` no-arg calls `capabilities()` and opens the model picker; `/model <name>` keeps the
    free-text fast-path (`setModel` called with the arg, no picker); a picked model calls `setModel(value)`.
    The `fakeSession` gains a `capabilities()` stub.
  - `Transcript`/components: a `RenderLine` with `bold`/`italic` renders with those Ink props.
- **Gated live e2e** (`ANTHROPIC_API_KEY`, thin, skips keyless): open a session, `await
  session.capabilities()`, assert `models` is a non-empty array containing a known `value` (e.g.
  `claude-opus-4-8`), then `setModel` to a picked value and confirm a subsequent turn completes. One file.

## Probe grounding

- **Probe 27** (`probes/probes/27-supported-models-headless.ts`, committed `08bd1129b1`): `supportedModels()`
  returns a non-empty 6-model list headless with `displayName`/`description`/`supportsAutoMode`/effort levels;
  `supportedCommands()` returns 92 entries (skills — relevant to Increment D, not this one). Decides the
  picker uses the LIVE list, not a curated constant.
- No probe needed for #10/#11 — pure UI (no SDK premise); `liveTurn`/`useChat`/`render` behavior was read
  directly during the audit + this brainstorm.
