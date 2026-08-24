# bl4 round — fix wave 1 (external review, P2 findings)

Both findings reproduced RED at HEAD, fixed, and verified GREEN. Commits are on `main` in the main
checkout (`/Users/new/Developer/GitHub/codex_somersault`), each finding its own commit.

## Finding 1 — item clicks must resolve through the owner's clickable state

**File:** `CC-to-SDK/harness/src/tui/FullscreenViewport.tsx` (`clickTargetAt`, ~L425-445)

**Bug:** `clickTargetAt` gated on the per-row bit `at.clickable`, but `RenderItem.clickable` is minted
only on the tool-result gutter-block body (`toolRenderer.tsx`'s `toolEventItems`) — never on the header
`line` row, even though the header shares the same `ownerKey`. `hoverAt` already resolves through the
owner-level `clickableOwners` set and brightens the header row, so a click on that visibly-brightened
header fell through to `undefined` and did nothing.

### Red repro

Added a test in `test/tui/fold-click.test.tsx` ("bl4 finding 1") that taps the HEADER line of a
12-line-error `Mystery` tool call (`LONG_ERROR_DOC`). At HEAD:

```
 × T-CLICKGATE Task 3 (bl4 finding 1): a tap on the result's HEADER row resolves through the owner's
   clickable state > expands a >10-line error result when the tap lands on its header line, not only its body
   → expected '⏺ Mystery()\n  ⎿  Error: err line 1\n…' to contain 'err line 11'
```

The tap landed on the header (confirmed brightened by the hover band before the fix), but the block never
expanded — reproducing the finding exactly.

### Fix

```ts
const clickTargetAt = useCallback((col: number, row: number): string | undefined => {
  const { top, rows: painted, clickableOwners } = hit.current;
  if (top <= 0) return undefined;
  const at = painted[row - top];
  if (at === undefined || col < 1 || col > at.width) return undefined;
  if (at.anchor !== undefined) return "fold:" + at.anchor;
  if (!clickableOwners.has(at.ownerKey)) return undefined;   // was: if (!at.clickable) return undefined;
  ...
```

`clickableOwners` comes off the same `hit.current` snapshot `at` was read from, so it can never disagree
with what's actually painted — the identical discipline `hoverAt` already used. The link-cell no-op and
the `col <= at.width` blank-tail bound directly below were left untouched (they only ever *narrow* the
answer past this point, never widen it).

### Green

```
✓ test/tui/fold-click.test.tsx (20 tests)
✓ test/tui/fold-expand.test.tsx (26 tests)
✓ test/tui/hover-owner.test.tsx (34 tests)
✓ test/tui/hover.test.tsx (19 tests)
✓ test/tui/fold-hitmap.test.tsx (8 tests)
Test Files  5 passed (5)
     Tests  107 passed (107)
```

The existing link-cell no-op (Task 4 (a)) and both blank-tail cases (Task 4, unexpanded/expanded) still
pass unchanged — the narrowing guards were not touched.

**Note on the test's own round-trip:** the test collapses the block again via a body row unique to the
open state (`err line 11`, the same idiom the (a)/(b) fold-cluster test uses via `memberRow()`), not a
second click on the identical header cell — clicking the exact same cell twice within canon's own
multi-click window reads as a double-click *selection*, not a second independent tap, which is correct
existing behavior and not something this fix touches.

**Commit:** `a0a7eacdf6` — "bl4 fix-wave finding 1 (P2): item clicks resolve through the owner clickable set"

---

## Finding 2 — clipped TaskStop (and audited siblings) must mint clickable

**File:** `CC-to-SDK/harness/src/tui/toolSummaries.ts` (`taskStopRows`, ~L299-315; `summaryLines`, ~L380-403)

**Bug:** A successful `TaskStop` whose command exceeds the clip bound (2 lines / 160 chars) renders
clipped in compact and unclipped under `detail-all` (verbose/ctrl+o) — a real, live, projection-dependent
truncation exactly like `bashRows`' fold. But `summaryLines` wrapped `taskStopRows` in `notClickable(...)`,
hardcoding `clickable: false`, so click-to-expand could never reveal the hidden text. The stale doc
comment on `summaryLines` incorrectly listed `taskStopRows` among the "fixed-shape sentences with no fold
in them anywhere."

### Red repro

Added a test in `test/tui/toolSummaries.test.ts` ("carries clickable on its typed row exactly when the
compact clip would shorten the command"). At HEAD:

```
 × F3 typed result rows — the remaining census tools > carries clickable on its typed row exactly when the
   compact clip would shorten the command
   AssertionError: expected false to be true
```

### Fix

`taskStopRows` now returns `{ lines, clickable }`, computing `clickable` from an **as-if-compact**
predicate independent of `options.verbose` — mirroring `bashRows`' own discipline exactly:

```ts
function taskStopRows(event: ToolEvent, options: ProjectionOptions): { lines: readonly RenderLine[]; clickable: boolean } | undefined {
  const command = str(callSidecar(event)?.command);
  if (command === undefined) return undefined;
  const lines = command.split("\n");
  const compactClip = (lines.length > TASKSTOP_LINES ? lines.slice(0, TASKSTOP_LINES).join("\n") : command).slice(0, TASKSTOP_WIDTH).trim();
  const clipped = options.verbose ? command : compactClip;
  const rows = clipped.split("\n");
  return { lines: rows.map(...), clickable: compactClip !== command };
}
```

`summaryLines`'s `TaskStop` case now calls `taskStopRows(event, options)` directly (no longer wrapped in
`notClickable`), and the stale doc comment above it was corrected to move `taskStopRows` out of the
"fixed-shape, never-clip" list and into the same category as `bashRows`.

### Clickable-audit table

Grepped every `clickable: false` / `notClickable(...)` site in `toolSummaries.ts` and checked whether the
producer visibly clips content behind a projection-dependent unbounded escape (the defect shape):

| Producer | Clips visibly? | Has a `detail-all`/verbose unbounded escape? | Verdict |
|---|---|---|---|
| `bashRows` — `isImage` arm | No (fixed literal) | — | Correct `false` |
| `taskOutputRows` — "No task output available" | No (fixed literal) | — | Correct `false` |
| `taskOutputRows` — `local_agent`, not verbose | No — binary hint/full switch, not a partial clip | Yes, but a full binary switch, not a clip+reveal | Correct `false` (matches doc) |
| `taskOutputRows` — `local_agent`, verbose success | No (full body, unbounded) | N/A — already unbounded | Correct `false` |
| `taskOutputRows` — running/not-ready | No (fixed literal) | — | Correct `false` |
| `taskOutputRows` — `remote_agent`, output undefined | No (fixed literal) | — | Correct `false` |
| `taskOutputRows` — `remote_agent`, verbose | No (full body, unbounded) | N/A | Correct `false` |
| `taskOutputRows` — `remote_agent`, not verbose | No — binary hint/full switch | Yes, binary switch only | Correct `false` (matches doc) |
| `taskOutputRows` — `local_bash` arm | N/A — delegates to `bashRows` | Inherits `bashRows`' own dynamic `clickable` | Already correct (not wrapped in `notClickable`) |
| `readRows` | No (`Read N lines`/pages/cells — the whole row) | — | Correct `false` |
| `editRows` | No — diff body is always rendered whole, no projection gate | — | Correct `false` |
| `writeRows` — "create" preview (`previewRows`, 10-line cap) | **Yes** — visible `… +N lines` marker | **No** — cap is fixed regardless of `options.verbose`; upstream's own census entry for this row has no `expandable` flag either | Correct `false` — not the same defect shape (no escape exists at all, by upstream's own design; out of scope) |
| `searchRows` (Grep/Glob) | No — binary compact/detail-all body switch | Yes, binary switch only | Correct `false` (matches doc) |
| `webFetchRows` | No — binary compact/detail-all body switch | Yes, binary switch only | Correct `false` (matches doc) |
| `webSearchRows` | No (fixed sentence) | — | Correct `false` |
| `skillRows` | No (fixed sentence) | — | Correct `false` |
| `taskStopRows` | **Yes** — 2-line/160-char clip with `…` marker | **Yes** — `options.verbose` shows the whole command | **Fixed** (this finding) |
| `worktreeRows` | No (fixed sentence) | — | Correct `false` |
| `planModeRows` | No (fixed sentence) | — | Correct `false` |

`taskStopRows` was the only sibling carrying the exact defect shape (a real, live, projection-gated clip
with an unbounded verbose escape, hardcoded to non-clickable). `writeRows`' create-path preview also clips
visibly but has no verbose escape at all anywhere in the renderer — canon's own upstream census entry for
that row is recorded *without* an `expandable` flag, so leaving it non-clickable matches upstream fidelity
rather than repeating the finding-2 defect.

### Green

```
✓ test/tui/toolSummaries.test.ts (36 tests)
```

**Commit:** `4ae21d751e` — "bl4 fix-wave finding 2 (P2): clipped TaskStop (and audited siblings) mint clickable"

---

## Gate totals

- Targeted subset (`fold-click`, `fold-hitmap`, `toolSummaries`, `hover`, `hover-owner`, `fold-expand`):
  **6 files / 143 tests passed.**
- `npm run typecheck`: clean (no errors).
- Full `npm run test:tui`: **183 test files passed, 10 skipped (193 total); 4689 tests passed, 11
  skipped (4700 total); exit code 0.** No regressions.

## Commits

- `a0a7eacdf6` — bl4 fix-wave finding 1 (P2): item clicks resolve through the owner clickable set
  (`src/tui/FullscreenViewport.tsx`, `test/tui/fold-click.test.tsx`)
- `4ae21d751e` — bl4 fix-wave finding 2 (P2): clipped TaskStop (and audited siblings) mint clickable
  (`src/tui/toolSummaries.ts`, `test/tui/toolSummaries.test.ts`)

Both commits are on `main`; neither was pushed.
