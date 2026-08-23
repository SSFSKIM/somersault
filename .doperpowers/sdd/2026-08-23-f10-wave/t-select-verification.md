# F10 T-SELECT — Task 9 track verification

Run from `CC-to-SDK/harness/` inside worktree `/Users/new/Developer/GitHub/codex_somersault/.claude/worktrees/f10-select`.
Node v24.18.0.

## STATUS: DONE

All gates, the whole keyless pty matrix, the credentialed corroboration cell, acceptance cells 1-5, and the
eight sabotage-guard mutations are green/confirmed. The parity-doc rows are updated. This note supersedes an
earlier BLOCKED draft: the first pass hit a failing `caret-wrap` pty cell at head `cc4e4ed943`, which the wave
controller diagnosed as **two bugs in this task's own harness script** (`scripts/select-pty.sh`), not an
application regression — full root cause in
`.doperpowers/sdd/2026-08-23-f10-t-select/caret-wrap-fix-report.md`. Fix commit `1a39b8da5a` touches only
`CC-to-SDK/harness/scripts/select-pty.sh`.

## Two heads in this note

- **`cc4e4ed943`** — "f5(f10-select): S5 — extend past the window edge scrolls by one" — the head the four
  full gates (9.1) ran against. Since the fix commit changes only the pty test-harness script and no
  application source, typecheck/build/test:unit/test:tui results from this head remain valid unchanged.
- **`1a39b8da5a`** — "f5(f10-select): fix caret-wrap pty cell — harness leak + polling race, not a caret
  regression" — the head the pty matrix (9.2), the credentialed cell, acceptance cells, and the sabotage
  guards (9.3-9.8) ran against.

## 9.1 — Full gates (head `cc4e4ed943`)

All four commands run individually (never bare `npm test`), each clean.

### `npm run typecheck`
```
> cc-harness@0.1.0 typecheck
> tsc --noEmit
```
(no output — clean)

### `npm run build`
```
> cc-harness@0.1.0 build
> tsc -p tsconfig.build.json
```
(no output — clean)

### `npm run test:unit`
```
 Test Files  239 passed (239)
      Tests  3325 passed (3325)
   Start at  03:05:44
   Duration  191.16s (transform 2.21s, setup 910ms, collect 20.62s, tests 143.86s, environment 18ms, prepare 5.63s)
```

### `npm run test:tui`
```
 Test Files  179 passed | 9 skipped (188)
      Tests  4550 passed | 9 skipped (4559)
   Start at  03:08:59
   Duration  141.35s (transform 2.20s, setup 642ms, collect 31.14s, tests 88.58s, environment 14ms, prepare 4.33s)
```
The 9 skipped files are the pre-existing `test/tui/live/*.e2e.test.ts` suite (credential-gated live e2e,
unrelated to this track).

Verdict: **all four gates green.**

## 9.2 — Whole pty matrix (head `1a39b8da5a`)

`bash scripts/select-pty.sh` (no `SELECT_PTY_CELLS`), verbatim output:

```
F10 T-SELECT S1 — the caret-origin pty harness (FULLSCREEN renderer, CLAUDE_CODE_NO_FLICKER=1)
  building ccx (dist/) …
  cell caret-wrap (keyless): 100x30, a 140-char draft wraps, click the continuation, submit, check the echo
      ok   caret-wrap: Z landed inside the wrapped continuation's own content
  PASS caret-wrap
  cell caret-busy (keyless, via fake-host.mjs): attach against a fake host pushing turn-start + 3 tasks
      ok   caret-busy preconditions: task panel + live-turn spinner both painted
      ok   caret-busy: the click during a busy turn + open task panel repositioned the caret
  PASS caret-busy
  SKIP caret-busy-live: no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment.
  cell word-drag (keyless): !echo stages 'alpha beta gamma', double-click alpha, drag into gamma
      ok   word-drag: the selectionBg run covers all of 'alpha beta gamma', one contiguous span
      ok   word-drag: the OSC 52 payload base64-decodes to exactly 'alpha beta gamma'
  PASS word-drag
  cell extend-chords (keyless): !echo stages 'alpha beta gamma'; shift+right/shift+end; fall-through; keybindings.json override
      ok   extend-chords: the initial sweep covers exactly 'alph'
      ok   extend-chords: shift+right grew the span by exactly one column ('alph' -> 'alpha')
      ok   extend-chords: shift+end reached the row's own end
      ok   extend-chords: shift+left with no selection fell through to the composer ('aXb')
      ok   extend-chords: the rebound alt+right chord copied exactly 'gamma' (keybindings.json override reached a real handler)
  PASS extend-chords
  cell stream-shift (keyless, via fake-host.mjs) arm 1: held sweep on a row, document shifts under it
      ok   stream-shift arm1: the selectionBg run is still on LN04, now at row 1 (was 4) — not whatever now occupies row 4
      ok   stream-shift arm1: the OSC 52 payload base64-decodes to exactly the swept 'LN04'
  cell stream-shift (keyless, via fake-host.mjs) arm 2: a delta lands ABOVE a sweep on a QUEUED row
      ok   stream-shift arm2: the highlight still covers 'alpha' after two deltas land above the queued row
  PASS stream-shift
  cell autoscroll-capture (keyless): !seq 1 120, jump to the top, drag past the bottom edge and hold ~1.5s
      ok   autoscroll-capture: row 40 is now painted — off-screen at press time (max visible then was 5)
      ok   autoscroll-capture: the OSC 52 clipboard contains 15 — off-screen at press time, absent from the pre-press snapshot (max was 5)
  PASS autoscroll-capture

select-pty: 6 passed, 0 failed
ok
```

### Credentialed corroboration: `caret-busy-live`

`set -a; . ../.env; set +a; SELECT_PTY_CELLS=caret-busy-live bash scripts/select-pty.sh` (token never printed
or written; only the cell's own pass/fail output captured):

```
F10 T-SELECT S1 — the caret-origin pty harness (FULLSCREEN renderer, CLAUDE_CODE_NO_FLICKER=1)
  building ccx (dist/) …
  cell caret-busy-live (live, forwarding $CLAUDE_CODE_OAUTH_TOKEN): a real turn, click the first draft line while it streams
      ok   caret-busy-live: the click during a real streaming turn repositioned the caret
  PASS caret-busy-live

select-pty: 1 passed, 0 failed
ok
```

`caret-busy-live` ran in its **real, credentialed form** (a genuine model turn), not the credential-gated
fallback escape hatch from step 1.21a — it is corroboration for the already-keyless `caret-busy` cell, not a
substitute for it.

## 9.3 — Acceptance cell 1, as written

*"Busy caret (pty): mid-busy-turn and with the task panel open, clicking a character in the composer moves
the caret to it; with a draft wrapped ≥ 2 physical rows, clicks land on the correct wrapped row."*

| Clause | Evidence | Verdict |
|---|---|---|
| Mid-busy-turn + task panel open, click moves the caret | `caret-busy` (keyless fake host): preconditions asserted (task panel + live-turn spinner both painted) BEFORE the click, then the click repositioned the caret | PASS |
| Corroboration under a real turn | `caret-busy-live`: click during a real streaming turn repositioned the caret | PASS |
| Wrapped draft (≥2 rows), click lands on the correct wrapped row | `caret-wrap`: 140-char draft wraps to 2 rows at 100 cols, click on the continuation row, submit, echo confirms `Z` landed inside the wrapped continuation's own content | PASS |
| Ink mounts / inverted cells | `test/tui/dockOrigin.test.tsx` (20 tests, incl. both footer-statusLine occupant-matrix caret cells) and `test/tui/clickCaret.test.tsx` (15 tests) both pass | PASS |

**Acceptance cell 1: PASS**, all four clauses independently confirmed, preconditions asserted (not merely assumed) before scoring.

## 9.4 — Acceptance cell 2, as written

*"Dead-drag fixed (pty + unit): double-click a word, drag right two words → selection covers all three whole
words; release toast contains their text."*

| Clause | Evidence | Verdict |
|---|---|---|
| pty: double-click `alpha`, drag into `gamma` → contiguous 3-word span | `word-drag`: selectionBg run covers all of `alpha beta gamma`, one contiguous span | PASS |
| pty: release toast/clipboard contains the three words' text | `word-drag`: OSC 52 payload base64-decodes to exactly `alpha beta gamma` | PASS |
| unit: first-word-to-third-word drag | `test/tui/selection.test.ts`'s `dragToSpanned` block — "double-click the FIRST word and drag into the THIRD covers all three (acceptance cell 2's shape)" — passes; the mid-span `beta`→`gamma` cells (also present) are the pivot's own coverage, scored separately, not counted toward this clause | PASS |
| unit: paint | `test/tui/selectionPaint.test.tsx`'s S2 block ("a drag after a double click extends by whole words") passes | PASS |

**Acceptance cell 2: PASS.**

## 9.5 — Acceptance cell 3, as written

*"Selection survives streaming (viewport test + pty): sweep, streamed delta lands above it → painted
highlight covers the same characters; re-wrap-narrower and partial-slice unit cells land on the same text."*

| Clause | Evidence | Verdict |
|---|---|---|
| pty arm 1: held sweep survives a document shift | `stream-shift` arm1: selectionBg run still on `LN04` at its new row, OSC 52 confirms swept text unchanged | PASS |
| pty arm 2: queued-row sweep survives a delta landing genuinely above it | `stream-shift` arm2: highlight still covers `alpha` after two deltas land above the queued row | PASS |
| unit: streamed-delta-during-sweep | `test/tui/selectionRemap.test.tsx` — "streamed-delta-during-sweep: a growing streaming tier does not disturb an in-progress (unreleased) drag on a queued row" — passes | PASS |
| unit: re-wrap-narrower | same file — "re-wrap narrower: a smaller `columns` re-flows the item, and the highlight follows its word to the new row" — passes | PASS |
| unit: blank-line survival | same file — "readme / blank / a long tail: re-wrapping narrower reflows the tail into several rows, the copy stays byte-identical" — passes | PASS |
| unit: partially-sliced gutter block | same file — "partially-sliced gutter block: scroll to reveal earlier rows, then back — the still-visible row stays put" — passes | PASS |

**Acceptance cell 3: PASS**, both pty arms and all four named unit cells independently confirmed.

## 9.6 — Acceptance cell 4, as written

*"Extend chords (keymap tests + pty): shift+right grows one column; shift+end to line end;
`keybindings.json` rebind of `selection:copy` honored; without a selection shift+arrows reach the composer."*

| Clause | Evidence | Verdict |
|---|---|---|
| pty: shift+right grows span by one column | `extend-chords`: "shift+right grew the span by exactly one column ('alph' -> 'alpha')" | PASS |
| pty: shift+end to line end | `extend-chords`: "shift+end reached the row's own end" | PASS |
| pty: `keybindings.json` rebind honored | `extend-chords`: "the rebound alt+right chord copied exactly 'gamma' (keybindings.json override reached a real handler)" | PASS |
| pty: no selection, shift+arrows fall through to composer | `extend-chords`: "shift+left with no selection fell through to the composer ('aXb')" | PASS |
| keymap unit tests | `test/tui/keys-bindings.test.ts` (70 tests) and `test/tui/keys-user-bindings.test.ts` (53 tests) pass | PASS |
| unit: extend behavior + persistence | `test/tui/selectionExtend.test.tsx` (8 tests) passes, including its three named persistence cells: "shift+right, then an unrelated publish... the extension survives"; "shift+right x3, then a narrower re-wrap... still covers the same characters"; "shift+down, then an unrelated publish... survives the very next remap" | PASS |

**Acceptance cell 4: PASS**, including the persistence cells the brief calls out as the ones that actually meet this clause (an extension that doesn't survive the next publish/re-wrap would not).

## 9.7 — Acceptance cell 5, as written

*"Auto-scroll capture (pty): drag to the bottom edge, hold → viewport scrolls; on release the clipboard
contains text never on screen during the press."*

| Clause | Evidence | Verdict |
|---|---|---|
| pty: drag to bottom edge + hold scrolls the viewport | `autoscroll-capture`: "row 40 is now painted — off-screen at press time (max visible then was 5)" | PASS |
| pty: release clipboard contains text never on screen during the press | `autoscroll-capture`: "the OSC 52 clipboard contains 15 — off-screen at press time, absent from the pre-press snapshot (max was 5)" | PASS |
| unit | `test/tui/selectionAutoScroll.test.tsx` (9 tests) and `test/tui/selectionCapture.test.ts` (5 tests) pass | PASS |

**Acceptance cell 5: PASS.**

## 9.8 — Sabotage guards, re-run as a set

Each mutation applied directly to source (never to test files), the named test file(s) re-run to confirm
red, `git checkout --` to revert, then re-run to confirm green. All eight confirmed.

| # | Mutation | Site | Cell/tests that reddened | Reverted + green? |
|---|---|---|---|---|
| 1 | `footerRows + 1` (1.23) | `src/tui/composerRows.ts:69` — `i.footerRows` → `(i.footerRows + 1)` in `bufferBottom`'s computation | `composerRows.test.ts` + `dockOrigin.test.tsx` + `clickCaret.test.tsx`: 252/291 tests failed, incl. dockOrigin's own occupant-matrix caret-click cells | Yes — 291/291 pass after revert |
| 2 | `dragToSpanned` pivot vs. the at-`span.lo` cell (2.8) | `src/tui/mouse/selection.ts:159` — `cell.col < span.lo.col` → `cell.col <= span.lo.col` | `selection.test.ts`: exactly 1 test failed — "a drag onto the span's OWN low column is INSIDE it, not before it — the `<` boundary itself" (expected `null`, got `{row:1,col:7}`) | Yes — 37/37 pass after revert |
| 3 | `sourceRowRanges`' `sep` forced to 0 (4.9) | `src/tui/wrapItems.ts:88` — `const sep = h + 1 < hard.length ? 1 : 0;` → `const sep = 0;` | `sourceRanges.test.ts`: 5/28 tests failed (blank-line ownership, trailing-`\n` charging) | Yes — 28/28 pass after revert |
| 4 | `sourceEndpointAt`'s probed `charEnd` (4.9) | `src/tui/mouse/hitmap.ts:145` — `charEnd: Math.max(start, toSource(hit.charEnd))` → `charEnd: toSource(hit.charStart + 1)` | `hitmap.test.ts`: 2/21 failed — the ZWJ-emoji cell (`"👩‍💻"`) per drift note 8b's r3 correction, plus the combining-mark cell | Yes — 21/21 pass after revert |
| 5 | `containsUpper` collapsed onto `containsLower` (5.5) | `src/tui/mouse/address.ts:46` — upper's `<`/`<=` swapped to match lower's `<=`/`<` | `selectionAddress.test.ts` + `selectionRemap.test.tsx`: 4/49 failed (upper-endpoint-at-`\n`-boundary cells, backward-drag-across-soft-wrap cell) | Yes — 49/49 pass after revert |
| 6 | `remapSelection` as a no-op (6.7) | `src/tui/mouse/address.ts:194` — early `return "ok";` before any state write-back | `selectionRemap.test.tsx` + `selectionCapture.test.ts`: 7/15 failed (streamed-delta, backward-drag, capture cells — all read a stale, unremapped selection) | Yes — 15/15 pass after revert |
| 7-9 | `AUTOSCROLL_ROWS = 1`, `AUTOSCROLL_MS = 100`, `AUTOSCROLL_MAX_TICKS = 201` (8.9) | `src/tui/FullscreenViewport.tsx:315-317` — all three constants changed together | `selectionAutoScroll.test.tsx`: 5/9 failed, incl. the file's own explicit "F10 S6 — sabotage: the tick constants are load-bearing, not decorative" cell | Yes — 9/9 pass after revert |

All eight mutations turned their named cell red; none was a no-op guard. Working tree confirmed clean
(`git status --short` empty, `git diff --stat` empty) after every revert — no stray `.bak` files, no leftover
edits.

## 9.9 — Parity-doc rows

Both edited in `CC-to-SDK/docs/parity/tui-ux.md`:

- **K22** (line 1826, the `Scroll` context row): flipped 🟡 → ✅. Recorded: the `selection:clear` named
  action (declared, unbound, matching canon's own choice), the six keyboard extend chords, and the
  `Scroll`-scoped copy chords (`ctrl+shift+c`/`cmd+c`) all now ship in a dedicated `Scroll` context. Recorded
  the two deliberate divergences (per-row `x1`/`x2` wrap bounds instead of canon's uniform scope column;
  identity remap instead of canon's screen-delta translation) and the non-CSI-u unreachable-chord caveat for
  `ctrl+shift+c`/`cmd+c`.
- **§2 mouse-class row** (line 1985, "Mouse in fullscreen (`D7`-`D9`)"): appended a note that `K22`, named
  as a member of this class in the row's own text, is now ✅ per the above, with a pointer back to §1a's `K22`
  row for the divergences/caveat. This row's own score (🟡) and its own residue (click-to-caret's
  `dockCrowded` fail-safe gate) are unchanged — that residue is outside this track's scope.

## Residue / concerns

None outstanding for this track. One process note for the wave controller: the wave-ledger directory
(`.doperpowers/sdd/2026-08-23-f10-wave/`) sits under a blanket `*` `.gitignore` rule; the file is committed
with `git add -f` per the wave controller's explicit instruction and the T-HOVER precedent.
