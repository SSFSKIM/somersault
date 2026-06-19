# Chat Input Ergonomics (Increment 8) — Design

**Status:** approved (brainstorm) → ready for implementation plan
**Date:** 2026-06-19
**Feature:** runway **E** — multiline editing + prompt history + `@`-mention file completion for `cc-harness-chat`
**Product north star:** interactive Claude Code reproduction (the lib `cc-harness` = backend engine; the program = an interactive agent). This increment makes the chat REPL's *input* feel like real Claude Code.

## 1. Goal

Replace the chat REPL's single-line input with a real editor that supports, in one increment:

1. **Multiline editing** — compose/edit a multi-line prompt; `Enter` submits, `\`+`Enter` inserts a newline, multi-line paste inserts as-is.
2. **In-memory prompt history** — `Up`/`Down` recall previously submitted prompts (session-lifetime only), without fighting multiline cursor movement.
3. **`@`-mention file completion** — typing `@` opens a fuzzy file-completion popup (recursive, basic-ignored, capped); selecting inserts the **path string** (the agent uses its `Read` tool on demand — no file content injection).

All work is **client-side TUI** in `CC-to-SDK/tui/` (package `cc-harness-tui`, chat bin `cc-harness-chat`). **No `cc-harness` engine change, no new public exports** (the multi-line prompt is just a string the existing `Session.submit` already accepts).

## 2. Grounding (probe — already done, committed `17d7116b0e`)

`tui/probes/ink-paste-key-delivery.tsx` (run via `npx tsx`, using `ink-testing-library`) settled the load-bearing client-side question: **how Ink's `useInput` delivers a multi-byte write.** Findings that drive the editor:

- **A multi-char / multi-line write arrives as ONE `useInput` call** with the whole string as `input`, embedded `\n`/`\r` intact, and **`key.return` not set** (cases `"abc"`, `"a\nb"`, `"a\nb\nc"` each fired once). → **Paste = a single `input` string; insert literally, splitting on `\n`/`\r`.** No per-character accretion, no paste-mode detection.
- **Submit = `key.return`**, set only by a *lone* CR (`input="\r"`); a lone `\n` does **not** set it. Clean submit signal.
- **`\`-continuation is two separate interactive events** — `\` (`input="\\"`) then Enter (`key.return`) are distinct calls; so on Enter we check "does the current line end with `\`?" → strip it and insert a newline instead of submitting.
- **Ink does NOT strip bracketed-paste markers** (`\x1b[200~ … \x1b[201~` leaked into `input`). Real-world risk is low (Ink likely never enables `?2004h`, so real pastes look like the raw-text cases), but **the editor strips those markers defensively** before inserting — cheap insurance.
- Arrows arrive as `key.upArrow`/etc. with empty `input` — clean for history + cursor routing.

**No SDK probe needed:** `@` inserts a string, history is local, multiline is a buffer the Session accepts as any string. The `probes/` directory is outside the tsconfig scope (`include: ["src","test"]`), so the probe does not affect `npm run typecheck`.

## 3. Architecture (approach ①: pure reducer + injected impurity + thin view)

Mirrors the `liveTurn`/`taskList` pattern that produced two zero-fix-cycle increments: the editing model is a **pure, synchronous reducer**; the only side effect (the filesystem walk) is injected/owned by the component.

| File | Kind | Responsibility |
|---|---|---|
| `tui/src/editor.ts` (create) | **pure** — no React/Ink/fs | `EditorState` + `applyKey(state, input, key) → EditorResult` reducer (the whole editing model) + small pure helpers |
| `tui/src/fileComplete.ts` (create) | **pure + injected `readdir`** | `collectFiles(cwd, readdir)` recursive walk (basic ignores, capped) + `rankCandidates(files, query, cap)` fuzzy ranker |
| `tui/src/ChatComposer.tsx` (create) | **presentational** | thin `useInput` → reducer; renders the buffer with an inverse-char cursor + the `@`-popup; owns the walk side-effect |
| `tui/src/ChatApp.tsx` (modify) | — | accept a new `cwd` prop; swap `<Composer onSubmit={submit} />` → `<ChatComposer onSubmit={submit} cwd={cwd} />` |
| `tui/src/chat.tsx` (modify) | — | thread `cwd` into `<ChatApp>`: `<ChatApp … cwd={base.cwd} />` (it already computes `base.cwd = flag("--cwd") ?? process.cwd()`) |

**The shared console `<Composer>` (`Composer.tsx`, used by `App.tsx`) is NEVER touched** — the standing "never mutate shared components" rule. `ChatComposer` is a new chat-specific component; the console keeps its single-line input. `ink-text-input` stays a dependency of the console only; `ChatComposer` is a custom `useInput` editor.

## 4. The editor model (`editor.ts`)

### 4.1 State

```ts
export interface Cursor { row: number; col: number }
export interface Candidate { path: string; score: number }
export interface MentionState { anchor: Cursor; query: string; files: string[]; items: Candidate[]; index: number }
export interface EditorState {
  lines: string[];            // the buffer, split into lines (never empty: [""] when blank)
  cursor: Cursor;             // row in [0,lines.length), col in [0,lines[row].length]
  history: string[];          // submitted prompts, oldest→newest
  histIndex: number | null;   // null = editing the live draft; else an index into history
  stash: string | null;       // the live draft saved when history browsing starts (restored on Down past newest)
  mention: MentionState | null;
}
export interface EditorResult { state: EditorState; submit?: string }   // submit set only when a turn is sent
export function initialEditorState(history?: string[]): EditorState
export function applyKey(state: EditorState, input: string, key: KeyFlags): EditorResult
```

`KeyFlags` is a minimal structural subset of Ink's `Key` the reducer reads (`return`, `backspace`, `delete`, `leftArrow`, `rightArrow`, `upArrow`, `downArrow`, `escape`, `tab`) — so the reducer needs no Ink import.

### 4.2 Key routing (probe-grounded)

`applyKey` dispatches in this order:

1. **Submit / continuation / accept (`key.return`)**:
   - If the current line ends with `\` → replace the trailing `\` with a line break (continuation); cursor to start of the new line.
   - Else if `mention` is open → accept the highlighted candidate (replace the `@query` token from `mention.anchor` to the cursor with the candidate `path`, prefixed with `@`), close the mention.
   - Else → `submit = lines.join("\n")` **only if non-empty after trim**; push the submitted text to `history` (dedup consecutive duplicates), reset to a blank buffer (`histIndex`/`stash`/`mention` cleared). Whitespace-only → no submit, no reset side effects beyond what the existing `submit` guard already does.
2. **Backspace (`key.backspace` or `key.delete`)**: delete the char left of the cursor; at `col 0, row>0` join with the previous line (cursor to the join point). If the deletion removes the `@` anchor or crosses left of it, close the mention; else if mention open, shorten `query` and re-rank.
3. **Left/Right (`key.leftArrow`/`rightArrow`)**: move the cursor one column, wrapping to the previous/next line at line ends. If the cursor leaves the mention token, close the mention.
4. **Up/Down (`key.upArrow`/`key.downArrow`)**:
   - `mention` open → move `mention.index` within `items` (clamped).
   - Else if `Up` and `cursor.row === 0`, or `Down` and `cursor.row === lines.length-1` → **history recall**: on the first `Up` from the live draft, save the draft to `stash` and set `histIndex` to the newest entry; further `Up` steps older (clamped at oldest); `Down` steps newer; `Down` past the newest restores `stash` and sets `histIndex = null`. The recalled text replaces the whole buffer; cursor to end.
   - Else → move the cursor between lines (clamp col to the new line's length).
5. **Escape (`key.escape`)**: if `mention` open → close it (clear `mention`, leave the typed `@query` text in place). Otherwise a no-op in the reducer (ChatApp's global handler owns interrupt — see §6).
6. **Printable / paste (`input` non-empty, not a recognized control)**: `stripPasteMarkers(input)` (remove `\x1b[200~`, `\x1b[201~`, and leaked `[200~`/`[201~`); if the result is multi-char or contains `\n`/`\r`, split on `\n`/`\r` and insert as multiple lines at the cursor (cursor to the end of the inserted text); else insert the single char. After insertion: if the inserted text is exactly `@` at a word boundary (start of line, or preceded by whitespace) → open a `mention` (anchor at the `@`, empty query, kick the walk in the component — see §5); else if a mention is open, extend `query` with the typed text and re-rank.

`Tab` while a mention is open also accepts the highlighted candidate (same as Enter-accept); otherwise `Tab` is left to the global handler (mode cycle) — see §6.

### 4.3 Pure helpers (kept in `editor.ts`, small)

`stripPasteMarkers(s)`, `insertText(state, text)`, `splitForInsert(text)`, `deleteLeft(state)`, `acceptCandidate(state, path)`, `mentionTokenRange(state)`. Each is a small pure function the reducer composes; this keeps `applyKey` readable and the module focused.

## 5. File completion (`fileComplete.ts`) + data flow

```ts
export interface WalkOpts { cap?: number }   // cap = max files collected (default ~1000)
export function collectFiles(cwd: string, readdir: ReaddirFn, opts?: WalkOpts): string[]
export function rankCandidates(files: string[], query: string, cap?: number): Candidate[]   // cap default 50
```

- **`collectFiles`** walks `cwd` recursively, skipping directory names `node_modules`, `.git`, and any dot-prefixed dir; returns repo-relative POSIX paths; stops at `cap` files collected (bounds cost in large trees). `ReaddirFn` is an injected `(dir) => { name, isDir }[]` so tests use a fake tree (no disk). The component supplies a real `readdir` adapter over `node:fs`.
- **`rankCandidates`** does subsequence-fuzzy matching of `query` against each path (case-insensitive), scoring with bonuses for prefix matches and `/`-segment-boundary matches; returns the top `cap` by score, ties broken by shorter path then lexicographic. Empty `query` → first `cap` files (stable order).

**Data flow:** the reducer never touches the filesystem. When `applyKey` opens a mention, it returns state with `mention.files = []` and `mention.items = []`. The **component** sees `mention` newly active and runs `collectFiles(cwd, realReaddir)` once (async-safe, wrapped in try/catch, disposed-guarded), then dispatches a `setMentionFiles(files)` action → the reducer stores `files` and computes `items = rankCandidates(files, query)`. Every subsequent query keystroke re-ranks **synchronously in the reducer** from the cached `files` (no re-walk). This keeps the reducer pure/sync and isolates the one side effect.

> A `setMentionFiles` entry point is exposed as a small named reducer action (e.g. `setMentionFiles(state, files)`), not routed through `applyKey` (which is key-driven). Same pure-module, separate function.

## 6. Component (`ChatComposer.tsx`) + the Esc/Tab interaction

`ChatComposer({ onSubmit, cwd })`:
- Holds `useState<EditorState>(() => initialEditorState())`.
- One `useInput((input, key) => { const r = applyKey(state, input, key); if (r.submit != null) onSubmit(r.submit); setState(r.state); })`.
- A `useEffect` keyed on `mention?.anchor` (mention just opened with empty `files`) runs the walk and dispatches `setMentionFiles` (disposed-guarded via a ref, try/catch).
- **Render:** the buffer as lines, with a **cursor drawn by inverting the character at `cursor`** (an inverse space at end-of-line) — the `ink-text-input` technique, reimplemented for multiline. Below the buffer, when `mention` is open, a popup `<Box>` lists up to ~8 visible `items` (the highlighted one inverse), or "no matches" when empty.

**Esc/Tab coordination (self-contained, decided):** ChatApp's existing global `useInput` keeps `Esc = interrupt` and `Tab = cycle mode`, gated `isActive: !pending && !picker`. Both that handler and `ChatComposer`'s handler receive each key (Ink fans input out to all `useInput` hooks). We **do not** lift composer state to gate the global handler. Consequences, all acceptable:
- **Esc** closes an open mention (composer) *and* pings `interrupt()` (global). `interrupt()` is `void session.interrupt().catch(()=>{})` — a no-op/caught on an idle session, an acceptable edge during streaming. Net: Esc closes the popup; no harm.
- **Tab** accepts a candidate when a mention is open (composer) *and* cycles the permission mode (global). To avoid an unwanted mode-flip while completing, the composer uses **Enter to accept** as the primary affordance and treats `Tab`-accept as secondary; the spec accepts the simultaneous mode-cycle as a known minor edge (documented), since `Tab` outside a mention is the normal mode toggle. *(If this proves annoying in use, the follow-up is the same one-boolean gate; out of scope here.)*

This keeps `ChatComposer` fully decoupled from `ChatApp` beyond the `onSubmit`/`cwd` props.

## 7. Error handling

- **Walk failures** (permission denied, unreadable dir) → caught per-directory in `collectFiles` (skip and continue); a fully failed walk yields `[]` → popup shows "no matches"; the mention stays closeable.
- **Cap** bounds cost in large/deep trees (no unbounded walk).
- **Paste markers** stripped defensively (probe case D); other control characters (non-printable, non-routed) are filtered out before insertion.
- **History bounds** clamped (Up at oldest holds; Down past newest restores the stashed draft).
- **Empty/whitespace submit** → ignored (matches the existing `useChat.submit` trim guard; the editor simply does not emit `submit`).
- **Disposed guard** — the component's walk dispatch is guarded by a `disposed` ref so a late `setMentionFiles` never fires after unmount (the recurring teardown-liveness discipline).

## 8. Testing

- **`editor.test.ts`** (the bulk — pure, synchronous, no Ink): single-char typing + cursor; multi-line **paste** insert (probe-shaped single `input` with `\n`); `\`-continuation (line ends with `\` + `key.return` → newline, not submit); plain `Enter` → `submit` with the joined string + history push + reset; backspace mid-line and line-join at col 0; Left/Right wrap; Up/Down history recall with **stash/restore** and bounds clamp; Up/Down as cursor movement when not at the buffer edge; mention open on `@` at a word boundary, query filter (via `setMentionFiles` + typing), accept (Enter/Tab) inserts `@path`, close on Esc / backspace-past-anchor; `stripPasteMarkers` removes bracketed-paste sequences.
- **`fileComplete.test.ts`**: `collectFiles` over a **fake fs tree** applies the ignores (`node_modules`/`.git`/dot-dirs skipped) and the cap; `rankCandidates` ordering (prefix/segment bonuses, tie-breaks) and the `cap`; empty-query passthrough.
- **`components.test.tsx`** (append): `ChatComposer` renders the buffer + cursor; a few **timing-disciplined** ink-driven keys (await a subscribe tick first) — type text, `\`+Enter inserts a visible second line, Enter calls `onSubmit` with the joined string, `@` opens the popup. Pass a **small fixture `cwd`** (e.g. a `mkdtemp` dir with a couple of files, or a tiny tree under `test/fixtures/`) so the walk is fast/deterministic — do **not** walk the repo root in a unit test. Real escape sequences only (`\x1b[B`, `\r`, etc.).
- **Gated live e2e** (`tui/test/live/chat-input.e2e.test.ts`, minimal): open a real `Session`, submit a **two-line** prompt string and assert the turn completes with a non-empty result — proving a multiline prompt flows through the wire intact. Gated on `ANTHROPIC_API_KEY`; skips cleanly keyless; the controller runs the keyed pass. (Thin by design — there is no new SDK surface; it guards the one integration claim: multiline submit doesn't break `Session.submit`.)

## 9. Conventions (binding)

- **NO Prettier** — dense hand-style; match surrounding code.
- **ESM `.js` import specifiers** in `tui/` (`from "./editor.js"`); bare `"cc-harness"` for engine imports.
- **ink `useInput` passive-effect timing discipline** — component tests `await` a render tick / `waitFor` before writing keys; **never** raw `stdin.on`; **never** mutate shared components (`Composer` stays untouched); real escape sequences only.
- **Test files run SEQUENTIALLY** — `tui/vitest.config.ts` `fileParallelism:false` (leave it).
- **Keep modules small/focused** — pure `editor.ts`/`fileComplete.ts` + presentational `ChatComposer.tsx` keep `ChatApp` lean; the reducer stays pure (no React/Ink/fs; the walk is injected/component-owned).
- **No new `cc-harness` public exports** → no API-STABILITY/index.test pin, no harness rebuild.
- **Live tests gate** on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (gitignored — never commit/print); keyless suites skip cleanly.
- Commit messages: plain, **no `Co-Authored-By`/attribution**. Commit to `main` directly (no auto-branch); never push without an explicit request.
- Reviews: codex is down → Claude **Opus 4.8 high** for per-task + final reviews; fresh Sonnet implementers.

## 10. Scope boundaries (held — YAGNI)

In scope: multiline edit, in-memory history, `@`-fuzzy-completion (path insert). **Out of scope** (explicitly deferred): on-disk/persistent history; `@`-mention **content injection** (read+embed file bodies — the agent's `Read` tool covers it); full `.gitignore` parsing (basic ignores only); slash-command completion; syntax highlighting; word-wrap/soft-wrap of long single lines; horizontal scrolling; image/`!`-bash paste handling; undo/redo. Each is a clean future increment if wanted.
