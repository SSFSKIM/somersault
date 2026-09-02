# bl10 fix wave 8 — final wave: scrollable read-only Settings tabs + two small route fixes

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). Commands from
`CC-to-SDK/harness/`. `npm run typecheck`; per-file vitest while iterating; full
`npx vitest run test/tui/` at the end. TDD red-first. Commit per finding, no Co-Authored-By,
explicit-path staging only (shared checkout — never `git add -A`). Do not touch `reforge/`,
`ptc-surface/`, `src/appserver/`, `harness/scripts/`, `src/tui/settingsFile.ts`.

## W8-1 (P1) — Make the Settings read-only tab bodies scrollable

`src/tui/SettingsDialog.tsx` `readOnlyTabBody` (~:520-532) currently clips fetched lines to the
frame budget with a passive `… +N more lines` marker. The killer case: `fetchSettingsUsage`
(`src/tui/useChat.ts:3112-3114`) returns `[...formatUsage, blank, ...formatCost]`, so on a
short terminal `/cost` can show NONE of its cost/duration/per-model fields — a hard violation
of the round's information-equivalence rule (spec D13). The Stats tab's in-flight disclaimer
can likewise be clipped away.

Fix: replace the fixed clip with a scroll window over the already-fetched `RenderLine[]`:
- a scroll offset per active read-only tab (reset on tab change and on `openSeq` bump);
- ↑/↓ move it one line, pageup/pagedown by the visible-row count, clamped (house idiom: see
  `mcpWindow`/`overflowRows` in `mcpDialogModel.ts` and `browserVisibleRows` in HelpDialog for
  the windowing + `↑ N more above` / `↓ N more below` marker pattern — reuse those literals'
  shape);
- markers render INSIDE the row budget (the frame must never exceed `rows` — the wave-2 tests
  pinning that stay green);
- Escape still closes the dialog. These tabs currently register no select keys, so binding
  navigation is free — wire it the way the codebase does elsewhere (`useSelectKeys` with a
  count and no-op accept, or direct key actions — pick the smaller diff consistent with house
  style), and make sure the keyhint bar advertises exactly what is live in this state (the
  round's hint-accuracy class — navigation hints only when the content actually overflows).

Tests (red-first): short-`rows` Usage tab with a tall payload — cost fields unreachable before,
reachable after scrolling down (drive the key handler); frame height stays ≤ rows at every
scroll position; scroll resets on tab change; no-overflow payload renders exactly as today.

ALSO: in `docs/parity/tech-debt-tracker.md`, DELETE the entry titled "Settings read-only tabs
clip without scrolling" (this fix pays it; note the commit hash inline per the file's header
convention — entries leave by being fixed). Leave every other entry alone.

## W8-2 — `/status` opens the dialog before awaiting the context re-measure

`src/tui/useChat.ts` `case "status"` (~:2265-2284): the arm currently `await refreshCtx()` THEN
`openSettings("Status")`. Local commands dispatch fire-and-forget, so a slow
`getContextUsage()` leaves the composer live; if the user opens another overlay meanwhile, the
delayed continuation stacks Settings on top of it (two overlay flags set). Reorder: call
`openSettings("Status")` first, then `await refreshCtx()` (which only feeds the status-line
chip here — the dialog's own `fetchSettingsStatus` re-measures independently, as the arm's
comment already documents; update that comment to match the new order). Test (red-first):
simulate a slow context read and assert the dialog state is open before the measure resolves
(and the chip still refreshes after).

## W8-3 (P3) — Dismissal notice names the dialog the user saw

`src/tui/useChat.ts` `closeSettings` (~:2965+): closing without Config changes appends
"Config dialog dismissed." even when the dialog was opened by `/status`/`/usage`/`/cost`/
`/stats` (title: Settings). Keep the existing literal for the Config route; for the
status-family routes emit the same sentence shape with the dialog's actual name (check how the
current literal is defined/tested — commands.ts or a constant — and follow that convention).
Test (red-first): open via `/status`, close untouched → notice does not say "Config".

## Report

Full report (per finding: red evidence, fix, test output; final typecheck + full test/tui
tallies) to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave8-report.md`.
Return only: status, commit hashes, one-line summary, concerns. Run everything foreground and
read output the same turn — never end a turn waiting on a background notification.
