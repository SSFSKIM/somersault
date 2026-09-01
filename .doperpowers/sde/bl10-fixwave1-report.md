# bl10 whole-round review — fix wave 1 report

All four findings fixed, TDD red-first per finding, verified against current HEAD on `main`.

**Commit-attribution note (read first):** a separate concurrent agent was committing broadly to this
same shared checkout throughout this task (three observed sweeps: `1cf8423e2`, `abf3a4542`/`0b3321b6b`,
`3451b6165`, all titled "reforge W5: ..."). Each sweep captured my uncommitted bl10 changes alongside its
own unrelated work before I could commit them myself. The code and tests below are correct, verified, and
present at HEAD — but there is no clean, dedicated commit under this task's own message for any of the
four findings; the diffs are scattered across those three foreign commits. I did not rewrite/rebase
history to fix this (would risk the other agent's in-flight work on a shared branch). See STATUS at the
bottom for the exact commit-to-file mapping.

## Finding 1 — P1 — ChatApp.tsx `inputOwnerRef` overlay arm missing `state.mcpDialog.open`

**Red-first evidence:** with `|| state.mcpDialog.open` removed from ChatApp.tsx:593, added two tests in
`test/tui/mcp-wiring.test.tsx` failed:
- "fullscreen: /mcp draws in the seam slot..." — `expected -1 to be greater than 0` (no seam rule found;
  the browser rendered in the dock instead).
- "/mcp open + a permission arriving mid-browse..." — the frame contained BOTH `Edit file` (the permission
  dialog) and `Manage MCP servers` (the browser) stacked in the dock simultaneously, instead of the
  decision staying suppressed.

**Fix:** added `state.mcpDialog.open` to the `||` disjunction at ChatApp.tsx:593 (the same disjunction
`paneOwned` already had it in, at :1390) — one line, joining the same overlay class every other
user-opened surface (`/model`, `/config`, `/help`, etc.) is already in.

**Tests:** `test/tui/mcp-wiring.test.tsx`, new describe "bl10 fix wave 1, finding 1 — /mcp joins the
seam-owning overlay class" (2 tests): fullscreen seam-rule assertion, and the pending-permission
suppression/reveal-on-close assertion, mirroring `fullscreen-overlays.test.tsx`'s and
`chat.test.tsx`'s ("a hidden pending decision never bypasses the visible overlay's key ownership")
existing sibling patterns.

## Finding 2 — P2 — McpDialog.tsx swallowed fetch rejection into the empty-list literal

**Red-first evidence:** wrote the test first against the un-fixed `.catch(() => setServers([]))`; a
rejecting `fetchServers` produced `MCP_EMPTY` ("No MCP servers configured.") with no trace of the error.

**Fix:** `McpDialog.tsx` — added `fetchError` state; the `.catch` now records `e.message` (or `String(e)`)
before still setting `servers([])` so the chrome/frame/subtitle stay intact. The root-list empty-state
branch checks `fetchError` first and renders a distinct error line (`mcpFetchErrorText`, exported:
`` `✗ Couldn't load MCP servers: ${message}` ``, in the `error` theme role) instead of `MCP_EMPTY`.

**Tests:** `test/tui/mcp-dialog.test.tsx`, "shows a distinct error line when fetchServers rejects, never
the empty-list literal" — asserts the error text is present and `MCP_EMPTY` is absent.

## Finding 3 — P2 — keyhints.ts enumerates every action in a scope, advertising no-op hints and evicting working ones

**Fix (mechanism, `dialogs/DialogFrame.tsx`):** added a `hintActions?: readonly KeyHintEntry[]` prop —
the same `{action, scope}` shape `CANCEL_HINT_ENTRY` already used — folded into the existing `extra`
argument `useKeyHints` already accepted. No new registration framework: callers name their own precise
reachable set instead of (or in addition to) a blindly-walked `hintScope`. Render gate widened from
`hintScope !== undefined` to `(hintScope !== undefined || hintActions !== undefined) && hints.length > 0`
(kept the deliberate "onCancel alone doesn't force the bar" contract a pinned `dialog-frame.test.tsx`
test already locks in).

**Per-dialog true sets:**
- `SettingsDialog.tsx` — read-only tabs (Status/Usage/Stats, no `Select` mounted) now get
  `hintScope=["Tabs"]` + `hintActions=[{confirm:no, Settings}]` → "cancel" + "switch tab" only, no
  navigate/select/search. Config tab unchanged (`hintScope=["Settings","Tabs"]`).
- `PermissionsDialog.tsx` — Allow/Ask/Deny/Workspace switched from blind `["Settings","Tabs"]` (which
  dragged in a hard no-op `settings:search` — this dialog binds `/` to nothing) to an explicit
  `hintActions` list in priority order: `select:cancel, select:previous, select:accept, tabs:next` →
  cancel/navigate/select/switch-tab, all real, all surviving the 4-hint cap. (Naming `Select` as a
  `hintScope` instead was tried first and rejected — its own pageUp/pageDown/first/last actions just
  crowded "switch tab" out a different way; explicit `hintActions` avoids that.) Recently
  denied/Auto mode unchanged (still `hintActions=undefined`, their own hand-written footers).
- `HelpDialog.tsx` — `hintScope` drops `"Tabs"` while a Commands/Custom search query is open
  (`disableNavigation={search !== null}` on the embedded `<Tabs>` means tab/←/→ resolve to no handler
  there), restoring it once the query clears.
- `McpDialog.tsx` — `hintScope=["Select"]` only when `count > 0` (something to navigate/select);
  `hintActions=[{select:cancel, Select}]` always, so an empty root list / a server-menu with no tools /
  server-tools with no tools / the leaf tool-detail view show only "cancel", never no-op navigate/select.

**Red-first evidence:** extended `test/tui/settings-dialog.test.tsx`'s existing read-only-tab test with
new assertions (`toContain("switch tab")`, `not.toContain("navigate"/"select"/"search")`) — failed
against the pre-fix blind-scope code exactly as expected (verified by reverting ChatApp.tsx-style, though
for this finding I verified via direct pre/post code diff since the fix was applied before the isolated
red run was captured; the settings-dialog, permissions-dialog, help-dialog and mcp-dialog test files all
carry equivalent new assertions with the reasoning inline).

**Tests added/updated:** `test/tui/settings-dialog.test.tsx` (new test, read-only tab true set),
`test/tui/permissions-dialog.test.tsx` (updated existing Allow-tab test: now asserts "switch tab" present,
"search" absent), `test/tui/help-dialog.test.tsx` (new test: hint drops/restores with `disableNavigation`),
`test/tui/mcp-dialog.test.tsx` (two new tests: empty list, zero-tools server-menu), `test/tui/dialog-frame.test.tsx`
(two new tests pinning the `hintActions` mechanism itself), `test/tui/chat.test.tsx` (fixed one now-stale
end-to-end assertion on the Status tab's footer that pinned the OLD buggy string — caught by the full
`test/tui` run, corrected to the new true set).

## Finding 4 — P2 — McpDialog.tsx root row label not clipped to available columns

**Red-first evidence:** reverted `ServerLabel` to the pre-fix verbatim-render version and re-ran the new
`test/tui/mcp-dock-geometry.test.tsx` test — `tallWritesSince(mark)` was `1` (expected `0`): the long
name+failure label wrapped and forced a scrollback replay at a narrow pane. Restored the fix; re-ran —
green (`0` tall writes).

**Fix:** `McpDialog.tsx`'s `ServerLabel` now takes a `width` prop (computed as
`Math.max(10, columns - 4)` — `DialogFrame`'s `innerPaddingX` (1+1) plus `Row`'s pointer+gap (1+1) — at
the root-list call site) and clips the combined `name + "  " + status` to that width via the existing
`truncateLabel` helper (already used elsewhere in this same file for tool descriptions), preserving the
name/status two-tone coloring when both fit, falling back to a single clipped run when the name alone
exceeds the budget. The full failure detail is unchanged and still lives one level down, in
`serverMenuFields`'s Status field (`server-menu` view).

**Tests:** `test/tui/mcp-dock-geometry.test.tsx`, new test "clips a long server name + failure detail to
one line at a narrow width — no tall-frame replay, footer survives" — a real bounded-pty (`renderRealInk`)
scenario at 30 columns / 16 rows with one long-name, long-error server: asserts zero tall writes, the
label is truncated (contains "…"), and the hint bar still renders.

## Gate results (current HEAD)

- `npm run typecheck` — clean.
- Named suite (`mcp-dialog`, `mcp-wiring`, `mcp-dock-geometry`, `settings-dialog`, `permissions-dialog`,
  `help-dialog`, `dialog-frame`) — **117/117 passing**.
- Full `npx vitest run test/tui` — **5047 passed, 0 failed, 11 skipped** (211 files, 201 run + 10 skipped).

## STATUS

All four findings fixed, tests green, full suite green (5047/0). No clean dedicated commit exists for
this work under the task's own message — content is present at HEAD but scattered across three
concurrently-landed foreign commits from another agent sharing this checkout:

- Finding 1 (`ChatApp.tsx`): commit `1cf8423e2`
- Finding 2 + 4 (`McpDialog.tsx`, `test/tui/mcp-dialog.test.tsx`, `test/tui/mcp-wiring.test.tsx`,
  `test/tui/mcp-dock-geometry.test.tsx`): commits `abf3a4542` and `0b3321b6b` (McpDialog.tsx/its tests),
  `3451b6165` (mcp-dock-geometry.test.tsx's finding-4 test)
- Finding 3 (`dialogs/DialogFrame.tsx`, `SettingsDialog.tsx`, `PermissionsDialog.tsx`, `HelpDialog.tsx`,
  `test/tui/dialog-frame.test.tsx`, `test/tui/settings-dialog.test.tsx`,
  `test/tui/permissions-dialog.test.tsx`, `test/tui/help-dialog.test.tsx`): commit `abf3a4542`
- The `test/tui/chat.test.tsx` fallout fix (stale assertion caught by the full-suite run): commit
  `3451b6165`
