# bl10 fix wave 2 — fixer A brief (code findings F2–F6)

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, current checkout, in place).
All commands from `CC-to-SDK/harness/`. Never bare `npm test`; use `npm run typecheck` and
`npx vitest run test/tui/<file>` per file, plus a full `npx vitest run test/tui/` at the end.
TDD: for each finding write/adjust the failing test first, watch it fail for the finding's
reason, then fix. Commit per finding or per coherent pair, no Co-Authored-By. Do NOT touch
`reforge/`, `ptc-surface/`, `src/appserver/`, or `harness/scripts/` (a second fixer owns the
scripts). Stage explicit paths only — never `git add -A` (a concurrent session shares this
checkout).

These are verified findings from an external whole-round review (codex, re-review 1). Each is
confirmed real; fix all five.

## F2 — Window the Settings read-only tab bodies

`src/tui/SettingsDialog.tsx` — `readOnlyTabBody` (~:490) renders `tabLines[t]!.map(...)` with
no windowing. On a short terminal a tall `/cost` payload (fetchSettingsUsage merges formatUsage
+ formatCost fields; per-model rows scale) makes the dialog frame exceed `rows`, triggering
Ink's tall-frame replay — the exact hazard this round's chrome-margin tests exist to prevent.
The dialog already receives `rows` and knows its chrome (title, tab strip, spacer, keyhint
bar). Fix: compute the rows available to the body and window the lines — keep the head of the
list and show a dim `… +N more lines` style truncation indicator (no scrolling needed this
round; a truncated-but-bounded pane beats a corrupted scrollback; put the indicator INSIDE the
budget). Test: render SettingsDialog on a short `rows` with a long fetched line list; assert
total rendered frame height stays ≤ rows and the indicator appears; assert an untruncated
payload renders unchanged.

## F3 — Restore the legacy `state` fallback in the MCP normalizer

`src/tui/mcpDialogModel.ts` (~:61) validates only `e.status` and falls back to `"failed"`.
The pre-dialog formatter (`src/tui/commands.ts:470`) accepted `r.status ?? r.state`. An older
or loosely typed host returning `{name, state: "connected"}` now shows as failed. Fix: read
`e.status ?? e.state` BEFORE the known-status validation (keep the `"failed"` fallback for
genuinely unknown values). Test in `test/tui/mcpDialogModel.test.ts`: a row with only
`state: "connected"` normalizes to status `"connected"`.

## F4 — Ref-backed focus in McpDialog

`src/tui/McpDialog.tsx` (~:100, :130-135) passes a plain `index` number to `useSelectKeys` and
uses render-captured `serverFocus`/`toolFocus` in `onAccept`. The hook's own contract
(`src/tui/keys/selectKeys.ts:18-22`) requires a GETTER for any list whose focus can move more
than once per stdin chunk: one chunk dispatches several key events with no render between, so
`jj` moves one row instead of two, and a move+Enter chunk opens the previous row. Fix: keep
each focus in a ref alongside its state (see how `src/tui/select/Select.tsx` does it — mirror
the house pattern), pass `index` as a getter reading the ref, update the ref synchronously in
`onMove`, and make `onAccept` read the ref. Test: drive the dialog with a single batched input
chunk (two `j`s, or `j`+Enter) and assert the second event acts on the post-first-event row —
this must fail before the fix.

## F5 — Tools-view row budget and label truncation

`src/tui/McpDialog.tsx` (~:187-192): the `server-tools` view reuses `mcpListVisibleRows(rows)`
(the ROOT list's budget) but adds two chrome rows (the bold server-name line and the
`marginTop={1}`), and the tool NAME is untruncated (only the description is), so a long name
wraps and breaks the one-physical-row-per-option accounting. Fix: a tools-specific visible-rows
budget (root budget minus the extra chrome), and truncate the composed name+description label
to the available columns the same way wave-1 finding 4 did for root rows (see the
`rootRowWidth` comment ~:149-152). Test: short-`rows` tools view with many tools stays within
the frame budget; a very long tool name renders on one row.

## F6 — Help hint bar during search

`src/tui/HelpDialog.tsx` (~:192): while a Commands/Custom-commands search is active the frame
gets `hintScope={["Help"]}`, whose `help:dismiss` row prints "esc dismiss" — but in that state
Escape only clears the query, and the browser footer already says "Esc to clear". Two visible,
contradictory Esc instructions. Fix: in the search-active state pass `hintActions` (the
DialogFrame escape hatch added in wave 1 — see SettingsDialog ~:507 for the pattern) that
omits `help:dismiss` (the browser footer already carries the Esc meaning); non-search state
unchanged. Test: render Help with an active search and assert the keyhint bar does not
advertise dismiss while the browser footer still shows "Esc to clear"; non-search still shows
the dismiss hint.

## Report

Write the full report (per finding: red-test evidence, fix, covering test command + output) to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave2-report.md`.
Finish with `npm run typecheck` and the full `npx vitest run test/tui/` and include the tallies.
Return only: status (DONE/BLOCKED), commit hashes, one-line test summary, concerns.
Everything you need is in this brief and the cited files — run tools foreground and read their
output in the same turn; do not wait on background notifications.
