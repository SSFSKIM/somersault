# bl10 fix wave 6 — one finding: Workspace tab advertises a no-op "Enter select"

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). Commands from
`CC-to-SDK/harness/`. `npm run typecheck` + `npx vitest run test/tui/permissions-dialog.test.tsx`
(plus any other file your change touches), full `npx vitest run test/tui/` at the end. TDD
red-first. One commit, no Co-Authored-By, explicit-path staging (shared checkout — never
`git add -A`). Do not touch `reforge/`, `ptc-surface/`, `src/appserver/`, `harness/scripts/`.

## The finding (verified, external review)

`src/tui/PermissionsDialog.tsx` ~:684: the four rule tabs share one uniform `hintActions` set —
cancel, navigate, `select:accept`, switch tab. On the **Workspace** tab, `activate()` is a
deliberate no-op unless the focused directory row has `source === "session"` (cwd and launch
directories are immutable), yet the keyhint bar still prints `Enter select` while an immutable
row is focused. The pre-migration hand-written footer omitted select for managed directories,
so this is a hint-accuracy regression introduced by the keyhint-bar migration.

## The fix

On the Workspace tab, derive the hint set from the focused row: include
`{ action: "select:accept", scope: "Select" }` only when the focused item is one `activate()`
would actually act on (`source === "session"`); otherwise emit the same set without it. Other
tabs keep the current uniform set (their rows are all activatable). Keep the priority order so
"switch tab" survives the 4-hint cap (the long comment above the current set explains the cap
arithmetic — update it to describe the focus-derived Workspace arm truthfully). Mind that the
hint recomputes as focus moves between a session row and an immutable row on the same tab.

Tests (red-first, in the permissions dialog suite): Workspace tab with an immutable (cwd/launch)
row focused → keyhint bar does NOT contain "select"; move focus to a session-added row → it
does; another rule tab (e.g. Allow) unchanged. The immutable-focused assertion must fail before
the fix.

## Report

Full report (red evidence, fix, test output, final typecheck + full test/tui tallies) to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave6-report.md`.
Return only: status, commit hash, one-line summary, concerns. Run everything foreground and read
output the same turn — never end a turn waiting on a background notification.
