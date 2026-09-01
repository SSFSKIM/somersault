# bl10 fix wave 3 — three verified findings in McpDialog

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). All commands from
`CC-to-SDK/harness/`. Never bare `npm test`; use `npm run typecheck` and
`npx vitest run test/tui/<file>`, plus full `npx vitest run test/tui/` at the end. TDD
red-first per finding. Commit per finding, no Co-Authored-By, explicit-path staging only
(never `git add -A` — a concurrent session shares this checkout). Do not touch `reforge/`,
`ptc-surface/`, `src/appserver/`, `harness/scripts/`.

All three findings are verified external-review results against
`src/tui/McpDialog.tsx` (and possibly `src/tui/mcpDialogModel.ts` if you put helpers there).
Context: the dialog is a view-stack browser (`list → server-menu → server-tools →
server-tool-detail`) built this round; it received earlier fix waves (root-row truncation
~:149-152, a tools-specific row budget, ref-backed focus), so read the current file before
assuming line numbers.

## RF2 — Flatten multiline labels before measuring/truncating

A tool description containing `\n` is valid MCP metadata. `stringWidth` ignores line breaks
while the render path preserves them, so one option can paint multiple terminal rows even
though the tools-view budget counts it as exactly one — overflowing the dialog or clipping
the footer (in the classic renderer this can trigger Ink's tall-frame replay, the harness's
cardinal geometry hazard). Fix: normalize embedded line breaks (and any control whitespace)
to single spaces before width measurement and truncation, wherever tool names/descriptions
and server labels are composed into single-row options. Test: a tool whose description
contains `\n` renders as ONE physical row within the budget.

## RF3 — Server-menu navigation must not clobber root focus

In the `server-menu` view the select-keys arm has `count` 0-or-1 but `onMove` writes the
clamped result into `serverFocus` (the ROOT list's cursor). Open server #3, press j/k in the
menu, press Esc: root focus has been reset to the first server. Fix: in `server-menu`, make
movement a no-op (the view has at most one focusable row — there is nothing to move between);
do NOT write to `serverFocus` from that view. Test: enter a non-first server's menu, send a
movement key, Esc back, assert the root list focus is still on that server (must fail before
the fix).

## RF4 — Bound the server-menu and tool-detail views

`server-menu` renders field values (e.g. a server's error/command string) and
`server-tool-detail` renders the full description verbatim — both without clipping or
windowing. A long diagnostic exceeds terminal height → tall-frame replay (classic) or
unreachable content past the frame (fullscreen). Fix: apply the dialog's row/column budget to
these views too — clip each field value to one physical row (same normalize+truncate helper
as RF2 where it fits), and for the tool-detail description, wrap-or-clip to the rows
available inside the frame chrome with a dim truncation indicator when clipped (mirror the
`readOnlyTabBody` clipping pattern in `src/tui/SettingsDialog.tsx` — wave 2's F2 fix — for
budget arithmetic and indicator style). Test: short-`rows` render of (a) a server-menu whose
error field is very long and (b) a tool detail with a many-line description — total frame
height stays ≤ rows.

## Report

Full report (per finding: red evidence, fix, covering test command + output, final typecheck
+ full test/tui tallies) to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave3-report.md`.
Return only: status, commit hashes, one-line test summary, concerns. Run tools foreground and
read their output in the same turn — never end a turn waiting on a background notification.
