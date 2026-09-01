## Task 1 fix wave

Note: the original `task-1-report.md` (with the "## Task 1 review" section) could not be located —
neither at the dispatch's first guess path nor under the worktree's
`.claude/worktrees/bl10-t-click/.doperpowers/sde/2026-08-31-bl10-t-click/` (which contains only
`review-f6a60bb07..64e461201.diff`, no report). This fix wave proceeded from the dispatch's own finding
descriptions alone, per the dispatch's fallback instruction.

### Findings addressed

1. **[Important]** The band's background never painted under a row's own leading gutter columns:
   `RenderItemView`'s five-column tool-result/hint connector `Box` (`src/tui/toolRenderer.tsx`, the shared
   `⎿`/hint-glyph column) and `Line.tsx`'s inline `l.gutter` (e.g. the absorbed-thinking `"∴ "` bullet) both
   sat outside the painted rectangle.
   - `src/tui/Line.tsx`: the gutter `<Text>` now takes `backgroundColor={rowBg}` (the same `rowBg` the
     segment/plain-text branches already use).
   - `src/tui/toolRenderer.tsx`: `RenderItemView`'s gutter `Box`'s `<Text>` now takes `backgroundColor` from
     the existing `expandedBg()` helper when the row is banded. When `showGutter` is `false` (a pager
     continuation row) the glyph is blank (`""`), which carries no characters for a background color to
     paint onto — so that case now pads to the gutter column's own width with spaces (`" ".repeat(item.gutter.length)`)
     instead of `""`, matching the "every cell of the rectangle" contract; unbanded rows keep the exact `""`
     they always rendered (byte-identical).

2. **[Minor]** `test/tui/band-paint.test.tsx`'s Part 2 assertions stripped SGR before measuring width, which
   only proved the padding reached the edge, not that the *background* did — they would pass unchanged with
   finding 1 unfixed. Reworked to:
   - Assert the literal `\x1b[48;2;r;g;bm` background escape (via a local `sgrBg()` helper, the
     `tabs.test.tsx`/`fold-click.test.tsx`/`hover.test.tsx` convention) is present on every banded row and
     absent from every unbanded one, on **raw, un-stripped** frame bytes.
   - Added two gutter-bearing fixture rows to `PAINT_DOC`: the existing `⎿` tool-result `gutter-block` body
     row, and a new `line` row wearing an absorbed-thinking-shaped `l.gutter` (`"∴ "`, dim+italic) — the two
     shapes the finding named.
   - Added leading-edge assertions: the background escape's raw-byte index must be *less than* the gutter
     glyph's (`⎿` / `∴`) raw-byte index on both rows, proving the rectangle starts at column 1, not after the
     glyph.

### Red-first evidence

Before applying the source fix (Line.tsx/toolRenderer.tsx changes stashed via `git stash`), running the
reworked test against the unfixed source failed exactly as expected:

```
test/tui/band-paint.test.tsx:208
AssertionError: expected 2 to be greater than 5
  expect(glyphIdxInBody).toBeGreaterThan(bandIdxInBody);
```

(the `⎿` glyph landed at raw-byte index 2 — *before* the background escape at index 5 — proving the band
started after the gutter under the unfixed code). 3 of 4 tests in the file still passed (Part 1's projection
checks, untouched by this fix). After `git stash pop` restored the source fix, all 4 tests passed.

### Gate results

- `npm run typecheck` — clean.
- `npx vitest run test/tui/band-paint.test.tsx test/tui/fold-click.test.tsx test/tui/fold-expand.test.tsx test/tui/spacing-invariant.test.tsx` — 111 passed, 0 failed.
- `npx vitest run test/tui` (full suite) — 200 files passed, 10 skipped (live/e2e, key-gated), 5029 tests
  passed, 11 skipped, 0 failed.

### Commit

`4788084eb` — "T-CLICK Task 1 fix wave: band paint covers leading gutter columns" on branch `bl10-t-click`,
in worktree `/Users/new/Developer/GitHub/somersault/.claude/worktrees/bl10-t-click`.

Files touched:
- `CC-to-SDK/harness/src/tui/Line.tsx`
- `CC-to-SDK/harness/src/tui/toolRenderer.tsx`
- `CC-to-SDK/harness/test/tui/band-paint.test.tsx`

## Fix re-review

Re-reviewed commit `4788084eb` against both original findings.

**Diff read.** `toolRenderer.tsx`'s `gutterBg`/`gutterText` derive from `banded` (`columns !== undefined &&
item.band === true`), and the `<Text backgroundColor={gutterBg} …>` only paints when banded — unbanded rows
keep the original `""` glyph and `undefined` background, byte-identical to before. `Line.tsx`'s gutter
`<Text>` takes `backgroundColor={rowBg}`, the same `rowBg` prop the segment/plain-text branches already
gate on `bandWidth !== undefined` — an unbanded `Line` still gets `rowBg === undefined`. Both gutter sites
are covered; no unbanded-row or classic-renderer code path was touched.

**Test rework verified.** `band-paint.test.tsx`'s Part 2 now builds `BAND` from the literal
`\x1b[48;2;r;g;b` escape via a local `sgrBg()` helper, asserts it on raw (un-stripped) frame bytes for every
banded row and its absence on unbanded ones, and adds leading-edge checks that the escape's byte index
precedes the gutter glyph's byte index on both a `⎿` tool-result body row (`PAINT_DOC["result"]`) and a new
absorbed-thinking row carrying an inline `l.gutter` (`"∴ "`, `PAINT_DOC["thought"]`). Strictly stronger than
the rejected version's SGR-stripped width check.

**Mutation testing** (each reverted via `git checkout` immediately after, tree confirmed clean, suite reran
green before the next step):

- (a) Reverted `toolRenderer.tsx`'s connector-Box `backgroundColor={gutterBg}` (kept `gutterText`/padding
  logic). Result: `band-paint.test.tsx` failed at `expect(glyphIdxInBody).toBeGreaterThan(bandIdxInBody)` —
  `expected 2 to be greater than 5` (glyph before background), the same signature as the fixer's own
  red-first evidence. Restored via `git checkout -- src/tui/toolRenderer.tsx`; reran green (111/111); tree
  clean.
- (b) Reverted `Line.tsx`'s inline-gutter `backgroundColor={rowBg}`. Result: `band-paint.test.tsx` failed at
  `expect(glyphIdxInThought).toBeGreaterThan(bandIdxInThought)` — `expected 8 to be greater than 20` (the
  `∴` glyph landed before the band's background escape). Restored via `git checkout -- src/tui/Line.tsx`;
  reran green (111/111); tree clean.

**Gates re-run.**
- `npm run typecheck` — clean, no output.
- `npx vitest run test/tui/band-paint.test.tsx test/tui/fold-click.test.tsx test/tui/fold-expand.test.tsx test/tui/spacing-invariant.test.tsx` — 4 files, 111 passed, 0 failed.
- `npx vitest run test/tui` (full suite) — 200 files passed, 10 skipped (live/e2e, key-gated), 5029 tests
  passed, 11 skipped, 0 failed — matches the fixer's reported numbers exactly.

**Verdict: APPROVED.** Both original findings (band paint missing under the `⎿` connector Box and the
inline `l.gutter`) are fixed, scoped correctly to banded rows only, and the reworked tests demonstrably
detect regression of either fix via targeted mutation.
