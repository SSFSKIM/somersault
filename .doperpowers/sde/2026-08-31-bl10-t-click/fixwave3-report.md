# bl10 fix wave 3 report — three verified findings in McpDialog

Repo: `/Users/new/Developer/GitHub/somersault`, branch `main`, worked in place under `CC-to-SDK/harness`.
TDD red-first per finding; one commit per finding; explicit-path staging only (never `git add -A`).

## RF2 — Flatten multiline labels before measuring/truncating

**Red evidence.** Added a test to `test/tui/mcp-dialog.test.tsx` mounting a tool whose description is 12
lines joined by `\n`, opened the `server-tools` view at `rows=14`, and asserted the composed frame stayed
under 14 lines. Before the fix it failed — the frame painted the description across 12 real terminal rows
(`❯ multiline-tool   line-0` followed by 11 more indented lines), pushing the total frame to 19+ lines even
though `mcpToolsVisibleRows` had budgeted exactly one row for that option. `stringWidth` measures `\n` as
zero-width while Ink's `<Text>` paints it as a real line break, so measurement and paint disagreed.

**Fix.** Added `flattenLabel(s)` to `src/tui/mcpDialogModel.ts` — collapses any run of whitespace (including
embedded `\n`/`\t`/`\r`) to a single space and trims. Applied it in `ServerLabel` and `ToolLabel`
(`src/tui/McpDialog.tsx`) to the server name, status text, tool name and tool description *before*
`stringWidth` measurement and `truncateLabel` truncation, so every quantity that composes a single-row
option is guaranteed single-line before its width is ever measured.

**Covering test + output.**
```
npx vitest run test/tui/mcp-dialog.test.tsx -t "RF2"
```
```
✓ McpDialog — multiline tool descriptions flatten to one physical row (bl10 fw3 RF2)
   a tool description containing \n renders as ONE physical row, within the tools-view budget
```

Commit: `51a5b587d` — `fix(mcp-dialog): flatten multiline labels before measuring/truncating (RF2)`

## RF3 — Server-menu navigation must not clobber root focus

**Red evidence.** Added a test that moves the root cursor to the third server (`c-server`), enters its
`server-menu`, presses `j` then `k` (movement keys inside the menu, which has only one focusable row), pops
back to the root with Esc, then re-enters via Enter. Before the fix this reopened `a-server`'s menu instead
of `c-server`'s — the root list's own cursor had been silently reset to index 0. Root cause:
`useSelectKeys`'s shared `onMove` wrote every clamped move into `serverFocus` (the root list's cursor)
regardless of which view was active; in `server-menu` `count` is 0-or-1, and with `count===1` the clamped
target of any move is always `0`, so a single j/k press there always called `onMove(0)` → `setServerFocus(0)`.

**Fix.** In `src/tui/McpDialog.tsx`, the `useSelectKeys` `index`/`onMove` callbacks now branch on the view
type explicitly: `index` reads `toolFocusRef` for `server-tools`, `serverFocusRef` for `list`, and a fixed
`0` for every other view; `onMove` only calls `setToolFocus`/`setServerFocus` for those same two views and is
a no-op everywhere else (`server-menu`, `server-tool-detail`) — there is nothing to move a cursor between in
those views, so movement there no longer touches any focus state.

**Covering test + output.**
```
npx vitest run test/tui/mcp-dialog.test.tsx -t "RF3"
```
```
✓ McpDialog — server-menu navigation must not clobber root focus (bl10 fw3 RF3)
   moving in a non-first server's menu leaves the root list focused on that same server after Esc
```

Commit: `0e9193e35` — `fix(mcp-dialog): server-menu navigation must not clobber root focus (RF3)`

## RF4 — Bound the server-menu and tool-detail views

**Red evidence.** Two tests added to `test/tui/mcp-dialog.test.tsx`, both at `rows=14`:
(a) a `server-menu` whose `error` field is a ~700-character string — before the fix the frame painted 15
lines (`expected 15 to be less than 14`); (b) a `server-tool-detail` with a 40-line description — before the
fix the frame painted 49 lines (`expected 49 to be less than 14`). Neither view clipped or windowed its
content; both rendered field values / the description verbatim.

**Fix.**
- `server-menu` field rows (`Type:`/`URL:`/`Command:`/`Status:`) now clip their *value* to one physical row:
  flattened with RF2's `flattenLabel`, then `truncateLabel`'d to `columns - 3 - stringWidth(label)` (the
  `DialogFrame` paddingX of 2 plus the field row's own `gap={1}`).
- `server-tool-detail`'s description is now wrapped and windowed instead of dumped verbatim, mirroring
  `SettingsDialog`'s `readOnlyTabBody`/F2 pattern: `paintedRows` (from `src/tui/dialogs/rowBudget.tsx`) wraps
  the description to `columns - 2`, a new `mcpToolDetailDescriptionRows(rows, hasAnnotations)` helper (added
  to `src/tui/mcpDialogModel.ts`) computes the rows left for the description after this view's own fixed
  chrome (server-name line, tool-name line, the `Description:` label and spacer, plus the
  `Annotations:` block when present), and `bodyWindow` + a dim `MoreRow` (`… +N more lines`) clip and mark
  the cut exactly like the read-only Settings tabs do.

**Covering test + output.**
```
npx vitest run test/tui/mcp-dialog.test.tsx -t "RF4"
```
```
✓ McpDialog — server-menu and tool-detail are bounded to the row budget (bl10 fw3 RF4)
   a server-menu whose error field is very long stays within the short-terminal row budget
   a tool-detail description with many lines stays within the short-terminal row budget
```

Commit: `9c40f611d` — `fix(mcp-dialog): bound the server-menu and tool-detail views (RF4)`

## Final verification

```
npm run typecheck
```
→ clean, no errors.

```
npx vitest run test/tui/
```
→ `201 passed | 10 skipped (211 files)`, `5065 passed | 11 skipped (5076 tests)`, 0 failed.

## Concerns

- `MCP_DETAIL_FIXED_ROWS`/`MCP_DETAIL_ANNOTATIONS_ROWS` (and the field-value width's `- 3` chrome constant)
  are hand-derived from the current render tree the same way `MCP_LIST_CHROME_ROWS`/
  `MCP_TOOLS_EXTRA_CHROME_ROWS` already are in this file — correct for today's layout but will need a
  matching update if `server-menu`'s field-row layout or `server-tool-detail`'s fixed lines ever change shape.
- `flattenLabel` trims the value in addition to collapsing internal whitespace runs; this is a very minor
  behavior change for any label that legitimately started/ended with whitespace (none of the current fixtures
  do), noted rather than fixed further since it is the same normalization the brief asked for.
