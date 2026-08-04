# F5 — The Composer (every keystroke before Enter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the ccx chat composer to cell-level parity with Claude Code 2.1.220's: paste chips end to end (CM21–CM27), persisted prompt history (CM52–CM57), queue semantics on F0's rescue (CM47/CM48/CM51), upstream's form and editing model (CM1–CM5, CM8, CM12, CM14, CM17, CM18, CM20), the real autocomplete contract (CM28–CM30, CM34–CM40), and both history-search UIs (CM58, CM59).

**Architecture:** The pure `editor.ts` reducer stays the single editing model and gains chips (`pastedContents` map + span scanning), the upstream trigger regexes, and the readline tail. The keys layer gains a **stateful paste assembler** (torn bracketed pastes span stdin chunks; parse.ts stays pure by threading a continuation value). Persistence is two new fleet-root artifacts mirroring upstream's: `history.jsonl` (prompt history, upstream entry shape) and `paste-cache/` (content-hash files), both under `fleetRoot(env)` so `CCX_FLEET_ROOT` isolates tests exactly like prefs.json. The composer's chrome is rebuilt from Box-border to **hand-drawn horizontal rules** (upstream's border has no left/right sides, and the `── History 3/57 ──` label is painted INTO the top rule — Ink Box cannot do that).

**Tech Stack:** TypeScript ESM, Ink (existing pins), vitest + ink-testing-library (keyless). **No new dependencies.**

## Global Constraints

- Reference bundle: `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js`. On any conflict between this plan, the census (`docs/superpowers/research/2026-07-31-tui-clone/00-INVENTORY.md` §D), the composer research (`.../03-composer.md`), and the bundle: **the bundle wins**; record the correction (dated) in the source doc you overturned.
- Honesty invariant (spec E2/E4): no rendered string may advertise a chord/command that does not resolve in the live keymap/catalog (`formatBindings(bindings(action))`, never a literal); no fabricated numbers.
- All commands run from `CC-to-SDK/harness/`. Gates after every task: `npm run typecheck` && `npx vitest run test/tui test/unit`. Tests must never read or write the real `~/.claude`* — anything touching disk goes through `fleetRoot(env)` with a temp `CCX_FLEET_ROOT`, or takes an injected dir/clock.
- Dense hand-style, no Prettier; ESM import specifiers end in `.js`; modules stay <500 lines (split rather than grow — `editor.ts` is at 362 and several tasks touch it: split helpers into new modules rather than passing ~500).
- Commit per task, message prefix `f5(tN): …`, **no Co-Authored-By or attribution trailers**.
- Exact strings are exact: chip literals, placeholder strings, hint strings, empty-state strings are quoted verbatim in each task from the bundle — byte-identical, including `\xA0` (NBSP) and casing.
- Upstream constants used in this wave: paste chip threshold `CMt = 800` chars / `> 2` newlines (L153739, L495700) · expand window 8 s, cap `lgr = 1e5` (L317645, L495760) · history scan cap `gDo = 100` (L317508) · queue-hint session cap `LNb = 3` (L495120) · undo `maxBufferSize: 50`, `debounceMs: 1000` (L489736, L495478) · popup rows `clamp(max(6, rows/2), 1, rows−3)` (L432431) · name column ≤ 40 % of width (L432457) · file-walk debounce 50 ms (L490600) · double-press default 800 ms.

---

### Task 1: Editing-model tail — readline set, undo ring contract, backslash flag

**Files:**
- Modify: `src/tui/editor.ts`
- Modify: `src/tui/keys/editorAdapter.ts` (only if a key name below doesn't map to `KeyFlags` yet)
- Test: `test/tui/editor-readline.test.ts` (new), extend `test/tui/editor.test.ts` pins where they exist

**Interfaces:**
- Consumes: existing `EditorState`, `applyKey(s, input, key)`, `KeyFlags`.
- Produces: `EditorState.undo` becomes `{ lines: string[]; cursor: Cursor; pastedContents: PastedMap; at: number }[]` — `PastedMap` is defined here as `Record<number, PastedEntry>` with `interface PastedEntry { id: number; type: "text"; content: string; lineCount: number }`, and `EditorState` gains `pastedContents: PastedMap` + `pasteCounter: number` + `hasUsedBackslashReturn: boolean` (Task 3 fills the map; declaring it now means the undo shape never reopens). `applyKey` gains an optional trailing `now?: number` (defaults `Date.now()`) for the undo debounce.

**Behavior contract (bundle):**
- CM12 (L395676): `ctrl+b` → left · `ctrl+f` → right · `ctrl+h` → `deleteTokenBefore() ?? backspace()` (until Task 4 lands the token regex, `ctrl+h` = plain backspace — leave a `// Task 4 upgrades` comment) · `ctrl+n` → down-falling-into-history-next · `ctrl+p` → up-falling-into-history-prev (both EXACTLY the `onUp`/`onDown` bodies — popup nav included, L491100 gives ctrl+n/p popup movement too) · `alt+d` → delete word after cursor (kill? NO — upstream `de` maps alt+d to `deleteWordAfter()` which DOES feed the ring per L395676's kill map; verify at the line and match: if it dispatches `{type:"kill"}`, fold into the ring with `dir:"append"`).
- CM17 (L489736, L495478): undo push is **debounced 1000 ms** — a change arriving < 1000 ms after the newest undo entry REPLACES nothing and pushes nothing (the older snapshot already covers the run); a change ≥ 1000 ms after the newest entry pushes the prior buffer. Cap **50** (not 100). Entries carry `pastedContents` so a chip delete undoes to the chip *with its content*. Ctrl-_ pop restores `pastedContents` too.
- CM18 (L395700): `\`+Enter continuation sets `hasUsedBackslashReturn: true` (Task 2's hint reads it).
- CM14 (L395676): `ctrl+a`/`ctrl+e` — our buffer is unwrapped logical lines, so current behavior IS upstream's; pin it with a test on a multi-(logical)-line buffer and a comment naming CM14.

**Steps:**

- [ ] **Step 1: Write the failing tests** — `ctrl+b/f` move, `ctrl+h` deletes left, `ctrl+n/p` walk history exactly like down/up (seed history, cursor at edges), `alt+d` deletes the word after (and its text lands in the kill ring, appended, IF the bundle check says kill — record which in the test name), undo: two rapid inserts (`now` 0 and 500) yield ONE undo entry; a third at 2000 yields a second; 51 spaced changes cap at 50; pop restores `pastedContents`; `\`+Enter sets the flag.
- [ ] **Step 2: Run — FAIL** (`npx vitest run test/tui/editor-readline.test.ts`).
- [ ] **Step 3: Implement** in `editor.ts` (ctrl map additions inside the existing `key.ctrl` switch; alt+d in the meta branch; undo shape + debounce in `applyKey`'s wrapper; flag in `continueLine`).
- [ ] **Step 4: Green** — new file + `npm run typecheck && npx vitest run test/tui test/unit` (existing undo pins will need updating from cap-100/no-debounce to the new contract — update them, they were pinning our divergence).
- [ ] **Step 5: Sabotage** — remove the debounce (push always) → the rapid-inserts test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t1): readline tail, debounced undo ring (cap 50) with pastedContents, backslash flag`

---

### Task 2: Composer form — rules not boxes, the real glyph, placeholder cursor, newline hint

**Files:**
- Modify: `src/tui/ChatComposer.tsx`
- Create: `src/tui/composerFrame.tsx` (the two rules + glyph row; keeps ChatComposer under control)
- Test: `test/tui/composer-frame.test.tsx` (new)

**Interfaces:**
- Consumes: `resolveThemeColor`/`themeTokens` (tokens `promptBorder`, `bashBorder` exist in theme.ts:28/40); columns via the ChatApp pattern (`deps?.columns?.() ?? stdout?.columns ?? 80` — thread a `columns?: () => number` prop from ChatApp like BgTasksPanel does).
- Produces: `<ComposerFrame columns={n} borderToken={...} label={string | undefined} children>` rendering: a top rule of `─` at full width with `label` painted starting at offset 2 (` ${dim(label)} ` replacing rule cells, L494870/L496163), the content row(s) `[glyph, input]`, a bottom rule. Exported `promptGlyph(mode, busy)` helper.

**Behavior contract (bundle):**
- CM1 (L496235): border is round-style with `borderLeft:false, borderRight:false, borderBottom:true` — i.e. **two horizontal rules, no verticals, no corners**. Color: `promptBorder` normally, `bashBorder` in `!` mode. Our `#` memory mode keeps `remember` (recorded ccx addition CM65 — do not remove).
- CM2 (L494720/L494733): glyph is `❯` (U+276F) + **NBSP** (`\xA0`), `dimColor` while a turn runs; bash mode `!` + NBSP colored `bashBorder`, also dim while running. Replace the current `"› "` (U+203A — wrong glyph, wrong trailing char).
- CM5 (L395963): when the buffer is empty, the placeholder's **first character renders inverted** (that IS the cursor), the rest dim: `invert(text[0]) + dim(text.slice(1))`; an empty placeholder renders a single inverted space. Kill the current separate `<Text inverse>" "</Text>` + full-dim-text shape.
- CM20 (L493448): the newline hint string is terminal-conditional — `"shift + ⏎ for newline"` when the terminal delivers shift+enter (our parse.ts maps ESC-CR → shift+enter, installed by `/terminal-setup`; gate on `env.TERM_PROGRAM === "Apple_Terminal"` is upstream's FXs case — verify Z_a at the line and transcribe its ladder), else `"\⏎ for newline"`. After Task 1's `hasUsedBackslashReturn` is true, the backslash-form hint stops showing (CM18's purpose, L395700).
- The footer ladder keeps its derived chords (F2 rule); only the literal editor-owned strings change.

**Steps:**

- [ ] **Step 1: Failing tests** — frame contains NO `│`/`╭`/`╮` (current Box border chars) and DOES contain two full-width `─` runs; label `History 3/57` appears inside the top rule at offset 2, dim, with undimmed dashes on both sides; glyph is `❯\xA0` and carries `\x1b[2m` when `busy`; bash mode glyph `!\xA0`; empty-buffer frame shows placeholder first char inverted (`\x1b[7m`) followed by dim rest.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** `composerFrame.tsx`; rewire ChatComposer's outer Box to it. Placeholder text itself is still the fixed string this task (Task 8 builds the generator — leave `"Try \"how does codex_somersault work?\"…"`? NO: keep the existing `Ask Claude anything…` literal until Task 8 replaces it; this task only changes its RENDER shape).
- [ ] **Step 4: Green** (existing composer tests will break on the border shape — update the pins to rules).
- [ ] **Step 5: Sabotage** — render the label dim-dashes-included → label test MUST fail on the undimmed-dash assertion; restore.
- [ ] **Step 6: Commit** `f5(t2): composer frame = two rules + painted label; ❯ glyph dims while running; placeholder-cursor`

---

### Task 3: Paste pipeline — cross-chunk assembly, normalisation, the chip

**Files:**
- Modify: `src/tui/keys/parse.ts` (continuation-threading), `src/tui/keys/KeymapProvider.tsx` (holds the continuation + emits a `paste` signal)
- Create: `src/tui/pasteChips.ts` (pure: normalisation, thresholds, chip literals/recognizer, span scan, ingest)
- Modify: `src/tui/editor.ts` (route large text events through `ingestPaste`), `src/tui/ChatComposer.tsx` (`Pasting…` row)
- Test: `test/tui/paste-chips.test.ts`, `test/tui/keys-paste-assembly.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `PastedMap`/`pasteCounter` on `EditorState`.
- Produces:

```ts
// pasteChips.ts
export function normalizePaste(raw: string): string;                       // stripANSI → \r\n|\r → \n → \t → 4 spaces (L495700)
export function chipLabel(id: number, lineCount: number): string;          // agr, L317381
export const CHIP_RE: RegExp;                                              // recognizer, L317389 (global — callers re-instantiate or reset)
export interface ChipSpan { start: number; end: number; id: number }
export function chipSpans(line: string): ChipSpan[];
export function ingestPaste(s: EditorState, raw: string): EditorState;     // threshold check; below → plain insertText path
export function substituteChips(text: string, map: PastedMap): string;     // fSe, L317403 — submit-time expansion
// parse.ts
export interface PasteCont { payload: string }                             // an open bracketed paste awaiting \x1b[201~
export function parseBytes(chunk: string, cont?: PasteCont | null): { events: InputEvent[]; cont: PasteCont | null };
```

(Keep a `parseBytes(chunk)` 1-arg overload returning `InputEvent[]` for every existing caller/test — the two-form signature, or a new `parseBytesCont` name if the overload fights TS; pick one and pin it.)

**Behavior contract (bundle):**
- Assembly: a chunk opening `\x1b[200~` without `\x1b[201~` returns `cont` holding the partial payload and NO text event; subsequent chunks append raw bytes to `cont.payload` (no key parsing inside a paste!) until the end marker, then the whole payload becomes ONE text event flagged as paste. KeymapProvider stores the continuation in a ref and, while it is non-null, exposes `pasting: true` (context value or ref-state) — ChatComposer renders dim **`Pasting…`** (CM25, L493776) while true.
- CM27 normalisation (L495700 order): strip ANSI escapes, CRLF/CR → `\n`, tab → 4 spaces — applied to EVERY paste (chip-bound or not).
- CM21 threshold (L495700): after normalisation, `text.length > 800 || newlineCount > 2` → chip: allocate `id = ++pasteCounter`, store `{id, type:"text", content, lineCount}`, insert `chipLabel(id, lineCount)` at the cursor (`[Pasted text #N]` when lineCount 0, else `[Pasted text #N +M lines]`). Below threshold → insert the normalized text verbatim (multi-line inserts stay the existing split path).
- Recognizer (L317389): `/\[(Pasted text|Image|Audio|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g`.
- Submit substitution (L317403): `substituteChips` replaces each chip whose id is in the map with its content; unknown-id chips stay literal. `submitTurn` (editor.ts) runs it so the submitted prompt carries the full text; the HISTORY entry keeps the chip display + map (Task 6 persists both).

**Steps:**

- [ ] **Step 1: Failing tests.** Assembly: `parseBytes("\x1b[200~abc")` → no events + cont; feeding `"def\x1b[201~x"` with that cont → one text event `abcdef` + key `x` + cont null; a ctrl+c byte inside an open paste stays payload, never a key. Chips: 900-char paste → buffer shows `[Pasted text #1]`, map holds content; 3-newline paste → `+3 lines` label; 2-newline short paste → verbatim insert; normalisation pins (ANSI stripped, `\r\n`→`\n`, `\t`→4 spaces); submit returns expanded text while the visible buffer showed the chip.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** (parse.ts: `parsePaste` returns cont instead of flushing when unterminated; a `cont` entry short-circuits the parser head). Editor: `applyKeyInner`'s text-input arm calls `ingestPaste` when the event came from a paste OR when the text trips the threshold (a >800-char single chunk of typed text does not exist in practice; upstream keys on its paste path — flag the event: `TextEvent` gains optional `paste?: true` set by the assembler, and only paste-flagged events take the chip path; sub-threshold paste-flagged events insert normalized text).
- [ ] **Step 4: Green** + typecheck.
- [ ] **Step 5: Sabotage** — make the assembler flush an unterminated paste immediately (old behavior) → the cross-chunk test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t3): bracketed-paste assembly across chunks, CM27 normalisation, the [Pasted text #N] chip`

---

### Task 4: Chip mechanics — atomic delete, snap-out, smart spacing, GC

**Files:**
- Modify: `src/tui/pasteChips.ts`, `src/tui/editor.ts`
- Test: `test/tui/paste-chips.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3's `chipSpans`, `CHIP_RE`.
- Produces: `deleteTokenBefore(s: EditorState): EditorState | null` (null = no token at cursor; `ctrl+h` and backspace both consult it first — Task 1's comment comes out), `snapOut(s: EditorState): EditorState` (cursor strictly inside a chip span → nearer edge), and a `pendingChipSpace` flag on `EditorState`.

**Behavior contract (bundle):**
- Atomic delete (L395149): backspace with the cursor at a chip's END removes the whole chip in one keystroke — regex `/(^|\s)\[(Pasted text #\d+(?: \+\d+ lines)?|Image #\d+|Audio #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]$/` against the text before the cursor.
- Snap-out (L395149, L495400): after ANY key that moved the cursor (arrows, word motions, home/end, mouse-less), a cursor strictly inside a chip snaps to the NEARER edge (ties → end). Run it centrally in `applyKey`'s wrapper — individual motions stay chip-blind.
- Smart spacing (L495767): immediately after a chip insert, the NEXT typed printable gets a space prepended unless it is one of `.,?!:;)]` — one-shot flag, cleared by any other key.
- GC (L495694): when an edit removes a chip's text from the buffer, its map entry is deleted (diff old/new buffer text through the recognizer; entries whose label no longer appears anywhere die). Undo can resurrect both (Task 1's entries carry the map).
- Esc-Esc `clearToHistory` and `submitTurn` both reset `pastedContents`/`pasteCounter` with the fresh state (chips die with the buffer; the submitted/history copies were taken first).

**Steps:**

- [ ] **Step 1: Failing tests** — one backspace after `[Pasted text #1 +3 lines]` empties it and GCs the map; backspace mid-chip is preceded by snap-out (cursor never lands inside); left-arrow into a chip from the right lands at its START (nearer edge from one step in is start? compute: one step in from the end is nearer the END — assert the actual nearer-edge rule with cursor two cells in from each side); typing `x` right after chip insert produces `] x`; typing `.` produces `].`; deleting half the chip text via ctrl+k then submitting leaves the mangled remainder literal (recognizer no longer matches → no substitution, map GC'd).
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — disable snap-out → the arrow test MUST fail; restore.
- [ ] **Step 6: Commit** `f5(t4): chips are atomic — one-keystroke delete, cursor snap-out, smart spacing, map GC`

---

### Task 5: Paste cache + paste-again-to-expand

**Files:**
- Create: `src/tui/pasteCache.ts` (fs; fleet-root)
- Modify: `src/tui/ChatComposer.tsx` (expand window + hint), `src/tui/pasteChips.ts` (expand op)
- Test: `test/unit/paste-cache.test.ts`, `test/tui/paste-expand.test.tsx` (new)

**Interfaces:**
- Consumes: `fleetRoot(env)` from `src/fleet/paths.ts` (prefs.ts:14 precedent).
- Produces:

```ts
// pasteCache.ts — dir join(fleetRoot(env), "paste-cache")
export function pasteHash(content: string): string;                        // sha256 hex, first 16
export function storePaste(content: string, env?: NodeJS.ProcessEnv): void;   // write-if-absent, mkdir -p
export function loadPaste(hash: string, env?: NodeJS.ProcessEnv): string | null;
```

**Behavior contract (bundle):**
- CM26 (L317330): every chip's content is persisted under a content-hash key at chip-creation time; history recall (Task 7) resolves hashes back to content; unresolvable → the lost-content literal `[Pasted text #N — content no longer available]` (L317398).
- CM24 (L495760, L317645, L493779): for 8 s after a chip is created (composer-level timer, id + normalized text remembered), pasting **the same text again** (compare normalized) replaces the chip in the buffer with the full text inline — only when content ≤ 100 000 chars. While the window is open the hint row reads **`paste again to expand`** (dim). Window closes on timeout or any expand.
- fs failures are silent no-ops (upstream's cache is best-effort): `try/catch` inside the module, never a throw to the composer.

**Steps:**

- [ ] **Step 1: Failing tests** — cache: store/load round-trip under a temp `CCX_FLEET_ROOT`; write-if-absent (second store of same content doesn't rewrite mtime — or simply doesn't throw); load of missing hash → null. Expand: paste 900 chars (chip appears, hint `paste again to expand` visible), paste the same 900 chars at t+2 s (fake timer) → buffer holds the full text, chip + map entry gone, hint gone; same paste at t+9 s → a SECOND chip instead.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — drop the ≤100k gate → add a >100k window test asserting NO expand… (that test belongs in Step 1; sabotage = remove the gate and watch it fail); restore.
- [ ] **Step 6: Commit** `f5(t5): paste-cache under fleet root; 8s paste-again-to-expand with its hint`

---

### Task 6: Persisted prompt history — `history.jsonl`

**Files:**
- Create: `src/tui/promptHistory.ts`
- Test: `test/unit/prompt-history.test.ts` (new)

**Interfaces:**
- Produces:

```ts
export interface HistoryEntry { display: string; timestamp: number; sessionId?: string; project?: string; pastedContents?: Record<number, { hash: string; lineCount: number }> }
export function appendHistory(e: HistoryEntry, env?: NodeJS.ProcessEnv): void;       // skip entirely when env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
export function readHistory(opts: { scope: "project" | "session" | "everywhere"; project?: string; sessionId?: string; limit?: number }, env?: NodeJS.ProcessEnv): HistoryEntry[];  // newest-first, deduped, limit default 100
```

**Behavior contract (bundle):**
- CM52 (L317450, L317540): file `join(fleetRoot(env), "history.jsonl")` — upstream's is `~/.claude/history.jsonl`; ours lives under the ccx fleet root by the prefs.ts precedent (tests isolate via `CCX_FLEET_ROOT`; same format, our root — record as a deliberate location divergence in Task 13's parity note). Append-only, one JSON object per line. Upstream holds a file lock around appends; we use a single `appendFileSync` (atomic O_APPEND for our entry sizes) — record with the location note. Corrupt lines are skipped on read, never a throw. `CLAUDE_CODE_SKIP_PROMPT_HISTORY` (verbatim env name) disables writes.
- CM53 (L317460): read newest-first; **dedup by exact `display` across the whole scan, newest wins**; scope filter BEFORE dedup (`project` scope keeps entries whose `project` matches; `session` keeps matching `sessionId`; `everywhere` keeps all). Scan cap 100 entries post-dedup (`gDo`).
- `pastedContents` persists hash references (Task 5's cache holds the bodies), not content — history files stay small.

**Steps:**

- [ ] **Step 1: Failing tests** — append/read round-trip in temp root; newest-wins dedup (same display twice → one entry, newer timestamp); scope filters; corrupt middle line skipped; skip-env writes nothing; 150 appends → read returns 100.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — dedup keep-oldest instead of newest → dedup test MUST fail on the timestamp; restore.
- [ ] **Step 6: Commit** `f5(t6): history.jsonl at the fleet root — append-only, newest-wins dedup, scoped reads`

---

### Task 7: History navigation — persistence wired, edit cache, mode filter, label, hint

**Files:**
- Modify: `src/tui/editor.ts` (history model), `src/tui/ChatComposer.tsx` (seed + persist + label + hint), `src/tui/ChatApp.tsx` (thread `sessionId`/`project` if not already in reach)
- Test: `test/tui/history-nav.test.tsx` (new)

**Interfaces:**
- Consumes: Task 6's module; Task 2's `label` prop; Task 5's cache (chip restore).
- Produces: `EditorState.history` becomes `{ display: string; pastedContents?: … }[]`; state gains `histEdits: Map<number, string>` (per-index edit cache) and `histMode: "bash" | undefined` (mode filter latch). `ChatComposer` gains props `sessionId?: string`, `project?: string`.

**Behavior contract (bundle):**
- Seeding: on composer mount, `readHistory({scope:"project", project})` seeds the editor history (oldest-first order for our index model). In-session submits keep appending in memory AND to disk (`appendHistory` from `submitTurn`'s caller — the composer, where env/session context lives). Esc-Esc's `clearToHistory` also persists (upstream `cgr` does both, L395636/L317540).
- CM54 (L489594): editing a recalled entry stores the edit in `histEdits[index]`; arrowing away and back restores THE EDIT, not the original. The index-0 live-draft stash (existing `stash`) is unchanged. Any submit clears the map.
- CM55 (L489551): entering history navigation while the buffer is in bash mode (`!` prefix) latches `histMode:"bash"` and Up/Down walk only entries whose display starts with `!`; entering from normal mode walks only non-`!` entries? — NO: verify at L489551: the latch filters TO bash when entering from bash, and is `undefined` otherwise (unfiltered). Transcribe what the line says; the test pins the transcription.
- CM4 label (L494870): while navigating, the frame label is `History ${max(1, total − index + 1)}/${total}` under OUR index convention — transcribe `AVf` and adapt: index null → no label; **edited recalled entry → no label** (`historyEdited`); total = filtered history length.
- CM56 (L489545): after the 2nd consecutive Up press in one navigation run, a one-time (per composer mount) dim hint advertises history search: derive the chord — `` `${formatBindings(bindings("history:search"))} to search history` `` — NEVER a literal `ctrl+r` (F2 honesty rule; exact wording: transcribe the hint text at L489545 and keep its wording with the derived chord substituted).
- CM57 (L317525): recalling an entry with `pastedContents` rebuilds the chips: label text is already in `display`; map entries resolve through the paste cache; a missing hash rewrites that chip in the recalled buffer to `[Pasted text #N — content no longer available]` (L317398 verbatim).

**Steps:**

- [ ] **Step 1: Failing tests** — mount with temp fleet root pre-seeded with 3 project entries → Up recalls newest; edit + away + back preserves edit; bash-mode filter latch; label `History 2/3` in-frame, vanishing on edit; 2nd-Up hint appears once with the DERIVED chord (rebind test: a custom keymap changes the hint); recall of a chip entry with cache hit (chips + map restored) and with cache miss (lost-content literal).
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green** (editor history-shape change touches existing tests — migrate them).
- [ ] **Step 5: Sabotage** — return the original instead of the edit from the cache → edit-cache test fails; restore.
- [ ] **Step 6: Commit** `f5(t7): persisted history wired — edit cache, bash filter, History n/total, search hint, chip restore`

---

### Task 8: Queue semantics + the placeholder generator

**Files:**
- Modify: `src/tui/useChat.ts` (queue shape + drain op), `src/tui/ChatApp.tsx`, `src/tui/ChatComposer.tsx` (Up-drain + placeholder), `src/tui/prefs.ts` (`queuedUpHintSessions?: number`, `exampleFiles?: { files: string[]; at: number }`)
- Create: `src/tui/placeholder.ts` (pure generator + precedence)
- Test: `test/tui/queue-composer.test.tsx`, `test/unit/placeholder.test.ts` (new)

**Interfaces:**
- Consumes: existing queue rescue (F0 CM49 — `interrupt()` prepend-prefill), `savePrefs`/`loadPrefs`.
- Produces: `useChat`'s queue becomes `QueueEntry[]` — `{ value: string; mode: "prompt" | "bash"; priority: "now"; pastedContents?: PastedMap; origin: "user" }` (CM51's shape with the fields we can honestly fill; `priority` is always `"now"` for user submits today — carry the field, don't invent other values). New `popQueueToComposer(): string | null` — drains ALL entries (they are all editable/human-origin today), `\n`-joins values, returns the text (caller prefixes into the composer via the existing prefill seam).

```ts
// placeholder.ts
export function examplePool(files: string[]): string[];                    // MVf's 8 templates, L495095
export function pickPlaceholder(i: { inputEmpty: boolean; queueLen: number; upHintSessions: number; submitCount: number; hasMessages: boolean; pool: string[]; rand: () => number }): string | undefined;
export function exampleFiles(cwd: string, run: (cmd: string) => string): string[];  // git log harvest + denylist, L495082
```

**Behavior contract (bundle):**
- CM48 (L149094, L495505): `Up` on an EMPTY composer with a non-empty queue does NOT enter history — it drains every editable queued entry back into the buffer at once, `\n`-joined, cursor after the text. Escape already does the rescue (F0); Up joins it. The editor can't see the queue: ChatComposer takes a `queuePop?: () => string | null` prop; the Up handler consults it BEFORE `historyPrev` when the buffer is empty.
- CM47 (L495114, L495120): placeholder precedence `NVf` (L495107), first match wins: (1) input non-empty → none; (2) *(agent-view — n/a, skip with a comment)*; (3) queue non-empty AND `queuedUpHintSessions < 3` → **`Press up to edit queued messages`**; (4) `submitCount < 1 && !hasMessages` → the `Try "…"` string. Otherwise none. The sessions counter increments once per composer mount that SHOWS rule 3 (persisted in prefs).
- CM3 (L495095, L495082): pool templates verbatim: `fix lint errors`, `fix typecheck errors`, `` how does ${f} work? ``, `` refactor ${f} ``, `how do I log an error?`, `` edit ${f} to... ``, `` write a test for ${f} ``, `create a util logging.py that...` — `f` random from `exampleFiles` else the literal `<filepath>`. Harvest: `git log -n 1000 --pretty=format: --name-only --diff-filter=M` deduped, denylist filtered (transcribe the L495082 list: lockfiles/generated/config — quote it exactly in the impl), top 5, cached in prefs with `at`, refreshed when older than 604 800 000 ms. Rendered as `` Try "${pick}" `` — chosen ONCE per mount (stable across re-renders), first char inverted per Task 2.
- Queue rescue (F0) and drain both restore `pastedContents` maps into the composer state when entries carry them.

**Steps:**

- [ ] **Step 1: Failing tests** — placeholder precedence truth table (pure, all 4 rules + fallthrough); pool templates exact; Up-on-empty with 2 queued entries → composer holds `a\nb`, queue empty, history untouched; Up with text present → history as before; prefs counter increments across two mounts and rule 3 stops at 3; git harvest parses `\n`-separated names, dedups, filters, caps 5 (fake `run`).
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green** (queue-shape change: `state.queue` consumers — ChatApp's queued rows read `.value` now).
- [ ] **Step 5: Sabotage** — flip precedence 3/4 → truth-table fails; restore.
- [ ] **Step 6: Commit** `f5(t8): queue entries carry mode+pastes; Up drains the queue; the real placeholder ladder`

---

### Task 9: Autocomplete triggers + acceptance — Tab/Enter, wrap, empty state

**Files:**
- Modify: `src/tui/editor.ts` (trigger regexes, acceptance split, wrap), `src/tui/commandComplete.ts` (denylist), `src/tui/ChatComposer.tsx` (empty state string)
- Test: `test/tui/autocomplete-triggers.test.ts` (new)

**Behavior contract (bundle):**
- CM34 (`Pli`, L489935): slash trigger fires when the text before the cursor matches `/[\s。、？！]\/([a-zA-Z0-9._:-]*)$/` OR the head case (buffer starts with `/` and cursor inside that token). Cursor must sit at the token's end. The popup NO LONGER requires the `/` to be the first char of an empty buffer — `see /he` mid-text opens it. Denylist (L490128, verified): `add-dir`, `cd`, `resume`, `plugin`, `plugins`, `marketplace` never appear in suggestions (they still execute when typed fully).
- CM35 (`ARb`, L491153): `@` trigger regex `/(^|[\s。、？！])@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u` — path chars including `.` `/` `~` `:` parens/brackets, and quoted `@"my file.ts"` (accept inserts the quoted form when the path has spaces — L491112's `needsQuotes`).
- CM28 (L491083–L491119, XJa): **Tab accepts without executing** (commands: buffer becomes `/name ` popup closes; mentions: path inserted). **Enter accepts AND executes for commands** — verified: XJa submits unless the command is prompt-typed with declared args; our mapping: a catalog entry with `argumentHint` → Enter inserts `/name ` and does NOT submit; without → submits. **Enter on a file mention only accepts** (verified: the `H === "file"` branch never calls onSubmit) — fixes our current divergence where command-Enter submitted but mention-Enter's semantics were the accident of the reducer.
- CM29 (L491102): selection wraps (`index+1 ≥ len → 0`; `index−1 < 0 → len−1`) in both popups.
- CM38 (L490779): command empty state is `` No commands match "${input}" `` verbatim (mention empty state: check the bundle for the file equivalent at the DXe empty-message site; transcribe or fall back to no-popup).

**Steps:**

- [ ] **Step 1: Failing tests** — mid-text ` /he` opens command popup, `x/he` does not; CJK `。/he` opens; denylist names absent from items but a full `/resume` still submits; `@"my` holds the mention open across the space; Tab on command → `/model ` no submit; Enter on command without hint → submit `/model`; Enter on command WITH argumentHint → `/model ` inserted, no submit; Enter on mention → path inserted, no submit; wrap both directions in both popups.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement** (trigger scanning moves from `afterInsert`'s special cases to a per-edit scan of text-before-cursor — run in `syncCompletions` so motions retrigger correctly).
- [ ] **Step 4: Green** (existing editor tests pinning first-char-only `/` behavior get updated to the new contract).
- [ ] **Step 5: Sabotage** — drop the whitespace-precondition (any `/` triggers) → the `x/he` negative test fails; restore.
- [ ] **Step 6: Commit** `f5(t9): upstream trigger regexes + denylist; Tab=accept, Enter=execute-for-commands; wrapping selection`

---

### Task 10: Popup geometry, ghost text, inline argumentHint

**Files:**
- Modify: `src/tui/ChatComposer.tsx` (popup renderers → one `SuggestPopup`), `src/tui/editor.ts` (ghost-text derivation)
- Create: `src/tui/suggestPopup.tsx`
- Test: `test/tui/suggest-popup.test.tsx` (new)

**Behavior contract (bundle):**
- CM30 (`DXe` L432430, rows L432457, selection L432436): visible rows = `clamp(max(6, floor(rows/2)), 1, rows−3)` (rows from stdout, threaded like columns); the list is bottom-aligned and **blank-padded to the fixed height** so the composer row doesn't jump; scroll keeps the selection near the middle (walk up `floor(d/2)`, fill below, backfill); a row takes 2 terminal lines when the description doesn't fit `columns − nameCol − 4` (transcribe `a0H`'s exact budget); name column width = `min(max(name widths) + 6, floor(columns * 0.4))`; **selected row `color:"suggestion"`, unselected `dimColor`** (kill `inverse`); file rows render `` `${displayText} – ${description}` `` with an en-dash (L432520).
- CM36 (L490543, L394780): with a partial `/comm` and a unique-prefix best match, the REMAINING characters render dim inline after the cursor (ghost text) — derive `ghostText(state): string | undefined` in editor.ts (top-ranked item's name minus the typed partial when it startsWith the partial); Tab accepts the ghost even when the popup list is empty (`autocomplete:accept` path consults ghost before list).
- CM37 (L396283): once the buffer is a completed `/command ` (trailing space, command known), the command's `argumentHint` renders dim after the input text, truncated at the frame edge, preceded by a space unless the buffer ends in one.
- Empty-state and footer strings from Task 9 render through this component unchanged.

**Steps:**

- [ ] **Step 1: Failing tests** — geometry: with rows=24 the popup allocates 12 lines incl. blank padding (count frame lines while list has 3 items); selected row carries the `suggestion` color SGR and NO inverse; long description wraps the row to 2 lines; ghost: `/mod` shows dim `el` after cursor (given catalog `model`), Tab completes without submit; hint: `/model ` shows the argumentHint dim inline; en-dash in mention rows.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — remove blank padding → the fixed-height test fails; restore.
- [ ] **Step 6: Commit** `f5(t10): one popup — clamped height, mid-anchored scroll, suggestion-color selection; ghost text; inline argumentHint`

---

### Task 11: Async file completion + iterative directory descent

**Files:**
- Modify: `src/tui/fileComplete.ts` (dirs as candidates + async walk), `src/tui/ChatComposer.tsx` (debounce + stale guard), `src/tui/editor.ts` (dir-accept reopens)
- Test: `test/tui/file-complete-async.test.tsx` (extend/new)

**Behavior contract (bundle):**
- CM39 (L490600): the @-walk runs debounced **50 ms** after the query changes, async (injected readdir stays; wrap in a promise), with a **generation counter** — a stale completion (older generation resolving late) never overwrites newer results. First-open keeps the immediate walk (no 50 ms lag on open — verify: upstream debounces the QUERY-driven re-filter; the initial listing shows `Loading…`? transcribe DXe's `Loading…` empty state and use it while the first walk is in flight).
- CM40 (L490900 area, `reSuggest`): directories appear as candidates (`dir/` display with trailing slash); accepting a directory inserts `@dir/` and REOPENS the popup one level deeper (the mention stays open, query reset to empty at the new base) instead of closing. Files accept-and-close as today (trailing space, T6 smart-space rule owns following punctuation).
- The walk emits dirs AND files now — `collectFiles` gains `{ dirs: boolean }` or a sibling `collectEntries` returning `{ path, isDir }[]`; ranking treats dirs like files (fuzzyScore on path), cap unchanged.

**Steps:**

- [ ] **Step 1: Failing tests** — fake async readdir with controllable resolution: typing fast produces one walk per debounce window; a slow gen-1 resolving after gen-2 is discarded; `@src` shows `src/` dir candidate; accepting it → buffer `@src/`, popup still open listing `src/` children; accepting a file closes with trailing space.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — drop the generation guard → stale-result test fails; restore.
- [ ] **Step 6: Commit** `f5(t11): debounced async @-walk with stale guards; directories complete iteratively`

---

### Task 12: Both search UIs — inline reverse-i-search + picker preview pane

**Files:**
- Create: `src/tui/InlineHistorySearch.tsx` (or fold into ChatComposer if <100 lines)
- Modify: `src/tui/HistorySearchOverlay.tsx` (preview pane + responsive layout), `src/tui/ChatApp.tsx` (ctrl+r routing), `src/tui/commands.ts` (new local `/history` command opening the picker)
- Test: `test/tui/inline-history-search.test.tsx`, extend `test/tui/history-search.test.tsx`

**Behavior contract (bundle):**
- Routing (`yie() = MN() && ds()`, L…): upstream opens the FULL-SCREEN picker only in fullscreen layout; classic layout gets the inline search. Our REPL is permanently classic ⇒ **`history:search` (ctrl+r) now opens the INLINE search**; the picker overlay (existing) stays reachable via a new local command `/history` — record both the routing rationale and the `/history` addition in Task 13's parity notes.
- CM58 (`r9f` L489642, `xWf` L493443): the inline UI lives in the composer's hint row area: dim prompt **`search prompts:`** (failed match → **`no matching prompt:`**) + the query text. Matching walks history newest-first with `lastIndexOf(query.toLowerCase())`, deduped by display; each match **rewrites the composer buffer in place** with the cursor at the match offset. Keys are the existing `HistorySearch` context (bindings.ts:75 — already verbatim upstream): `ctrl+r` next-older match, `escape`/`tab` ACCEPT (keep buffer, exit search), `enter` execute (submit the match), `ctrl+c` cancel (restore the pre-search buffer), `ctrl+s` cycle scope. Entering search stashes the pre-search buffer; cancel restores it.
- CM59 (`qGf` L492153): the picker gains a preview pane — `borderStyle:"round"` + `borderDimColor`, 6 content lines of the selected prompt with a `+N more` dim tail; **side-by-side at ≥100 columns, stacked below otherwise**. Existing ranking/scope/age column stay.
- The inline search sources entries from Task 6's `readHistory` (scope-cycled), NOT the transcript-derived overlay loader — one history, both UIs (the overlay migrates to the same source; `historySearch.ts`'s transcript path stays only if the overlay still needs pre-F5 sessions — DECIDE in-task: migrate both to `history.jsonl` and record that pre-F5 prompts drop out of search).

**Steps:**

- [ ] **Step 1: Failing tests** — ctrl+r (via keymap dispatch) opens inline, NOT the overlay; typing filters and rewrites the buffer to the newest match; second ctrl+r walks older; esc keeps the match in the buffer; ctrl+c restores the original draft; enter submits; `no matching prompt:` on a miss; `/history` opens the overlay; overlay ≥100 cols shows the bordered preview beside the list with `+N more`.
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Sabotage** — make esc cancel instead of accept → the esc-accepts test fails (this is the surprising upstream semantic worth guarding); restore.
- [ ] **Step 6: Commit** `f5(t12): ctrl+r is the inline reverse-i-search; picker gets the preview pane + /history`

---

### Task 13: Wave close — acceptance pins, parity re-score

**Files:**
- Create: `test/tui/f5-acceptance.test.tsx`
- Modify: `docs/parity/tui-ux.md` (§1 re-score + F5 section), `docs/parity/coverage.md` (TUI row), spec `## Revision Notes` if any task overturned it

**Steps:**

- [ ] **Step 1: Acceptance test file** — the spec's F5 acceptance, phrased as tests (all keyless):
  1. Pasting 40 lines inserts `[Pasted text #1 +40 lines]`; ONE backspace deletes the whole chip; submitting with the chip present hands `onSubmit` the full 40 lines.
  2. History survives relaunch: append via composer submit under temp fleet root, remount a fresh composer with the same root → Up recalls it; the same prompt sent twice appears once (newest first); editing a recalled prompt, arrowing away and back preserves the edit.
  3. Typing `/mod` shows dim ghost text; Tab accepts without submitting; Enter (command without argumentHint) accepts and submits.
  4. Accepting `@src/` in the file popup reopens the popup one level deeper instead of closing it.
  5. The composer has a rule above and below and no side borders; `❯` dims while a turn runs; arrowing history writes `── History 3/57 ──`-form label into the top rule and hides it once the entry is edited.
- [ ] **Step 2: Full gates** — `npm run typecheck && npm run build && npx vitest run test/tui test/unit`.
- [ ] **Step 3: Parity docs** — tui-ux.md: new "## F5 (2026-08-04) — the composer" section (now-faithful / divergences / open-evidence-gaps incl.: history.jsonl + paste-cache live under the fleet root not `~/.claude` (deliberate); appendFileSync not a file lock; ctrl+r routing rationale (classic layout ⇒ inline) + `/history` as a recorded addition; pre-F5 prompts absent from history search if Task 12 migrated the source; CM6/CM7 recorded unreachable per spec; CM19 shift+enter delivered only via terminals that send ESC-CR). Re-score §1 rows CM-by-CM. coverage.md TUI row updated with one honest sentence.
- [ ] **Step 4: Commit** `f5(t13): acceptance pins + parity re-score`

---

## Self-review notes (writing-plans checklist applied)

- Spec coverage: CM21–27 (T3/T4/T5), CM52–57 (T6/T7), CM47/48/51 (T8), CM1–5/8*/12/14/17/18/20 (T1/T2 — *CM8 external-editor indicator: T2's frame owns the rendering slot; the async-spawn conversion is folded into T2 step 3 IF trivial, else recorded in tui-ux.md as an open gap rather than half-shipped — decide in-task, the current spawnSync path stays correct either way), CM28–30/34–40 (T9/T10/T11), CM58/59 (T12). Non-goals honored: no vim, no images, no mouse, no highlight spans, no emoji/Slack/MCP sources, CM6/CM7 unreachable.
- Types consistent: `PastedMap` defined once (T1), consumed T3–T8; `QueueEntry` (T8) consumed by ChatApp rows; `HistoryEntry` (T6) consumed T7/T12.
- Every task independently testable + committable; no placeholders; exact strings quoted or explicitly ordered transcribed-from-bundle at a cited line.
