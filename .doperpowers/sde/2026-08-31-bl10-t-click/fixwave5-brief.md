# bl10 fix wave 5 — one invariant: every MCP metadata string is single-line at the source

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). Commands from
`CC-to-SDK/harness/`. `npm run typecheck`; `npx vitest run test/tui/mcp-dialog.test.tsx
test/tui/mcpDialogModel.test.ts` (and any other mcp test files you find); full
`npx vitest run test/tui/` at the end. TDD red-first. One or two commits, no Co-Authored-By,
explicit-path staging (shared checkout — never `git add -A`). Do not touch `reforge/`,
`ptc-surface/`, `src/appserver/`, `harness/scripts/`.

## The finding (verified, external review)

`src/tui/McpDialog.tsx` renders `currentServer.name` as a raw heading in the server-menu view
(~:209) and again in the server-tools view (~:236). A server name wider than the dialog — or
containing a newline — wraps into extra physical rows that `mcpToolsVisibleRows()` and the
menu's chrome accounting never charge (e.g. a long valid name → 17-line frame at rows=14 →
clipping or Ink's tall-frame replay).

## The fix — an invariant, not another site patch

Three prior waves bounded labels site-by-site (root rows, tools-list labels, detail names).
This wave closes the class:

1. **Model boundary:** in `src/tui/mcpDialogModel.ts`'s normalization, flatten EVERY string
   that comes from MCP metadata — server name, tool name, tool description, annotation
   strings, error/command/url field values — collapsing newlines/control whitespace to single
   spaces (reuse/move the existing `flattenLabel` helper from McpDialog.tsx; export it from the
   model). After this, no render site can ever see an embedded newline. Simplify any
   now-redundant per-site flatten calls in McpDialog.tsx (keep their width truncation).
2. **The two heading sites:** truncate the server-name heading in the server-menu and
   server-tools views to the columns budget (same arithmetic style as the existing
   `rootRowWidth` / detail-name treatment), so an over-wide name occupies exactly the one row
   the budgets reserve.

Tests (red-first): a server whose name contains a newline and a server with an over-wide name —
in BOTH the server-menu and server-tools views — render the heading as one physical row and
total frame height stays within `rows`; a model-level test pins that normalization flattens
newlines in every metadata field.

## Report

Full report to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave5-report.md`
(red evidence, fix, per-file test output, final typecheck + full test/tui tallies).
Return only: status, commit hashes, one-line summary, concerns. Run everything foreground and
read output the same turn — never end a turn waiting on a background notification.
