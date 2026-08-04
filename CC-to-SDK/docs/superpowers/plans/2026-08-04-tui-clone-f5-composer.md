# F5 — The Composer (every keystroke before Enter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Rev 2 (2026-08-04): correction pass after plan review — 25 findings, 4 critical, all bundle-verified and adopted. Notable: paste threshold lives at `k0` L495741 (not L495700) and its newline arm is rows-dependent; the 8 s / 100 k limits gate the *hint* only; CM48 drains on first-line-cursor (not empty buffer) and merges queued+draft; KeymapProvider already assembles torn pastes (Task 3 shrank); smart spacing is image-only upstream (dropped); alt+d does NOT feed the kill ring; `AVf` yields `History 3/3` on first Up.

**Goal:** Bring the ccx chat composer to cell-level parity with Claude Code 2.1.220's: paste chips end to end (CM21–CM27), persisted prompt history (CM52–CM57), queue semantics on F0's rescue (CM47/CM48/CM51), upstream's form and editing model (CM1–CM5, CM8, CM12, CM14, CM17, CM18, CM20), the real autocomplete contract (CM28–CM30, CM34–CM40), and both history-search UIs (CM58, CM59).

**Architecture:** The pure `editor.ts` reducer stays the single editing model and gains chips (`pastedContents` map + span scanning), the upstream trigger regexes, and the readline tail; its growth is pre-allocated to two new modules (`editorHistory.ts` in Task 7, `completionTriggers.ts` in Task 9) so it never crosses the 500-line rule. Paste assembly stays where it already lives (KeymapProvider's `pasteRef`); Task 3 only *tags* released pastes and exposes a `pasting` signal. Persistence is two new fleet-root artifacts mirroring upstream's: `history.jsonl` (prompt history, upstream entry shape) and `paste-cache/` (content-hash `.txt` files), both under `fleetRoot(env)` so `CCX_FLEET_ROOT` isolates tests exactly like prefs.json. The composer's chrome is rebuilt from Box-border to **hand-drawn horizontal rules** (upstream's border has no left/right sides, and the `── History 3/57 ──` label is painted INTO the top rule — Ink Box cannot do that).

**Tech Stack:** TypeScript ESM, Ink (existing pins), vitest + ink-testing-library (keyless). **No new dependencies.**

## Global Constraints

- Reference bundle: `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js`. On any conflict between this plan, the census (`docs/superpowers/research/2026-07-31-tui-clone/00-INVENTORY.md` §D), the composer research (`.../03-composer.md`), and the bundle: **the bundle wins**; record the correction (dated) in the source doc you overturned.
- Honesty invariant (spec E2/E4): no rendered string may advertise a chord/command that does not resolve in the live keymap/catalog (`formatBindings(bindings(action))`, never a literal); no fabricated numbers.
- All commands run from `CC-to-SDK/harness/`. Gates after every task: `npm run typecheck` && `npx vitest run test/tui test/unit`. Tests must never read or write the real `~/.claude` — anything touching disk goes through `fleetRoot(env)` with a temp `CCX_FLEET_ROOT`, or takes an injected dir/clock.
- Dense hand-style, no Prettier; ESM import specifiers end in `.js`; modules stay <500 lines (split rather than grow).
- Commit per task, message prefix `f5(tN): …`, **no Co-Authored-By or attribution trailers**.
- Exact strings are exact: chip literals, placeholder strings, hint strings, empty-state strings are quoted verbatim from the bundle — byte-identical, including `\xA0` (NBSP) and casing.
- Upstream constants (line-verified in plan review): paste threshold `CMt = 800` chars (L153739) with newline arm `max(0, min(rows − 10, 2))` (`k0`, L495741–L495753) · expand-HINT window 8 s / cap `lgr = 1e5` (L495751–L495763, L317645) · history scan cap `gDo = 100` (L317645) · queue-hint session cap `LNb = 3` (L495120) · undo `maxBufferSize: 50`, `debounceMs: 1000` (`o9f` L489735–L489748, L495478) · popup rows `max(1, min(max(6, floor(rows/2)), rows−3))` (L432431) · name column `max(displayText widths) + 5`, slash catalog override `max(name lengths) + 6` (L432441, L490510) · file-walk debounce 50 ms (L490600) · double-press default 800 ms.

---

### Task 1: Editing-model tail — readline set, undo coalescing, backslash semantics

**Files:**
- Modify: `src/tui/editor.ts`
- Modify: `src/tui/keys/editorAdapter.ts` (only if a key name below doesn't map to `KeyFlags` yet)
- Test: `test/tui/editor-readline.test.ts` (new), extend existing editor pins

**Interfaces:**
- Consumes: existing `EditorState`, `applyKey(s, input, key)`, `KeyFlags`.
- Produces: `EditorState.undo` becomes `{ lines: string[]; cursor: Cursor; pastedContents: PastedMap; at: number }[]` — `PastedMap` is defined here as `Record<number, PastedEntry>` with `interface PastedEntry { id: number; type: "text"; content: string; lineCount: number }`, and `EditorState` gains `pastedContents: PastedMap` + `pasteCounter: number` + `hasUsedBackslashReturn: boolean` (Task 3 fills the map; declaring it now means the undo shape never reopens). `applyKey` gains an optional trailing `now?: number` (defaults `Date.now()`) for the undo coalesce window.

**Behavior contract (bundle):**
- CM12 (L395676): `ctrl+b` → left · `ctrl+f` → right · `ctrl+h` → `deleteTokenBefore() ?? backspace()` (until Task 4 lands the token op, `ctrl+h` = plain backspace — leave a `// Task 4 upgrades` comment) · `ctrl+n` → the `onDown` body · `ctrl+p` → the `onUp` body (popup nav included — L491100 gives ctrl+n/p popup movement too; Task 8's queue-drain interception must therefore cover ctrl+p as well as Up) · `alt+d` → `deleteWordAfter()`, and its return value is DISCARDED upstream (plan review f19, meta map `["d", () => W.deleteWordAfter()]`) — **alt+d does NOT feed the kill ring**.
- CM17 (`o9f` L489735–L489748, constants L495478): upstream debounces pushes on a real timer (a sub-1000 ms change is *rescheduled* and eventually lands), entries store the post-change text, and the structure is an index-walked undo/redo stack. A pure reducer has no timer, so we ship the observably-equivalent **coalesce rule** and record it as a deliberate divergence (Task 13 parity note): a buffer change arriving `< 1000 ms` (by `now`) after the previous *push* does not push — undo after a rapid typing run reverts the whole run. Cap **50** (was 100). Entries carry `pastedContents` + `at`; Ctrl-_ pop restores `pastedContents` too. No redo (upstream binds none).
- CM18 + f22 (L395679): the continuation rule is `offset > 0 && text[offset−1] === "\\"` — the character **before the cursor**, not the line end. Fix `continueLine`'s trigger accordingly (mid-line `\` + Enter eats the backslash and splits at the cursor), and set `hasUsedBackslashReturn: true` (Task 2's hint reads it).
- CM14 (L395676): `ctrl+a`/`ctrl+e` are `startOfLogicalLine`/`endOfLogicalLine` — our buffer is unwrapped logical lines, so current behavior IS upstream's; pin it with a multi-line-buffer test and a comment naming CM14.

**Steps:**

- [ ] **Step 1: Write the failing tests** — `ctrl+b/f` move; `ctrl+h` deletes left; `ctrl+n/p` mirror down/up exactly (history at edges, popup selection when open); `alt+d` deletes the word after AND the kill ring is unchanged; undo: inserts at `now` 0 and 500 coalesce to ONE entry, a third at 2000 pushes a second; 51 spaced changes cap at 50; pop restores `pastedContents`; `a\b` + Enter with cursor after the `\` eats the backslash and splits mid-line; the flag sets.
- [ ] **Step 2: Run — FAIL** (`npx vitest run test/tui/editor-readline.test.ts`).
- [ ] **Step 3: Implement** (ctrl-map additions in the existing `key.ctrl` switch; `alt+d` in the meta branch; coalesce + shape in `applyKey`'s wrapper; continuation fix in `continueLine` + its call gate).
- [ ] **Step 4: Green** — `npm run typecheck && npx vitest run test/tui test/unit` (existing undo pins move from cap-100/no-coalesce to the new contract — they pinned our divergence).
- [ ] **Step 5: Sabotage** — remove the coalesce window (always push) → the rapid-inserts test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t1): readline tail; coalesced undo (cap 50) carrying pastedContents; cursor-relative backslash-Enter`

---

### Task 2: Composer form — rules not boxes, the glyph, placeholder cursor, newline hint, external editor

**Files:**
- Modify: `src/tui/ChatComposer.tsx`, `src/tui/externalEditor.ts` (async conversion)
- Create: `src/tui/composerFrame.tsx`
- Test: `test/tui/composer-frame.test.tsx` (new)

**Interfaces:**
- Consumes: theme tokens `promptBorder`/`bashBorder` (theme.ts:28/40); columns via the ChatApp pattern (`deps?.columns?.() ?? stdout?.columns ?? 80` — thread a `columns?: () => number` prop).
- Produces: `<ComposerFrame columns borderToken label children>` — top rule of `─` at full width with `label` painted from offset 2 as ` ${dim(label)} ` replacing rule cells (L494870/L496163), content row(s) `[glyph, input]`, bottom rule. Exported `promptGlyph(mode, busy)`. `externalEditor.ts` exports an async `editExternalAsync(text): Promise<string | null>` alongside the sync one (composer migrates; the sync export stays until nothing imports it).

**Behavior contract (bundle):**
- CM1 (L496235): round-style border with `borderLeft:false, borderRight:false, borderBottom:true` — two horizontal rules, no verticals, no corners. Color `promptBorder`; `bashBorder` in `!` mode. Our `#` memory mode keeps `remember` (recorded ccx addition CM65 — do not remove).
- CM2 (L494720/L494733): glyph `❯` (U+276F) + **NBSP** (`\xA0`), `dimColor` while a turn runs; bash mode `!` + NBSP colored `bashBorder`, also dim while running. Replaces `"› "` (wrong glyph, wrong trailing char).
- CM5 (L395963): empty buffer → the placeholder's **first character renders inverted** (that IS the cursor), rest dim; empty placeholder → one inverted space. The placeholder TEXT stays the existing literal until Task 8's generator.
- CM20 (`Z_a`, **L433221** — plan-review f13 corrected the cite and the ladder): three strings — `"shift + ⏎ for newline"` when the terminal is Apple_Terminal OR terminal-setup installed the binding; else `"\⏎ for newline"` vs `"backslash (\) + return (⏎) for newline"` per `wXs()`. Transcribe the ladder at the line; our honest mapping: rung 1 gates on `env.TERM_PROGRAM === "Apple_Terminal"` (we have no /terminal-setup flag — record), rungs 2/3 per the transcribed `wXs` condition or, if it reads config we don't carry, default to the `"\⏎ for newline"` form with the choice recorded. After `hasUsedBackslashReturn` the backslash-form hint stops showing (L395700's `CXs`).
- CM8 (L496237 — now a real step, plan-review f11): while an external edit is in flight the WHOLE bordered row is replaced by italic dim `Save and close editor to continue...`. Convert the composer's `chat:externalEditor` action to the async editor (`spawn` + await exit, not `spawnSync`), holding `editorInFlight` state that renders the replacement row; on resolve, apply the edited text exactly as today.
- Footer ladder keeps derived chords (F2 rule); only editor-owned literals change.

**Steps:**

- [ ] **Step 1: Failing tests** — frame has NO `│`/`╭`/`╮` and two full-width `─` runs; label `History 3/57` inside the top rule at offset 2, dim, dashes undimmed on both sides; glyph `❯\xA0` carries `\x1b[2m` when `busy`; bash glyph `!\xA0`; placeholder first char inverted (`\x1b[7m`) + dim rest; newline-hint ladder (fake env); external edit in flight → frame replaced by the italic string, buffer applied after resolve (fake async editor DI).
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green** (existing composer pins on the Box border update to rules).
- [ ] **Step 5: Sabotage** — paint the label dim-dashes-included → the undimmed-dash assertion MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t2): two-rule frame with painted label; ❯ glyph; placeholder-cursor; newline-hint ladder; async external editor row`

---

### Task 3: Paste ingestion — tagged pastes, normalisation, the chip, `Pasting…`

**Files:**
- Modify: `src/tui/keys/KeymapProvider.tsx` (tag released pastes `paste: true`; expose `pasting`), `src/tui/keys/types.ts` (`TextEvent` gains `paste?: true`)
- Create: `src/tui/pasteChips.ts` (pure)
- Modify: `src/tui/editor.ts` (route paste-tagged text through `ingestPaste`), `src/tui/ChatComposer.tsx` (`Pasting…` row)
- Test: `test/tui/paste-chips.test.ts` (new), extend `test/tui/keys-provider.test.tsx`

**NOT in this task (plan-review f1):** parse.ts is untouched. KeymapProvider ALREADY assembles torn bracketed pastes (`pasteOpen`/`pasteRef`, KeymapProvider.tsx:47/155, tested at keys-provider.test.tsx:343 — "buffers a paste torn across two chunks into ONE text event"). Do not add a second buffer; do not fight the overflow latch at :140–150.

**Interfaces:**
- Consumes: Task 1's `PastedMap`/`pasteCounter`.
- Produces:

```ts
// pasteChips.ts
export function normalizePaste(raw: string): string;                        // stripANSI → \r\n|\r → \n → \t → "    "  (k0, L495741)
export function newlineThreshold(rows: number): number;                     // max(0, min(rows − 10, 2))              (k0, L495753)
export function chipLabel(id: number, lineCount: number): string;           // agr, L317383
export const CHIP_RE: RegExp;                                               // recognizer, L317394
export interface ChipSpan { start: number; end: number; id: number }
export function chipSpans(line: string): ChipSpan[];
export function ingestPaste(s: EditorState, raw: string, rows?: number): EditorState;  // rows default 24
export function substituteChips(text: string, map: PastedMap): string;      // fSe, L317403 — submit-time expansion
```

**Behavior contract (bundle):**
- Provider: when a complete or held-and-completed bracketed paste is released as a text event, it carries `paste: true`; while `pasteRef` holds an open paste, the provider exposes `pasting: true` (context value read by the composer) — ChatComposer renders dim **`Pasting…`** (CM25, L493764) while true.
- CM27 (`k0` L495741, order exact): strip ANSI, CRLF/CR → `\n`, tab → 4 spaces — applied to every paste-tagged event, chip-bound or not.
- CM21 (L495741–L495753): after normalisation, chip iff `text.length > 800 || newlineCount > newlineThreshold(rows)` where `newlineCount` counts `\r\n|\r|\n` **matches** (`kmt` — 40 newlines → `+40 lines`; a "40-line" paste without trailing newline is 39). Chip: `id = ++pasteCounter`, store `{id, type:"text", content, lineCount}`, insert `chipLabel(id, lineCount)` (`[Pasted text #N]` when lineCount 0, else `[Pasted text #N +M lines]`). Below threshold → insert normalized text verbatim (existing split path). Rows threads from the composer (same source as columns); the editor stays pure.
- Recognizer (L317394): `/\[(Pasted text|Image|Audio|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g` — callers re-instantiate or reset `lastIndex`.
- Submit (L317403): `substituteChips` replaces each recognized chip whose id is in the map with its content; unknown-id chips stay literal. `submitTurn` runs it so `onSubmit` receives full text; the history entry keeps display + map (Task 6 persists).

**Steps:**

- [ ] **Step 1: Failing tests.** Provider: a released two-chunk paste event has `paste: true`; `pasting` true between the chunks, false after. Chips: 900-char paste → `[Pasted text #1]` + map; 3-newline paste at rows 24 → `+3 lines`; 2-newline short paste at rows 24 → verbatim; 1-newline paste at rows 10 → chip (threshold 0); normalisation pins; submit expands while buffer showed the chip; a NON-paste text event >800 chars (hand-built) does NOT chip.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — drop the `paste` tag check in the editor (chip any large text) → the non-paste negative MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t3): paste-tagged events + Pasting…; k0 normalisation, rows-aware threshold, the [Pasted text #N] chip`

---

### Task 4: Chip mechanics — atomic delete, snap-out, GC

**Files:**
- Modify: `src/tui/pasteChips.ts`, `src/tui/editor.ts`
- Test: `test/tui/paste-chips.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3's `chipSpans`, `CHIP_RE`.
- Produces: `deleteTokenBefore(s): EditorState | null` (null = no token; backspace AND `ctrl+h` consult it first — Task 1's comment comes out), `snapOut(s): EditorState`.

**Behavior contract (bundle):**
- Atomic delete (L395149): fires only when the character **at** the cursor is whitespace or end-of-text (plan-review f18: `if (t !== void 0 && !/\s/.test(t)) return null;`) AND the text before the cursor matches `/(^|\s)\[(Pasted text #\d+(?: \+\d+ lines)?|Image #\d+|Audio #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]$/` — then the whole chip dies in one keystroke.
- Snap-out (L395149, L495400): after ANY key that moved the cursor, a cursor strictly inside a chip snaps to the NEARER edge (ties → end). Run centrally in `applyKey`'s wrapper; individual motions stay chip-blind.
- **Smart spacing: DROPPED** (plan-review f5 — upstream arms `go.current` only on the image path, L495712; text pastes clear it, L495742. Images are a spec non-goal). Record in Task 13's parity notes.
- GC (L495694): an edit that removes a chip's text from the buffer deletes its map entry (recognize labels present after the edit; entries whose label vanished die). Undo resurrects both (Task 1's entries carry the map).
- `clearToHistory` and `submitTurn` reset `pastedContents`/`pasteCounter` with the fresh state (the submitted/history copies were taken first).

**Steps:**

- [ ] **Step 1: Failing tests** — backspace right after `[Pasted text #1 +3 lines]` empties it + GCs the map; backspace when the cursor sits before a non-space character following the chip does NOT atomic-delete (f18 guard); arrows into a chip land on an edge (cursor two cells in from each side → nearer edge each way); ctrl+k through half a chip then submit → mangled remainder stays literal, map GC'd; undo after atomic delete restores chip + map.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — disable snap-out → the arrow test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t4): chips are atomic — guarded one-keystroke delete, cursor snap-out, map GC`

---

### Task 5: Paste cache + paste-again-to-expand

**Files:**
- Create: `src/tui/pasteCache.ts`
- Modify: `src/tui/ChatComposer.tsx` (expand + hint), `src/tui/pasteChips.ts` (expand op)
- Test: `test/unit/paste-cache.test.ts`, `test/tui/paste-expand.test.tsx` (new)

**Interfaces:**
- Consumes: `fleetRoot(env)` from `src/fleet/paths.ts` (prefs.ts:14 precedent).
- Produces:

```ts
// pasteCache.ts — dir join(fleetRoot(env), "paste-cache"), files `${hash}.txt`, mode 0o600 (RUd/MUd, L317317/L317321)
export function pasteHash(content: string): string;                        // sha256 hex .slice(0, 16)
export function storePaste(content: string, env?: NodeJS.ProcessEnv): void;   // unconditional write (f20), mkdir -p, silent on failure
export function loadPaste(hash: string, env?: NodeJS.ProcessEnv): string | null;
```

**Behavior contract (bundle — plan-review f4 corrected the gating):**
- CM26 (L317330): every chip's content persists under its hash at creation; history recall (Task 7) resolves hashes; unresolvable → `[Pasted text #N — content no longer available]` (L317398). Failures are silent no-ops (upstream falls back to an in-memory LRU, `ru_` L317324 — ours: silent skip, recorded).
- CM24 (L495751–L495763): the EXPAND has **no timer and no length cap** — re-pasting content equal to the *most recent* paste entry, while that chip is still locatable in the buffer (`kne`), replaces the chip inline with the full text. The **8 s window and the ≤100 000 cap gate only the HINT**: after a chip is created with content ≤ `lgr`, the dim hint **`paste again to expand`** (L493772) shows for 8 s (fresh chip resets it). Composer keeps `{lastPasteId, lastPasteContent}` + a hint timer.
- Expand consumes the re-paste (no second chip, no text insert beyond the replacement).

**Steps:**

- [ ] **Step 1: Failing tests** — cache: round-trip under temp `CCX_FLEET_ROOT`; missing hash → null; failure path (unwritable root) doesn't throw. Expand: paste 900 chars → chip + hint; same paste at t+9 s (fake timers — hint already gone) STILL expands (f4!); different paste → second chip; >100k paste → chip created, hint never shown, but re-paste still expands.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — key the expand on the hint window (the pre-review misreading) → the t+9 s test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t5): paste-cache (hash.txt, 0600) under the fleet root; expand keyed on content, hint keyed on 8s/100k`

---

### Task 6: Persisted prompt history — `history.jsonl`

**Files:**
- Create: `src/tui/promptHistory.ts`
- Test: `test/unit/prompt-history.test.ts` (new)

**Interfaces:**

```ts
export interface HistoryEntry { display: string; timestamp: number; sessionId?: string; project?: string; mode?: "prompt" | "bash"; pastedContents?: Record<number, { hash: string; lineCount: number }> }
export function appendHistory(e: HistoryEntry, env?: NodeJS.ProcessEnv): void;       // no-op when env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
export function readHistory(opts: { scope: "project" | "session" | "everywhere"; project?: string; sessionId?: string; limit?: number }, env?: NodeJS.ProcessEnv): HistoryEntry[];  // newest-first, deduped, limit default 100
```

**Behavior contract (bundle):**
- CM52 (L317450, L317540): file `join(fleetRoot(env), "history.jsonl")` — upstream's is `~/.claude/history.jsonl`; ours lives under the ccx fleet root by the prefs.ts precedent (same format, our root — deliberate location divergence, Task 13 note). Append-only, one JSON object per line via a single `appendFileSync` (upstream holds a file lock; atomic O_APPEND suffices at our entry sizes — recorded with the location note). Corrupt lines skipped on read. `CLAUDE_CODE_SKIP_PROMPT_HISTORY` (verbatim name) disables writes.
- CM53 (L317460): read newest-first; **dedup by exact `display` across the whole scan, newest wins**; scope filter BEFORE dedup (`project`/`session` match, `everywhere` keeps all). Cap 100 post-dedup (`gDo`, L317645).
- `pastedContents` persists hash references (Task 5 holds bodies) + `mode` persists for CM55.

**Steps:**

- [ ] **Step 1: Failing tests** — round-trip in temp root; newest-wins dedup (same display twice → one, newer timestamp); scope filters; corrupt middle line skipped; skip-env writes nothing; 150 appends → 100 back.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — dedup keep-oldest → the timestamp assertion MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t6): history.jsonl at the fleet root — append-only, newest-wins dedup, scoped reads`

---

### Task 7: History navigation — persistence wired, edit cache, mode filter, label, hint

**Files:**
- Create: `src/tui/editorHistory.ts` (the history-navigation model, EXTRACTED from editor.ts — plan-review f25's pre-allocated split; editor.ts re-exports/delegates)
- Modify: `src/tui/editor.ts`, `src/tui/ChatComposer.tsx`, `src/tui/ChatApp.tsx` (thread `sessionId`/`project`)
- Test: `test/tui/history-nav.test.tsx` (new)

**Interfaces:**
- Consumes: Task 6's module; Task 2's `label` prop; Task 5's cache.
- Produces: `EditorState.history` becomes `HistNavEntry[]` — `{ display: string; mode?: InputMode; pastedContents?: Record<number, { hash: string; lineCount: number }> }`; state gains `histEdits: Map<number, { display: string; pastedContents?: PastedMap; mode?: InputMode }>` (f9 — the full triple, not a string) and `histMode: "bash" | undefined`; the index-0 draft `stash` widens to the same shape. `ChatComposer` gains `sessionId?: string`, `project?: string`.

**Behavior contract (bundle):**
- Seeding: composer mount seeds from `readHistory({scope:"project", project})` (oldest-first for our index model). Submits append in memory AND to disk; `clearToHistory` persists too (upstream `cgr` does both, L395636/L317540).
- CM54 (L489568/L489585): editing a recalled entry stores `{display, pastedContents, mode}` at that index; arrowing away and back restores THE EDIT with its map and mode. Submit clears the cache.
- CM55 (L489551): transcribe the latch at the line — entering navigation from bash mode filters to bash entries; entering otherwise is unfiltered (`T.current = mode === "bash" ? mode : undefined`). Pin the transcription.
- CM4 label (`AVf` L494870, f8 corrected): with upstream's 1-based-into-newest-first `e`, the label is `History ${max(1, t − e + 1)}/${t}` — **first Up on 3 entries reads `History 3/3`**, oldest reads `History 1/3`. Convert our oldest-first index to upstream's `e` before applying. Edited entry → no label; total-unknown branch (`"History"`) is unreachable for us (we load fully — comment, don't build).
- CM56 (L489539–L489545, f21): fired when `upCount >= 2`, once per mount; upstream routes it through the notification queue (F7 territory) with a chord hint whose description is **`search history`**. Ours renders in the composer hint-row slot (recorded divergence until F7): derived chord + description via the existing hint derivation — e.g. `(ctrl+r to search history)` under default bindings, NEVER a literal.
- CM57 (L317525): recall rebuilds chips: display already holds labels; map entries resolve via `loadPaste`; a miss rewrites that chip in the recalled buffer to `[Pasted text #N — content no longer available]` (L317398 verbatim).

**Steps:**

- [ ] **Step 1: Failing tests** — pre-seeded temp root → Up recalls newest; edit + away + back preserves the edit INCLUDING its pastedContents (build one with a chip); bash latch; label `History 3/3` after one Up on 3 entries, `History 1/3` at the oldest, gone on edit; 2nd-Up hint once with the DERIVED chord (rebind test); chip recall with cache hit and with miss (lost-content literal).
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement** (extract `editorHistory.ts` first, tests green, then extend).
- [ ] **Step 4: Green** (migrate existing history-shape pins).
- [ ] **Step 5: Sabotage** — edit cache returns the original → MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t7): persisted history wired — full-triple edit cache, bash latch, History n/total, search hint, chip restore`

---

### Task 8: Queue semantics + the placeholder generator

**Files:**
- Modify: `src/tui/useChat.ts` (queue shape + drain), `src/tui/ChatApp.tsx`, `src/tui/ChatComposer.tsx`, `src/tui/prefs.ts` (`queuedUpHintSessions?: number`, `exampleFiles?: { files: string[]; at: number }`)
- Create: `src/tui/placeholder.ts`
- Test: `test/tui/queue-composer.test.tsx`, `test/unit/placeholder.test.ts` (new)

**Interfaces:**
- Consumes: F0's rescue (`interrupt()` prepend-prefill), `savePrefs`/`loadPrefs`.
- Produces: queue becomes `QueueEntry[]` — `{ value: string; mode: "prompt" | "bash"; priority: "now"; pastedContents?: PastedMap; origin: "user" }` (CM51 with honestly-fillable fields; `priority` always `"now"` today — carried, not invented). `ChatComposer` gains **one** drain seam (f23 — the synchronous one, no prefill round-trip): `queuePop?: () => { text: string; pastedContents?: PastedMap } | null`, consulted by the Up/ctrl+p handler per the CM48 guard below.

```ts
// placeholder.ts
export function examplePool(files: string[]): string[];                    // MVf's 8 templates, L495095
export function pickPlaceholder(i: { inputEmpty: boolean; queueHasEditable: boolean; upHintSessions: number; submitCount: number; hasMessages: boolean; suggestionEnabled: boolean; pool: string[]; rand: () => number }): string | undefined;
export function exampleFiles(cwd: string, run: (cmd: string) => string): string[];  // git-log harvest + denylist, L495082
```

**Behavior contract (bundle — f2 corrected CM48):**
- CM48 (`Uge` L495509–L495533, `V` L149093): Up drains when (a) the suggestion popup has ≤ 1 item, and (b) **the cursor is not past the first newline** (`text.indexOf("\n") === −1 || offset <= firstNewline`) — NOT only on an empty buffer. The drain joins `[...queuedValues, currentDraft]` — queued first, **current draft last** — `\n`-joined, cursor at the end; queued `pastedContents` merge into the composer map. Ctrl+p takes the same interception (Task 1 made it the `onUp` body). Escape's rescue (F0) is unchanged.
- CM47 (`NVf` L495107, f14): precedence, first match wins: (1) input non-empty → none; (2) *(agent-view — n/a, comment)*; (3) **some queued entry is editable** AND `queuedUpHintSessions < 3` → `Press up to edit queued messages` (all our entries are editable — note); (4) `submitCount < 1 && !hasMessages && suggestionEnabled` → the `Try "…"` string (we default `suggestionEnabled` true; it's an input so the table is exhaustive). Otherwise none. Counter persists in prefs, increments once per mount that showed rule 3 (upstream's increment site is config-owned — ours recorded as equivalent).
- CM3 (L495095, L495082): templates verbatim: `fix lint errors` · `fix typecheck errors` · `` how does ${f} work? `` · `` refactor ${f} `` · `how do I log an error?` · `` edit ${f} to... `` · `` write a test for ${f} `` · `create a util logging.py that...` — `f` random from `exampleFiles` else literal `<filepath>`. Harvest `git log -n 1000 --pretty=format: --name-only --diff-filter=M`, dedup, denylist (transcribe L495082's list verbatim), top 5, prefs-cached, refresh > 604 800 000 ms. Rendered `` Try "${pick}" ``, picked ONCE per mount, first char inverted per Task 2.

**Steps:**

- [ ] **Step 1: Failing tests** — placeholder table over ALL six inputs (incl. `suggestionEnabled:false` → rule 4 skipped); pool templates exact; drain: 2 queued + draft `c` → buffer `a\nb\nc` cursor at end, queue empty; drain blocked when cursor is on line 2 of a multiline draft; drain via ctrl+p too; popup-open (2 items) blocks; prefs counter stops the hint at 3 mounts; harvest parses/dedups/filters/caps (fake `run`).
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green** (`state.queue` consumers read `.value` now).
- [ ] **Step 5: Sabotage** — drain only-on-empty-buffer (the pre-review misreading) → the draft-merge test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t8): queue entries carry mode+pastes; Up/ctrl+p drain queued-then-draft; the placeholder ladder`

---

### Task 9: Autocomplete triggers + acceptance — Tab/Enter, wrap, empty state

**Files:**
- Create: `src/tui/completionTriggers.ts` (trigger regexes + scanning — the second pre-allocated editor.ts split, f25)
- Modify: `src/tui/editor.ts`, `src/tui/commandComplete.ts`, `src/tui/ChatComposer.tsx`
- Test: `test/tui/autocomplete-triggers.test.ts` (new)

**Behavior contract (bundle — f7/f12 corrected):**
- CM34 (`Pli` L489935–L489947): the whitespace/CJK-preceded trigger `/[\s。、？！]\/([a-zA-Z0-9._:-]*)$/` against text-before-cursor, cursor at token end. There is **no upstream head case** — a leading-`/` buffer cannot match the regex; our existing leading-slash popup is a separate RETAINED path (it is how our `/` catalog opens; keep it, comment it as ours). The denylist (`tRb` L490128: `add-dir`, `cd`, `resume`, `plugin`, `plugins`, `marketplace`) suppresses the TRIGGER when the buffer's leading command name is one of them (`startsWith("/")` guard → null) — it does not filter items. Apply it to both our paths: a leading `/resume…` buffer opens NO popup; the name still executes when submitted.
- CM35 (`ARb` L491153): `@` trigger `/(^|[\s。、？！])@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u` — full path chars + quoted `@"my file.ts"`; accept inserts the quoted form when the path has spaces (L491112 `needsQuotes`).
- CM28 (L490855/L490989/L491017, `XJa` L490110): **Tab accepts without executing** (`shouldExecute: false`); **Enter executes commands** — `XJa` submits unless `type === "prompt" && argNames.length > 0`. `CommandEntry` has no `type`: map as **local entries always submit; catalog entries with a non-empty `argumentHint` don't** (catalog = SDK prompt commands — the honest proxy; record the mapping). **Enter on a file mention only accepts** (the `H === "file"` branch never calls onSubmit — verified).
- CM29 (L491102): selection wraps both directions in both popups.
- CM38 (L490779): command empty state `` No commands match "${input}" `` verbatim; mention empty state: transcribe DXe's empty-message site or drop the popup on empty.

**Steps:**

- [ ] **Step 1: Failing tests** — mid-text ` /he` opens, `x/he` doesn't, `。/he` opens; leading `/resume` buffer opens NO popup but submits fine; leading `/mod` still opens (our retained path); `@"my` survives the space; Tab command → `/model ` no submit; Enter local command → submit; Enter catalog command with argumentHint → insert only; Enter catalog without hint → submit; Enter mention → insert only; wrap both ways in both popups; empty-state string exact.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement** (scan runs in `syncCompletions` so motions retrigger; extract to `completionTriggers.ts`).
- [ ] **Step 4: Green** (existing first-char-only pins update).
- [ ] **Step 5: Sabotage** — drop the whitespace precondition → `x/he` negative MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t9): upstream trigger regexes; denylist suppresses the trigger; Tab=accept, Enter=execute-for-commands; wrap`

---

### Task 10: Popup geometry, ghost text, inline argumentHint

**Files:**
- Create: `src/tui/suggestPopup.tsx`
- Modify: `src/tui/ChatComposer.tsx`, `src/tui/editor.ts` (ghost derivation)
- Test: `test/tui/suggest-popup.test.tsx` (new)

**Behavior contract (bundle — f15/f16 corrected):**
- CM30 (`DXe` L432430–L432461): visible rows `max(1, min(max(6, floor(rows/2)), rows − 3))` (rows threaded like columns); bottom-aligned (`justifyContent:"flex-end"`) and **blank-padded to the fixed height** (`pad = max(0, d − rendered)`) so the composer never jumps; scroll keeps the selection mid-anchored (walk up `floor(d/2)`, fill below, backfill above); name column = `maxColumnWidth ?? max(displayText widths) + 5` (slash catalog passes `max(name lengths) + 6`, L490510); a row takes 2 lines when the description overflows `columns − nameCol − tagW − kindW − sourceW − 4` — transcribe `a0H` (L432457–L432461) INCLUDING its `min(nameCol, floor(columns*0.4))` bound and apply the widths we actually render (no tag/kind/source lanes yet → their widths are 0, comment it); **selected row `color:"suggestion"`, unselected `dimColor`** (kill `inverse`); file rows `` `${displayText} – ${description}` `` en-dash (L432520).
- CM36 (L490543, L394780, f16): ghost text = dim remaining characters of the top match rendered after the cursor for a partial command. Acceptance: upstream's Tab branch (L491089) returns early when ghost text exists, HANDING the key to the `Autocomplete` context's `tab: autocomplete:accept` — so **Tab accepts the ghost**; additionally `right` on an *empty* input accepts the model prompt-suggestion (not built — skip, comment). Verify the tab-falls-through reading against the bundle in-task; pin whichever the bundle supports and cite the line in the test name.
- CM37 (L396283): completed `/command ` (trailing space, known name) → its `argumentHint` renders dim after the input, truncate-at-frame, space-prefixed unless the buffer ends in one.

**Steps:**

- [ ] **Step 1: Failing tests** — rows=24 → popup region exactly 12 lines incl. blank padding with a 3-item list; selected row has `suggestion` color SGR and NO inverse; overflow description wraps to 2 lines; ghost `/mod`+catalog(`model`) → dim `el` after cursor, Tab completes without submit; `/model ` shows hint dim inline; en-dash mention rows.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — remove blank padding → fixed-height test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t10): one popup — clamped height, mid-anchored scroll, suggestion-color selection, blank padding; ghost text; inline argumentHint`

---

### Task 11: Async file completion + iterative directory descent

**Files:**
- Modify: `src/tui/fileComplete.ts` (entries incl. dirs + async walk), `src/tui/ChatComposer.tsx` (debounce + stale guard), `src/tui/editor.ts` (dir-accept reopens)
- Test: `test/tui/file-complete-async.test.tsx` (new)

**Behavior contract (bundle):**
- CM39 (L490600): the @-walk re-filter runs debounced **50 ms** on query change, async, with a generation counter — stale resolutions never overwrite newer results. First open: immediate kick-off; while in flight show the popup's `Loading…` empty state (transcribe DXe's loading string).
- CM40 (`reSuggest`, L490989 area): directories are candidates (`dir/` display, trailing slash); accepting one inserts `@dir/` and REOPENS the popup one level deeper (mention stays open, query empty at the new base). Files accept-and-close with the trailing space as today.
- `collectEntries(cwd, readdir, opts): { path: string; isDir: boolean }[]` sibling to `collectFiles` (which stays for callers); ranking scores dirs like files.

**Steps:**

- [ ] **Step 1: Failing tests** — controllable fake async readdir: rapid typing → one walk per window; slow gen-1 after gen-2 discarded; `@src` lists `src/`; accepting it → buffer `@src/`, popup open at the child level; file accept closes with trailing space; `Loading…` while first walk pends.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — drop the generation guard → stale test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t11): debounced async @-walk with stale guards; directories complete iteratively`

---

### Task 12: Both search UIs — inline reverse-i-search + picker preview pane

**Files:**
- Create: `src/tui/InlineHistorySearch.tsx` (+ its state hook if >100 lines)
- Modify: `src/tui/HistorySearchOverlay.tsx` (preview + responsive), `src/tui/ChatApp.tsx` (routing), `src/tui/ChatComposer.tsx` (scope push + escape bypass), `src/tui/commands.ts` (`/history` local command)
- Test: `test/tui/inline-history-search.test.tsx`, extend `test/tui/history-search.test.tsx`

**Behavior contract (bundle — f10 addressed):**
- Routing: upstream selects the full-screen picker only in fullscreen layout (`yie()` = fullscreen check, 03-composer.md §6.4 — cite the doc, the exact line was not pinned); classic layout gets the inline search. Our REPL is permanently classic ⇒ **`history:search` (ctrl+r) opens the INLINE search**; the picker stays reachable via a new local `/history` command (recorded addition). Record both in Task 13.
- **Keymap ownership (f10 — explicit design):** the inline search lives inside the composer, so `inputOwnerRef` stays `"composer"`. The composer pushes `useKeyScope("HistorySearch", { active: searching })` AFTER its other scopes (mount order = rank; matches the Autocomplete pattern at ChatComposer.tsx:188–189), and `handleKey`/`cancel` gain a live `searching` re-read FIRST: while searching, Escape resolves as `historySearch:accept` (keep buffer, exit search) and must NOT reach `cancel()`; ctrl+c → `historySearch:cancel` (restore pre-search draft); enter → execute; ctrl+r → next match; ctrl+s → cycle scope. The `HistorySearch` context bindings (bindings.ts:75) are already verbatim upstream.
- CM58 (`r9f` L489642, `xWf` L493443): the UI is a hint-row line: dim prompt **`search prompts:`** (miss → **`no matching prompt:`**) + query. Matching walks entries newest-first with `lastIndexOf(query.toLowerCase())`, deduped by display; each match **rewrites the composer buffer in place**, cursor at the match offset. Entering stashes the pre-search buffer; cancel restores it.
- CM59 (`qGf` L492153): picker preview pane — `round` + `borderDimColor`, 6 content lines + dim `+N more` tail; **side-by-side ≥ 100 columns, stacked otherwise**. Ranking/scope/age stay.
- Source: both UIs read Task 6's `readHistory` (scope-cycled). The overlay migrates off the transcript loader; pre-F5 prompts drop out of search — recorded in Task 13.

**Steps:**

- [ ] **Step 1: Failing tests** — ctrl+r (keymap dispatch) opens inline, NOT the overlay; typing rewrites the buffer to the newest match, cursor at offset; second ctrl+r walks older; **esc ACCEPTS** (buffer keeps match, search closes, no interrupt fired — the surprising semantic, guarded); ctrl+c restores the pre-search draft; enter submits; miss shows `no matching prompt:`; ctrl+s cycles scope; `/history` opens the overlay; overlay at 120 cols shows the bordered preview beside the list with `+N more`; at 80 cols stacked.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — route Escape to `cancel()` while searching → the esc-accepts test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t12): ctrl+r inline reverse-i-search (scoped keys, esc accepts); picker preview pane + /history`

---

### Task 13: Wave close — acceptance pins, parity re-score

**Files:**
- Create: `test/tui/f5-acceptance.test.tsx`
- Modify: `docs/parity/tui-ux.md` (§1 re-score + F5 section), `docs/parity/coverage.md` (TUI row), spec `## Revision Notes` for plan-review-driven corrections that touched spec wording

**Steps:**

- [ ] **Step 1: Acceptance test file** — the spec's F5 acceptance as keyless tests (wording per plan-review f17):
  1. A paste containing 40 newlines inserts `[Pasted text #1 +40 lines]`; ONE backspace deletes the whole chip; submitting hands `onSubmit` the full content.
  2. History survives relaunch: submit under a temp fleet root, remount fresh → Up recalls; a repeated prompt appears once, newest-first; a recalled-then-edited prompt survives arrow-away-and-back.
  3. `/mod` shows dim ghost text; Tab accepts without submitting; Enter (local command) accepts and submits.
  4. Accepting `@src/` reopens the popup one level deeper.
  5. Rules above and below, no side borders; `❯` dims while running; history arrowing paints `History n/total` into the top rule and hides it on edit.
- [ ] **Step 2: Full gates** — `npm run typecheck && npm run build && npx vitest run test/tui test/unit`.
- [ ] **Step 3: Parity docs** — tui-ux.md "## F5 (2026-08-04) — the composer": now-faithful; deliberate divergences (history.jsonl + paste-cache under the fleet root; appendFileSync not a lock; undo coalesce instead of deferred debounce, no in-memory LRU cache fallback; CM56 hint in the composer row pending F7's queue; ctrl+r routing = classic layout ⇒ inline, `/history` recorded addition; pre-F5 prompts absent from search; smart spacing not shipped — image-only upstream; catalog-argumentHint proxy for XJa's prompt-type predicate); unreachable per spec (CM6/CM7; CM19 only via terminals sending ESC-CR); re-score §1 CM-by-CM; coverage.md TUI row one honest sentence.
- [ ] **Step 4: Commit** `f5(t13): acceptance pins + parity re-score`

---

## Self-review notes

- Spec coverage: CM21–27 → T3/T4/T5 (CM22's smart-spacing arm dropped with bundle evidence, recorded); CM52–57 → T6/T7; CM47/48/51 → T8; CM1–5/8/12/14/17/18/20 → T1/T2; CM28–30/34–40 → T9/T10/T11; CM58/59 → T12. Non-goals honored (no vim/images/mouse/highlight-spans/extra sources; CM6/CM7 unreachable).
- Types: `PastedMap` (T1) → T3–T8; `QueueEntry` (T8) → ChatApp; `HistoryEntry` (T6) → T7/T12; `HistNavEntry`/edit-cache triple (T7) consistent with the stash widening.
- editor.ts growth pre-allocated: `editorHistory.ts` (T7), `completionTriggers.ts` (T9), `pasteChips.ts` (T3) all pure and separately testable.
- Plan-review disposition: f1–f25 all adopted (f5 as a drop + record; f6 as divergence-by-design; f16 as verify-in-task with both readings named).
