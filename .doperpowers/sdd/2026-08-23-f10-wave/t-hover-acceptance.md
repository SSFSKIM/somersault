# F10 T-HOVER — track acceptance (Task 4)

Branch `f10-hover`, worktree `.claude/worktrees/f10-hover`, head `5e1f57b7b2`. This is verification only —
no product code touched. All commands run from `CC-to-SDK/harness` inside the worktree.

## Step 1 — gates

| gate | command | result |
|---|---|---|
| typecheck | `npm run typecheck` | clean |
| build | `npm run build` | clean |
| unit | `npm run test:unit` | **239 files / 3326 tests passed**, 0 failed |
| tui | `npm run test:tui` | **173 files / 4234 tests passed, 10 skipped (11 tests)** — skips are the pre-existing live/e2e suites gated on `ANTHROPIC_API_KEY`/OAuth token, unrelated to this track |

All four gates green on the branch head as-is.

## Step 2 — acceptance cell 6 (message hover), verbatim from the spec

> 6. **Message hover** (ink producer matrix + pty): hovering any line of a multi-line message un-dims every
>    dim line of that message and none of its neighbors — asserted per producer species (SDK multiline,
>    local event, gutter block, wrapped, streaming, `reid` part); no transcript row changes background on
>    hover.

### (a) `hover-owner` — every named species cell by name

**Filter caveat, recorded rather than silently worked around:** the brief's literal command,
`npm run test:tui -- hover-owner`, does **not** narrow the run — `test:tui` is `vitest run test/tui`, so the
npm-appended `hover-owner` argument becomes a *second* vitest CLI filter OR'd against `test/tui`, and every
file path already contains `test/tui`, so the full 173-file suite runs regardless of the second token
(verified directly: `npx vitest run test/tui hover-owner` also produces 173 files/4234 tests, byte-identical
counts to the unfiltered gate run). The default reporter also does not print individual test names for a
passing file, so the literal command's output cannot show the named cells the brief asks for. Used the
working equivalent instead — `npx vitest run hover-owner --reporter=verbose` (a case where "hover-owner"
alone is not a substring of any other test file path) — which exercises exactly `test/tui/hover-owner.test.tsx`
and nothing else. This is a tooling/invocation gap, not a code defect; flagged as a concern below.

```
✓ test/tui/hover-owner.test.tsx > H1 producer matrix — every transcript species mints ONE ownerKey per message/call
  ✓ every line of one multi-line assistant message shares ONE ownerKey                              [cell a — SDK multiline]
  ✓ two adjacent messages never share an ownerKey                                                    [cell b — adjacent-messages distinctness]
  ✓ every line of one multi-line local event shares ONE ownerKey                                     [cell c — local event]
  ✓ a tool call's header line and its result gutter-block share ONE ownerKey                         [cell d — gutter block]
  ✓ every wrap fragment of an over-wide row keeps its source item's ownerKey                          [cell e — wrapped]
  ✓ an open call's pending owner and its settled owner are each internally grouped and mutually distinct [cell f — pending-projection, NOT streaming]
  ✓ every reid part of one Agent unit shares one ownerKey: header, nested header, and nested body     [cell g — reid part]
  ✓ an active fold group's row and its pending-hint gutter-block share ONE ownerKey                   [cell h — fold group]
  ✓ each agent-batch member owns its row and its ⎿ status row; the header is its own unit             [cell k — agent batch, member+header]
  ✓ the PENDING copy of a batch shares no owner with the published one                                [cell k — agent batch, pending vs published]
  ✓ every line and every wrap fragment of the in-flight message shares ONE ownerKey                   [cell l — LIVE STREAMING, real tier]
  ✓ two successive in-flight messages are distinct units                                              [cell l — live streaming]
  ✓ LiveTurn.messageKey() changes on message_start and never returns undefined                        [cell l — live streaming]
  ✓ a multi-line queued prompt is ONE hover unit and two entries are two                               [cell m — queued prompt]
  ✓ draining the hovered head entry retires its ownerKey rather than handing it to the next            [cell m2 — r3 drain cell]
  ✓ a removal from the MIDDLE leaves the survivors' owners untouched                                   [cell m2 — r3 drain cell, sibling]
✓ test/tui/hover-owner.test.tsx > H1: nothing reaches the renderer without an ownerKey
  ✓ every RenderItem of every tier carries an ownerKey                                                 [cell i — escape-nothing, all four tiers]
  ✓ every RenderItem literal in toolRenderer.tsx mints an ownerKey                                     [cell j — source-shape guard 1/3]
  ✓ every RenderItem literal in streamingItems.ts mints an ownerKey                                    [cell j — source-shape guard 2/3]
  ✓ every RenderItem literal in ChatApp.tsx mints an ownerKey                                          [cell j — source-shape guard 3/3]
✓ test/tui/hover-owner.test.tsx > H1: the real FullscreenViewport groups every tier by owner
  ✓ the painted hitmap groups finalized, pending, streaming, and queued rows by message                [cell n — the real viewport, mounted]

Test Files  1 passed (1)
     Tests  21 passed (21)
```

Cell-letter labels above are transcribed directly from `test/tui/hover-owner.test.tsx`'s own inline `// (x)`
comments (verified by reading the file, not inferred from test prose). Per the brief's rule, "streaming" is
satisfied **only** by cell (l) (`LIVE STREAMING — streamingItems.ts, THE REAL TIER`, three tests) and cell (n)
(the real, mounted `FullscreenViewport`, one test) — the pending-projection cell (f) is present and passing
but is explicitly a different thing (an open tool call's pending-vs-settled owner, not the streaming tier) and
is not counted toward "streaming." All named requirements present: SDK multiline, local event, gutter block,
wrapped, `reid` part, agent batch (member and header), live streaming, queued prompt, the r3 drain cells (m2)
and their mounted counterpart (proven by cell n's inclusion of the queued tier), adjacent-messages
distinctness, all three source-shape guards, the escape-nothing cell over all four tiers, and the
real-viewport cell (n). All 21/21 green.

### (b) `hover` — live un-dim + background negation

Same filter caveat applies to the literal `npm run test:tui -- hover` command (also runs the full suite via
the OR'd `test/tui` token). Used `npx vitest run hover.test.tsx --reporter=verbose`, which (as a side effect
of substring matching) also picked up `popup-hover.test.tsx` since `"popup-hover.test.tsx"` contains the
substring `"hover.test.tsx"` — both files' full named output is below; `hover.test.tsx`'s cells satisfy this
step, `popup-hover.test.tsx`'s satisfy Step 3.

```
✓ test/tui/hover.test.tsx > H1: no transcript row ever changes background on hover
  ✓ no transcript row changes background on hover — canon's Ssi never reaches a background (L203984)   [the negation cell]
✓ test/tui/hover.test.tsx > H1: message-level hover grouping over a multi-line local event
  ✓ hovering ANY line of a multi-line message un-dims EVERY dim line of it and none of its neighbors     [the live un-dim cell]

Test Files  2 passed (2)   [hover.test.tsx + popup-hover.test.tsx together]
     Tests  52 passed (52) [16 + 36]
```

Both required cells present and green: the live "un-dims every dim line and none of its neighbors" cell, and
the "no transcript row changes background" negation.

### (c) `bash scripts/hover-cells.sh` cell `h1`

Ran the real script unmodified:

```
hover-cells: h1 h2
  cell h1: /status hover un-dims, then restores off-block
  PASS h1
  cell h2: palette hover swaps rows, arrows take it back, click accepts
  PASS h2

hover-cells: 2 passed, 0 failed
```

The script only prints `capture-pane -e` excerpts on **failure**, so — without modifying the script — a
standalone driver was written (`/tmp/hover-evidence-capture.sh`, scratch-only, not part of the repo) that
replicates `run_h1_cell`'s exact launch/settle/`sgr_motion` sequence against the same real `dist/cli/bin.js`
binary and unconditionally dumps the before/after captures. Run separately from, and in addition to, the real
gate above (which is the authoritative PASS/FAIL).

**Before hover** (dim-row count 12; `cat -v`, raw SGR visible as `^[`):
```
^[[1mStatus^[[0m
^[[2m  model      claude-opus-5^[[0m
^[[2m  mode       auto^[[0m
^[[2m  thinking   default^[[0m
^[[2m  effort     xhigh^[[0m
^[[2m  context    0% used^[[0m
^[[2m  cwd        /private/tmp/hover-evidence-.../hc-ev-h1-.../proj^[[0m
^[[2m  renderer   fullscreen (env_on) ...^[[0m
^[[2mAuto mode lets Claude handle permission prompts automatically ... Claude checks each tool call for ^[[0m
^[[2mrisky actions and prompt injection before executing. Actions Claude identifies as safe are executed,
 while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal
 for long-running tasks. Sessions are slightly more expensive. Claude can make mistakes that allow ^[[0m
^[[2mharmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change
mode.^[[0m
```

**After hovering the `/status` block's second row** (dim-row count 5 — every field of the `Status` block
lost its `\x1b[2m` run; the unrelated "Auto mode..." paragraph below stays dim, proving the un-dim is
scoped to the hovered message and does not bleed into neighbors):
```
^[[1mStatus^[[0m
  model      claude-opus-5
  mode       auto
  thinking   default
  effort     xhigh
  context    0% used
  cwd        /private/tmp/hover-evidence-.../hc-ev-h1-.../proj
  renderer   fullscreen (env_on) ...
^[[2mAuto mode lets Claude handle permission prompts automatically ... Claude checks each tool call for ^[[0m
^[[2mrisky actions and prompt injection before executing. Actions Claude identifies as safe are executed,
 while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal
 for long-running tasks. Sessions are slightly more expensive. Claude can make mistakes that allow ^[[0m
^[[2mharmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change
mode.^[[0m
```

Moving the pointer off the block restored dim-row count to 12 (byte-identical to "before"). No `48;2;`
background byte appeared anywhere in any of the three captures (grepped directly), confirming the band
negation the script itself also asserts.

## Step 3 — acceptance cell 7 (popup hover, CM33), verbatim from the spec

> 7. **Popup hover, CM33** (ink + frame-output pin + pty): hover a suggestion row → highlights as selected
>    while keyboard selection is elsewhere; arrow → keyboard wins; click → accepted by absolute index; the
>    hit region matches actual frame output for 1- and 2-line rows.

### (a) `popup-hover` — four named behaviours + frame-output pin for both row shapes

(Same file as captured under Step 2(b)'s combined run.)

```
✓ test/tui/popup-hover.test.tsx > popupHitRegion / popupRowAt — derived FORWARD from dockTop
  ✓ derives rows FORWARD from dockTop — the palette is the dock's first child, never above it
  ✓ a 2-line row consumes two terminal rows and both resolve to it
  ✓ columns honour the popup's own paddingX=2, inclusive, 1-based
  ✓ top = 0 is NOT ADDRESSABLE — every cell misses
  ✓ a pane too narrow for the padding publishes no rows rather than an inverted range
  ✓ the window's rows are the SCROLLED window's, so index P is window-relative
✓ test/tui/popup-hover.test.tsx > setSuggestionIndex — the click path's first half        (4 tests, all pass)
✓ test/tui/popup-hover.test.tsx > EditorResult.suggestionNav — ... not an index diff       (10 tests, all pass)
✓ test/tui/popup-hover.test.tsx > SuggestPopup — hit region + hover semantics (mounted directly)
  ✓ (1) renders the HOVERED row as selected while the keyboard selection sits elsewhere — canon `A ?? k`   [behaviour 1 — hover highlights]
  ✓ (2) a hover on another row leaves `selected` untouched — no onSelect, no index change                 [behaviour 2 — hover ≠ keyboard cursor]
  ✓ (3) a press on window row P calls onSelect with windowStart + P, not P                                [behaviour 3 — absolute index]
  ✓ (4) a motion outside the region clears the hover — container-leave
  ✓ (5a) publishes an empty region and answers nothing when the consumer supplied no onSelect
  ✓ (5b) the inline (classic) popup is dead too — no hitTop means no region
  ✓ (6) a stale hoveredId falls back to the keyboard selection rather than highlighting nothing
  ✓ (7) region.rows[i] names the terminal row the frame actually painted item i on — 1- and 2-line rows    [behaviour 4 — frame-output pin, BOTH shapes]
✓ test/tui/popup-hover.test.tsx > CM33 live wiring — ChatApp + ChatComposer + the real mouse sink
  ✓ ARROWS CLEAR HOVER — the keyboard takes the highlight back (L602029/L602031)
  ✓ A ONE-ITEM POPUP CLEARS ON AN ARROW TOO — proved by what the WIDENED list highlights
  ✓ ENTER STILL ACCEPTS THE KEYBOARD PICK while another row is hovered
  ✓ A CLICK ACCEPTS BY ABSOLUTE INDEX — the row under the pointer, scrolled window included
  ✓ SETTER BAILS WHEN UNCHANGED (L602033) — repeated motion inside one row paints no new frame
  ✓ LEAVING THE POPUP CLEARS — a motion over the transcript un-highlights the hovered row
  ✓ dead under scroll mode — CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1 leaves the popup byte-identical
  ✓ a popup press does not also start a transcript selection or move the caret

Test Files  1 passed (1)  [popup-hover.test.tsx alone: 36/36]
     Tests  36 passed (36)
```

Read test (7)'s body directly to confirm the frame-output pin genuinely exercises **both** row shapes in one
cell: it mounts once with three 1-line items and asserts `frame1[y]` contains each row's id at the offset
`region.rows` predicts, then mounts a second popup where `rowLines(item, 80, 12) === 2` is asserted as a
premise (a deliberately long description forcing wrap to two lines) and repeats the same frame-vs-region walk
against `frame2`/`region2`. Both shapes verified against real Ink frame output, not just the pure model.

### (b) `bash scripts/hover-cells.sh` cell `h2`

Part of the same real script run recorded under Step 2(c): `PASS h2`. Standalone before/after captures
(same driver, `/tmp/hover-evidence-capture.sh`):

**Before hover** (palette open, `/model` keyboard-selected — blue, `/compact` dim):
```
  /model                        <name> — switch model (no arg shows current)     [truecolor 177;185;249, NOT dim]
  /compact                      compact the conversation context                  [dim ^[[2m]
  /context                      show context-window usage                         [dim]
  /cost                         show session cost + token usage                   [dim]
  /status                       show model · mode · context · session             [dim]
```

**After hovering the `/compact` row**:
```
  /model                        <name> — switch model (no arg shows current)     [dim ^[[2m — lost selection color]
  /compact                      compact the conversation context                  [truecolor 177;185;249, NOT dim — gained it]
  /context                      show context-window usage                         [dim]
  /cost                         show session cost + token usage                   [dim]
  /status                       show model · mode · context · session             [dim]
```

The `suggestion` truecolor token moved from `/model` to `/compact` and back on hover, with no `\x1b[2m`
anywhere on the hovered line — canon's `A ?? k` (hover overrides keyboard highlight) live over a real pty.
The full script additionally proved (and this is the authoritative PASS, not the standalone capture): two
`Down` presses hand the highlight back to the keyboard (`/compact` re-dims), and a press+release on `/context`
leaves the composer holding `/context` — click by absolute index.

## Step 4 — canon semantics checklist (H2's seven semantics)

| canon semantic | cite | cell | verified |
|---|---|---|---|
| hover overrides keyboard highlight | `A ?? k`, L536292 | popup-hover layer 2 (1) — "renders the HOVERED row as selected while the keyboard selection sits elsewhere" | ✅ pass |
| arrows clear hover | L602029 / L602031 | popup-hover layer 3 "ARROWS CLEAR HOVER"; pty `h2` (two `Down`s re-dim the hovered row) | ✅ pass (unit + pty) |
| hover never moves the keyboard cursor | L536292 + Enter arm | popup-hover layer 2 (2) "a hover on another row leaves `selected` untouched"; layer 3 "ENTER STILL ACCEPTS THE KEYBOARD PICK while another row is hovered" | ✅ pass |
| click passes the absolute index `windowStart + P` | L536295 | popup-hover layer 2 (3) "a press on window row P calls onSelect with windowStart + P, not P"; layer 3 "A CLICK ACCEPTS BY ABSOLUTE INDEX"; pty `h2` (click on `/context` lands in composer) | ✅ pass (unit + pty) |
| container-leave clears | L536291 | popup-hover layer 2 (4) "a motion outside the region clears the hover"; layer 3 "LEAVING THE POPUP CLEARS" | ✅ pass |
| both dead when non-interactive | L536294 | popup-hover layer 2 (5a)/(5b) "publishes an empty region... no onSelect" / "the inline (classic) popup is dead too"; layer 1 "top = 0 is NOT ADDRESSABLE — every cell misses" (`hitTop: 0`) | ✅ pass |
| setter bails when unchanged | L602033 | popup-hover layer 3 "SETTER BAILS WHEN UNCHANGED (L602033) — repeated motion inside one row paints no new frame" | ✅ pass |

All seven semantics have a named, passing cell. No gaps.

## Step 5 — sabotage ledger

**Task 1 (H1) — ten guards, counting 7b, per `task-1-report.md`.** All confirmed RED then reverted:

| # | guard | cell it broke | revert |
|---|---|---|---|
| 1 | `reid` drops its `ownerKey` overwrite | matrix cell (g), `distinct` 2 instead of 1 | reverted |
| 2 | `hitRowsOf` uses `sourceId(item.id)` for `ownerKey` | `hitmap.test.ts` grouping cells + matrix (a)/(n) | reverted |
| 3 | provider compares `sourceId(s.item.id)` again | live message-level grouping cell in `hover.test.tsx` | reverted |
| 4 | `pieceBg` reinstates the band swap | "no transcript row changes background" negation | reverted |
| 5 | `pillRow` published as `regionTop + body - 1` | live pill-hover cell (off-by-one miss) | reverted |
| 6 | `streamingItems` stamps the old implicit per-line key | matrix (l), `streaming-items.test.ts`, viewport (n) | reverted |
| 7 | `queuedTranscriptItems` keys on wrap ordinal | cell (m), 3 distinct owners instead of 2 | reverted |
| 7b | `queuedTranscriptItems` reverts to array index | cell (m2), drain-safety — held key survived the drain | reverted |
| 8 | `agentBatchItems` hands members the batch key | cell (k), collapsed to 1 owner instead of 4 | reverted |
| 9 | `LiveTurn.messageKey()` returns a constant | two-successive-messages cell | reverted |

Ten for ten, all demonstrated red, all reverted. (The gates in Step 1 running green on the current tree is
independent confirmation no sabotage state leaked.)

**Task 2 (H2/CM33) — eight guards, counting 4b, per `task-2-report.md`.**

| # | guard | cell it broke | revert |
|---|---|---|---|
| 1 | `top` becomes `top - windowLineCounts.length` | 9/35 tests (frame-output pin, live arrow-clear) | reverted |
| 2 | `pressAt` calls `onSelect(at)` not `onSelect(start+at)` | absolute-index cell | reverted |
| 3 | `activeId`'s `??` flipped | hover-overrides-keyboard cell + 2 live cells | reverted |
| 4 | arrow-clear line deleted | "ARROWS CLEAR HOVER" | reverted |
| 4b | arrow-clear reverted to v1's index-diff predicate | **did not fail on first attempt** — the readiness probe used the rendered highlight, the exact ambiguity the cell exists to route around; probe rewritten to detect engagement via the setter's own bail, then correctly failed | reverted, **with the test itself fixed as part of proving the guard** |
| 5 | `onSuggestionHover` drops its `p === id` bail | **did NOT turn the suite red** — `hoveredSuggestionId` is a primitive and React's own `Object.is` setState bailout already satisfies the "no new frame" cell without the explicit guard | **not reverted because never broken; not fixed further** — see finding below |
| 6 | `PALETTE_PADDING_X` set to 0 | column-boundary cell + too-narrow-pane cell | reverted |
| 7 | `navResult` uses `completionActive(s)` instead of `commandActive(s)\|\|mentionActive(s)` | **did not fail against the brief's own test list** (indistinguishable on "no popup at all"); a new layer-1 cell was added (inactive popup, zero matches) that the two predicates DO disambiguate, and with it the guard correctly failed | reverted, **with a new test cell added to make the guard provable** |

Seven of eight guards were demonstrated red (two of those seven — 4b and 7 — required the test itself to be
fixed first, which the brief's own rule endorses: "a guard that did NOT break anything is a missing test —
fix the test, not the guard"). **Guard 5 is an open finding, not a clean pass**: it never turned the suite
red, and per Task 2's own report the underlying line (`p === id` bail in `onSuggestionHover`) is currently
**unprovable** by any existing test, because `hoveredSuggestionId`'s primitive type makes the explicit bail
redundant with React's own `Object.is` shortcut. The line is harmless and self-documents canon's semantic,
but there is no cell today that would catch its removal. **This is a genuine gap against this step's own
rule** ("fix the test, not the guard") that Task 2 explicitly chose not to close. Flagged as a concern below
for routing back through Task 2 if the wave wants it closed — it does not affect cell 6/7's own pass/fail.

**Task 3 (the memo) — three guards, only if the memo shipped.** Per `task-3-report.md`, the measured cost
(median delta -0.163 ms/frame, hovered *faster* than not; isolated regex cost 0.0033 ms/frame against a 1 ms
threshold) did not justify memoization, so **Step 4 (memoize) did not run and no memo shipped**. Zero guards
apply. This is the correct, brief-sanctioned outcome, not a shortfall.

## Step 6 — producer census re-run (final branch)

Re-ran the exact regex from the brief:

```
grep -rn 'kind: "line"\|kind: "gutter-block"' src/ | grep -v 'mouse/\|pager.ts\|sessionPickerModel\|wrapItems.ts\|TranscriptPager\|FullscreenViewport.tsx:2[0-9][0-9]'
```

24 lines returned. Categorized:

- **2 union-arm declarations** — `toolRenderer.tsx:78`, `toolRenderer.tsx:82` (the `RenderItem` type itself).
- **2 comments** — `FullscreenViewport.tsx:30` (prose referencing the type), `streamingItems.ts:8` (prose).
- **19 producer literals**, all minting `ownerKey`: 17 in `toolRenderer.tsx` (lines 308, 324, 345, 377, 381,
  406, 428, 461, 465, 479, 658, 665, 698, 738, 772, 953, 965), 1 in `streamingItems.ts:33`, 1 in
  `ChatApp.tsx:130`. `reid` (the 20th producer) overwrites via spread and is by design invisible to this
  regex, exactly as Task 1's own report describes.
- **1 hit outside the three sanctioned categories** — `editor.ts:749`: `const hit: HitRow = { itemKey: "",
  ownerKey: "", ..., kind: "line" }`. This is **not** a `RenderItem` producer; it is one of the six `HitRow`
  constructors this same brief's Step 8 tracks separately (Task 1's own report: "the three other
  constructors (`FullscreenViewport.tsx`'s `hitRowOfLine`, `editor.ts`'s synthetic row, and the two test
  `mkRow` factories) were updated"), already carrying a required `ownerKey` field (currently `""`, a
  synthetic empty-composer row). The exclusion regex's `FullscreenViewport.tsx:2[0-9][0-9]` clause filters
  that file's own `HitRow` constructor by line range but has no equivalent clause for `editor.ts`, so this
  hit surfaces mechanically rather than semantically — it is a known, accounted-for site, not a producer this
  wave missed. Noting the regex's incompleteness rather than treating it as a defect, per Task 1's own
  process (the census's job is to police `RenderItem` producers, not every `kind:` string in the tree).

Re-ran the unfiltered audit against the three producer files directly to reproduce the count from scratch:

```
grep -rn 'kind: "line"\|kind: "gutter-block"' src/tui/toolRenderer.tsx src/tui/streamingItems.ts src/tui/ChatApp.tsx
```

Returns exactly the 2 union arms + 17 `toolRenderer.tsx` literals + 1 `streamingItems.ts` literal + 1
`ChatApp.tsx` literal = 21 grep-visible lines, +1 (`reid`, invisible by design) = **20 total producers**,
matching spec-drift note 2's audit exactly (17 + `reid` + 1 + 1 = 20, across three files). The count holds
on the final branch; no new producer appeared and none disappeared.

## Step 7 — parity check

**`docs/parity/tui-ux.md:1329` (`CM33` row).** Re-read in full. Claims and their backing:

- Hit region shape `{top, rows:[{id, colStart, colEnd, lines}]}`, derived forward from `useDockTop()` —
  backed by popup-hover layer 1's six `popupHitRegion`/`popupRowAt` cells.
- Routes through `ChatApp`'s ONE `useMouseSink` registration ahead of the transcript tap machine — backed by
  popup-hover layer 3's "a popup press does not also start a transcript selection or move the caret".
- All seven canon semantics — backed by Step 4's table above, all seven cells passing.
- Live-verified over a real pty (`scripts/hover-cells.sh` cell `h2`) — backed by Step 3(b)'s PASS.
- Delta 1 (derived, not measured) — backed by reading `popupHitRegion`'s implementation (pure function of
  `dockTop`, no `measureElement` call) plus the layer-1 "derives rows FORWARD from dockTop" cell.
- **Delta 2 (a modified click, or a non-left button, is dropped before the popup ever sees it) — NOT backed
  by a cell that ran in this task.** Traced the mechanism by reading code: `ChatApp.tsx:1003` —
  `if (e.button !== 0 || e.ctrl || e.alt || e.shift) return;` — is a single shared guard ahead of BOTH
  `popupHitRef.current?.pressAt` and the transcript's own press handling, so the claim is true by
  construction and shared with the pre-existing transcript-click code path (T-MOUSE, not new to T-HOVER).
  But no cell in `popup-hover.test.tsx` or `hover-cells.sh` exercises a modified click against the **popup**
  specifically. Not striking the parity-doc sentence myself (outside this task's one file, and the mechanism
  is genuinely real, just unexercised by a T-HOVER-owned test) — recorded as a concern below instead.

**`docs/parity/tui-ux.md:1985` (`Mouse in fullscreen (D7–D9)` row, T-HOVER's correction paragraph).**
Re-read in full. The correction claims:

- Canon's transcript hover unit is one whole SDK message, not a logical line — backed by hover-owner's
  matrix (every cell groups by ownerKey at message/call granularity, not line).
- `RenderItem.ownerKey`, minted by all twenty producers across the three files — backed by Step 6's census
  re-run (20/20 confirmed) and hover-owner's cells (i)/(j).
- The one remaining delta (ccx hovers everything; canon gates on `clickable`) — backed structurally by cell
  (i) ("every RenderItem of every tier carries an ownerKey" — unconditional, no kind-based gate observed in
  the minting sites reviewed for Step 6), though there is no single cell asserting "a plain prose row also
  un-dims" by name; this is an absence-of-a-gate claim rather than a positive behavior, and the census is the
  strongest available evidence for it.

No sentence in either row needed to be struck — every substantive claim traces to a cell or, for the one
exception above, to an explicit code-path citation recorded as a concern rather than silently assumed.

## Step 8 — merge handoff (for the controller; T-HOVER merges third, after T-MAINT and T-SELECT)

This branch's own tree is internally consistent (all four gates green, both acceptance cells pass) but is
**not** the assembled wave tree. The following is a checklist for whoever performs the `--no-ff` merges,
not a warning:

- [ ] **`src/tui/mouse/hitmap.ts`** — resolve `HitRow` as a union. End state: `itemKey`, `ownerKey`,
  `charStart`, `charEnd`, `textStart` ALL present and ALL required. On `f10-hover` alone, `HitRow` currently
  has `itemKey` + `ownerKey` only (T-SELECT's `charStart`/`charEnd`/`textStart` are absent here, as expected
  — this branch never touches them).
- [ ] **The six `HitRow` constructors.** Located on this branch (line numbers as of head `5e1f57b7b2`,
  drifted slightly from the brief's own citation — recorded, not a defect):
  - `FullscreenViewport.tsx:244` `hitRowOfLine` (brief cites `:243`, off by one) — carries `ownerKey`; verify
    it still carries T-SELECT's fields after merge.
  - `FullscreenViewport.tsx:267` the spread call site (brief cites `:262`) — verify it inherits both tracks'
    fields.
  - `editor.ts:749` (brief cites `:734`, drifted) — synthetic composer row, `ownerKey: ""` already present.
  - `test/tui/hitmap.test.ts:137` `mkRow` — carries `itemKey`/`ownerKey`.
  - `test/tui/selection.test.ts:31` `mkRow` — carries `itemKey`/`ownerKey` (T-SELECT edits this file too;
    keep both sides at merge).
  - `test/tui/selectionAddress.test.ts` — **confirmed absent from `f10-hover`** (`ls` returns "No such file
    or directory"), exactly as the brief predicts. T-SELECT's Task 5 creates it with `HitRow` literals
    carrying `charStart`/`charEnd`/`textStart` and no `ownerKey` — add `ownerKey` to both literals at merge,
    or the merged tree fails typecheck here and nowhere earlier.
- [ ] **Re-audit rather than trust the list.** On the MERGED tree, run `grep -rn "itemKey:" src test scripts`
  and reconcile every hit against the six above. On `f10-hover` alone today, this grep returns exactly five
  hits (`FullscreenViewport.tsx:244` — a parameter name, not a literal; `editor.ts:749`; `mouse/hitmap.ts:37`
  — the interface field declaration; `test/tui/selection.test.ts:31`; `test/tui/hitmap.test.ts:137`) —
  consistent with five of six being visible pre-merge and the sixth (`selectionAddress.test.ts`) arriving
  only from T-SELECT. A seventh constructor found on the merged tree is expected-in-kind, not an anomaly —
  fill it and record it.
- [ ] **`src/tui/ChatComposer.tsx`** — T-HOVER's `popupHitRef`/`hoveredSuggestionId`/`acceptSuggestionAt`/
  `r.suggestionNav` clear, against T-SELECT's `footerRows`+`DockBottomContext` rewrite of `dockCrowded`.
  Disjoint regions; keep both.
- [ ] **`src/tui/ChatApp.tsx`** — T-HOVER's `popupHitRef` routing in `discardTap`/motion/press plus its
  `queuedTranscriptItems`+`streamOwnerKey` props, against T-SELECT's selection wiring in the same sink. Keep
  both; the popup's `pressAt` early-return (`ChatApp.tsx:1003`'s modifier/button guard sits ahead of it) must
  stay FIRST in the press arm.
- [ ] **`src/tui/FullscreenViewport.tsx`** — `ownerKey`+`pillRow`+`streamOwnerKey` against T-SELECT's
  source-range recording. Keep both.
- [ ] **The re-run**: after resolving, `npm run typecheck`, `npm run build`, `npm run test:unit`,
  `npm run test:tui`, then T-HOVER's own pty cells `h1` and `h2` (`bash scripts/hover-cells.sh`) AND
  T-SELECT's already-merged pty cells. A resolution that dropped `ownerKey` or a source range must fail a
  re-run cell here rather than survive to the wave end.

## Concerns

1. **The brief's literal `npm run test:tui -- <name>` invocation does not filter.** `test:tui`'s npm script
   already hard-codes `test/tui` as a vitest CLI filter argument; any second token appended via `--` is
   OR'd against it, and since every test file path contains the substring `test/tui`, the second filter is
   always a no-op — the full 173-file suite runs every time regardless of what follows `--`. Verified
   directly (Step 2(a)). This is a tooling/documentation gap in how these acceptance commands are phrased
   across the wave, not a product defect; the working equivalent (`npx vitest run <name> --reporter=verbose`)
   was used instead to produce the required named-cell evidence.
2. **Task 2's sabotage guard 5 is an open, unprovable gap** (Step 5 above): `onSuggestionHover`'s explicit
   `p === id` bail cannot currently be distinguished from its absence by any test, because React's own
   `Object.is` setState shortcut already produces the same observable "no new frame" behavior for this
   primitive state shape. Per this step's own rule ("a guard that did NOT break anything is a missing test —
   fix the test, not the guard"), this should route back through Task 2 if the wave wants it closed. Does
   not affect cells 6/7's pass/fail.
3. **One `CM33` parity-doc delta (modified-click/non-primary-button dropped) is backed by code inspection,
   not by a cell that ran in this task.** The mechanism (`ChatApp.tsx:1003`) is real and shared with the
   pre-existing transcript click path, but no T-HOVER test exercises it against the popup specifically.
   Recorded rather than silently assumed or struck.

## Verdict

**All four gates green. Both acceptance cells (6 and 7) pass in full, including both live pty cells (`h1`,
`h2`).** All seven H2 canon semantics have a named passing cell. All eligible sabotage guards were
demonstrated red and reverted, with one open finding (Task 2 guard 5) recorded rather than glossed over. The
producer census re-confirms 20/20 on the final branch. Both edited parity-doc rows are backed by evidence
running in this task, with one delta backed by code inspection rather than a dedicated cell (recorded above).
This branch is ready to hand to the controller for wave assembly per the Step 8 checklist; T-HOVER itself is
not merged here.
