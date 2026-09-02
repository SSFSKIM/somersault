# bl10 fix wave 6 report — Workspace keyhint bar's no-op "Enter select"

## Status
Done. One commit on `main`, no `Co-Authored-By`.

## Commit
`eda7e5545676a3724b46a5544bf967515924b191` — "Permissions dialog: focus-derive the Workspace keyhint bar's select hint"

## The finding
`src/tui/PermissionsDialog.tsx`'s `hintActions` (built around line 684) was one uniform set —
cancel, navigate, `select:accept`, switch tab — shared by all four rule tabs. On the Workspace
tab, `activate()` (line 566) is a deliberate no-op for a `dir` item whose `source !== "session"`
(the cwd and launch-config directories are immutable), yet the bar still printed "Enter select"
while such a row was focused.

## Red evidence (TDD, before the fix)
Added two tests to `test/tui/permissions-dialog.test.tsx`'s existing "auto keyhint bar" describe
block. Running `npx vitest run test/tui/permissions-dialog.test.tsx` before touching the
implementation failed exactly the immutable-row assertion:

```
× drops the select hint on Workspace only while an immutable (cwd/launch) row is focused
  → cwd row is immutable — Enter does nothing: expected '...⏎ select...' not to contain 'select'
```

36 of 37 tests passed; the one new assertion designed to be red was the only failure, confirming
it exercises the actual regression.

## The fix
`src/tui/PermissionsDialog.tsx`:
- Added `focusedItem` — looks the live-focused row (`focusValue`, `Select`'s own reported cursor)
  back up in `items`/`values`, the same mechanism `activate()` itself uses, but only computed on
  the Workspace tab.
- Added `workspaceSelectIsNoOp` — true when the focused item is a `dir` row with
  `source !== "session"`.
- `hintActions` now conditionally omits the `{ action: "select:accept", scope: "Select" }` entry
  when `workspaceSelectIsNoOp` is true; cancel/navigate stay first, switch-tab stays last, so
  "switch tab" survives the 4-hint cap regardless of whether "select" is present.
- Introduced a small `hint(action, scope)` helper so the array's object literals type-check
  against `KeyContextName` without `as const` fighting the conditional spread; imported
  `KeyContextName` alongside `KeyEvent`/`TextEvent` from `./keys/types.js`.
- Rewrote the long comment above the array (previously claiming a single fixed "the precise,
  priority-ordered set") to describe the Workspace focus-derived arm truthfully, and to explain
  why the other three tabs keep the fixed set unconditionally (every row there is activatable).

Other rule tabs (Allow/Ask/Deny) are untouched — their `hintActions` stays the same fixed array
whenever `activeTab !== "Workspace"`.

## Test output (final)
`npx vitest run test/tui/permissions-dialog.test.tsx`:
```
✓ test/tui/permissions-dialog.test.tsx (37 tests) 895ms
 Test Files  1 passed (1)
      Tests  37 passed (37)
```
(both new tests pass: the Workspace focus-derived one and a companion pinning Allow's fixed set
unchanged.)

`npm run typecheck`: clean, no errors.

Full `npx vitest run test/tui/`:
```
Test Files  201 passed | 10 skipped (211)
     Tests  5074 passed | 11 skipped (5085)
Duration    179.97s
exited with code 0
```
(the 10 skipped files / 11 skipped tests are the pre-existing gated live/`e2e` and bench suites
that skip without a live API key — unrelated to this change.)

## Files touched
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/PermissionsDialog.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/permissions-dialog.test.tsx`

Staged explicitly by path (`git add src/tui/PermissionsDialog.tsx test/tui/permissions-dialog.test.tsx`)
in a shared checkout that had unrelated in-flight changes under `reforge/` and `docs/parity/coverage.md`
from other concurrent work — none of that was touched or included in this commit.

## Concerns
None. The fix is scoped to the one finding; no other tab's hint set changed; full `test/tui/`
suite is green and typecheck is clean.
