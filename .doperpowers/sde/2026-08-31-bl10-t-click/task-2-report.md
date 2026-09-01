STATUS: DONE

Commit: f144f7dcf (branch bl10-t-click, worktree
/Users/new/Developer/GitHub/somersault/.claude/worktrees/bl10-t-click/CC-to-SDK/harness)

Test summary: typecheck clean; fold-click.test.tsx + band-paint.test.tsx + fold-expand.test.tsx =
88/88 passed; full `npx vitest run test/tui` = 200 files passed, 5033 tests passed, 11 skipped
(gated live/e2e), 0 failed.

Red-first evidence: before the fix, `npx vitest run test/tui/fold-click.test.tsx` failed 3 of 3
targeted new/flipped assertions for the hit-region reason — the flipped :707 blank-tail-expanded
case (`AssertionError: expected '...(collapsed frame)...' to be '...(still-expanded frame)...'`,
fold-click.test.tsx:764), the cluster-member blank-tail case (`expected 2 to be +0`,
fold-click.test.tsx:781, i.e. the cluster stayed open), and the paint-extent-equals-hit-extent case
(`expected undefined to be 'item:extent-band'`, fold-click.test.tsx:721) — while the D9-v2
separator-regression-trap cases already passed pre-fix (separators were already dead, as intended).

Concerns: none outstanding. The fix is the single one-line-shape change the brief specified:
`hitRowOfLine`/`hitRowsOf` in FullscreenViewport.tsx now set `HitRow.width` to full `columns` when
`RenderItem.band === true`, for both `line` rows and `gutter-block` body rows, leaving
`clickTargetAt`'s existing `col > at.width` guard untouched. `mouse/hitmap.ts`'s `columnToChar`
(~126-137) has no parallel width bound to update — it already stops naturally at text length and
was left alone. No changes to the fold state machine, dispatch, or Task 1's paint logic.

## Task 2 review

**Spec: PASS**
**Quality: APPROVED**

### Findings

1. [Info] The width change is confined exactly to hit-row construction (`FullscreenViewport.tsx` `hitRowOfLine` + its two `hitRowsOf` call sites, :279-288, :311, :325-326), reading the same `RenderItem.band` marker Task 1 already stamps and paints from. `clickTargetAt` (:444-463 area) is untouched, matching the brief — its existing `col > at.width` guard is genuinely sufficient once `width` itself is correct in both states.
2. [Info] `src/tui/mouse/hitmap.ts`'s `columnToChar` (~126-137) does not need the same treatment: it maps a column to a grapheme cluster within `row.text` and already returns `undefined` past the last painted cluster — it has no independent "how wide is this row" bound of its own to widen, and it is not part of `clickTargetAt`'s dispatch path for fold/item toggles. Confirmed by reading the function directly rather than trusting the implementer's claim: no parallel bound exists there.
3. [Info] The flipped `:707`-equivalent test ("T-CLICK Task 2 (blank-tail, expanded): a click past the row's own text DOES collapse it") cites D9-v2 and canon's `cellIsBlank`/background-rectangle rule (`cli.pretty.js` L372918, L376156-376163) directly in its preamble comment, matching research §2.5's fix direction verbatim. The `:696`-equivalent test ("T-CLICKGATE Task 4 (blank-tail, unexpanded)") is byte-identical to pre-change, confirmed via diff.
4. [Info] All three new tests assert what they claim: the cluster-blank-tail test opens a fold cluster, taps a member row's blank tail, and asserts `openMembers` drops from 2 to 0 with the collapsed sentence back on screen. The separator-inert tests construct a document with a block adjacent to prose on both sides, locate the exact blank separator row immediately above/below the expanded block (verified via `strip(...) === ""` before tapping it), tap at a normal in-range column (not just deep into a dead zone), and assert the frame is byte-identical after — a real regression trap against "widen by proximity" rather than "widen by marker." The paint-extent==hit-extent test reuses `band-paint.test.tsx`'s Part 2 fact on the same frame and checks both the banded and unbanded boundary columns against `clickTargetAt`.
5. [Info] State machine and dispatch confirmed untouched: `git diff 4788084eb..f144f7dcf -- .../useChat.ts .../ChatApp.tsx` is empty.

### Mutation evidence

1. **Revert band-width widening** (band rows forced back to glyph width): `npx vitest run test/tui/fold-click.test.tsx test/tui/band-paint.test.tsx test/tui/fold-expand.test.tsx` → 3 failed / 85 passed. Failures: "T-CLICK Task 2 (blank-tail, expanded): ... DOES collapse it" (the flipped :707), "T-CLICK Task 2: an expanded cluster member row's blank tail collapses the cluster", and "T-CLICK Task 2: paint extent equals hit extent ...". Separator-inert and collapsed-blank-tail-inert tests stayed green, as expected. Working tree restored via `git checkout --`.
2. **Widen ALL rows unconditionally** (drop the band check, every row full-width): same command → 2 failed / 86 passed. Failures: "T-CLICKGATE Task 4 (blank-tail, unexpanded): a click past the row's own text never toggles" (the `:696` pin) and "T-CLICK Task 2: paint extent equals hit extent ...". Separator-inert tests stayed green — separator `RenderItem`s carry no `clickable`/`foldAnchor` bit, so widening their `HitRow.width` alone gives `clickTargetAt` no owner to resolve; this satisfies the brief's "and/or" condition via the `:696` failure. Working tree restored via `git checkout --`, confirmed clean by `git status --short` and a passing `npm run typecheck`.

### Full verification (post-restore, unmodified code)

- `npm run typecheck` → clean.
- `npx vitest run test/tui/fold-click.test.tsx test/tui/band-paint.test.tsx test/tui/fold-expand.test.tsx` → 88/88 passed.
- `npx vitest run test/tui` → 200 files passed / 10 skipped (210), 5033 tests passed / 11 skipped (5044), 0 failed.
