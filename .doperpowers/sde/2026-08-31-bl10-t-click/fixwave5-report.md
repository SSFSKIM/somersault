# bl10 fix wave 5 — report

## Finding

`src/tui/McpDialog.tsx` rendered `currentServer.name` as a raw, unflattened, untruncated heading in
the server-menu view (`~:209`) and the server-tools view (`~:236`). An over-wide or newline-carrying
server name wraps under Ink past what `mcpToolsVisibleRows()`/the menu's own chrome accounting charge
for it, risking a tall-frame overflow.

## The fix — one normalization invariant, not another per-site patch

1. **Model boundary** (`src/tui/mcpDialogModel.ts`): `normalizeMcpServers`/`normalizeTool` now run every
   MCP-metadata string field through `flattenLabel` (collapsing embedded newlines/control whitespace to a
   single space) at the point raw external data enters the type: server `name`, `error`, `config.type`,
   `config.url`, `config.command`, tool `name`, tool `description`. `flattenLabel` itself already lived in
   this module (exported), so no move was needed — this wave promotes it from a per-render-site helper to
   the sole normalization-time guarantee.
2. **Two heading sites** (`src/tui/McpDialog.tsx`): the server-menu heading (`currentServer.name` above the
   field block) and the server-tools heading (`currentServer.name` above the tool list) are now truncated
   with `truncateLabel(currentServer.name, Math.max(1, columns - 2))` — the same arithmetic style as the
   existing `detailWidth` treatment in `server-tool-detail` (no `Row` gutter, just the frame's own
   `paddingX` either side).
3. **Simplification**: the now-redundant per-render `flattenLabel` calls in `ServerLabel`, `ToolLabel`, the
   `server-menu` field-value line, and `server-tool-detail`'s name/tool-name/annotations lines were removed
   (width truncation via `truncateLabel` was kept everywhere). The `flattenLabel` import in `McpDialog.tsx`
   was dropped since nothing in that file calls it directly anymore.

## Tests (red-first)

Added to `test/tui/mcpDialogModel.test.ts`:
- Updated `"carries raw names and descriptions through untouched"` -> `"...through as-is beyond whitespace
  flattening"`: now expects the tool description's embedded `\n`/`\t` collapsed to spaces (previously
  asserted verbatim pass-through, which is exactly the invariant this wave closes).
- New: `"flattens embedded newlines/control whitespace in every metadata string field, at normalization"` —
  pins that `name`, `error`, `type`, `url`, `command`, tool `name`, tool `description` are all flattened by
  `normalizeMcpServers`.

Added to `test/tui/mcp-dialog.test.tsx` (`describe("McpDialog — server-menu/server-tools headings flatten
and truncate (bl10 fw5)")`):
- server-menu / server-tools, over-wide name: total frame height with a 2000-char name equals the height
  with a short control name (i.e. the heading occupies exactly its one budgeted row, not several wrapped
  ones).
- server-menu / server-tools, newline-carrying name: total frame height with an embedded `\n` equals the
  height with the already-flattened equivalent string.

These four tests, and the pre-existing RF2 multiline-description test, route their raw payload through
`normalizeMcpServers()` (the same call `useChat.ts`'s `fetchMcpServers` makes) rather than hand-constructing
an already-typed `McpServerRow` — the newline-flattening guarantee now lives solely at that boundary, so a
test bypassing it would be exercising a value production can never produce.

### Red evidence (before the fix)

```
✗ normalizeMcpServers > carries raw names and descriptions through untouched (no title-casing, no truncation)
✗ normalizeMcpServers > flattens embedded newlines/control whitespace in every metadata string field, at normalization
✗ McpDialog — server-menu/server-tools headings flatten and truncate (bl10 fw5) > server-tools: an over-wide server name renders as one physical row, keeping the frame within rows
  (initial draft of the test, before it was reshaped into the control-comparison form below)
```

After reshaping the McpDialog tests into the control-comparison form (comparing total frame height against
a short-name/flattened-name control, rather than a hard-coded row count) and wiring the fixtures through
`normalizeMcpServers`, the red state was:

```
Test Files  1 failed (1)
     Tests  3 failed | 25 passed (28)
  × McpDialog — multiline tool descriptions flatten to one physical row (bl10 fw3 RF2) > a tool description containing \n renders as ONE physical row, within the tools-view budget
  × McpDialog — server-menu/server-tools headings flatten and truncate (bl10 fw5) > server-menu: a server name containing a newline renders as one physical row, same total height as its flattened form
  × McpDialog — server-menu/server-tools headings flatten and truncate (bl10 fw5) > server-tools: a server name containing a newline renders as one physical row, same total height as its flattened form
```

(The RF2 test regressed here because it still hand-constructed its `McpServerRow` fixture — bypassing
`normalizeMcpServers` — after the per-render `flattenLabel` call it relied on was removed from `ToolLabel`.
Fixed by routing its fixture through `normalizeMcpServers()` too, matching production wiring.)

## Per-file test output (green, after the fix)

```
npx vitest run test/tui/mcp-dialog.test.tsx test/tui/mcpDialogModel.test.ts test/tui/mcp-wiring.test.tsx test/tui/mcp-dock-geometry.test.tsx
 ✓ test/tui/mcp-dialog.test.tsx (28 tests)
 ✓ test/tui/mcp-dock-geometry.test.tsx (6 tests)
 ✓ test/tui/mcpDialogModel.test.ts (29 tests)
 ✓ test/tui/mcp-wiring.test.tsx (6 tests)
 Test Files  4 passed (4)
      Tests  69 passed (69)
```

## Final typecheck + full test/tui tally

```
npm run typecheck
> tsc --noEmit
(clean, no output)

npx vitest run test/tui/
 Test Files  201 passed | 10 skipped (211)
      Tests  5072 passed | 11 skipped (5083)
 Duration    172.03s
```

Skipped files are the gated `test/tui/live/*.e2e.test.ts` suites (require a live API key/OAuth token) plus
one bench test — expected, not new.

## Commits

- `31b2bf5da` — bl10 fw5 tests: red — server-menu/server-tools headings wrap/paint past their row budget
- `f731f1406` — bl10 fw5: flatten MCP metadata strings once, at the normalization boundary

(Both on `main`, `CC-to-SDK/harness`, explicit-path staged, no `Co-Authored-By`.)

## Files touched

- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/mcpDialogModel.ts`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/McpDialog.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/mcpDialogModel.test.ts`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/mcp-dialog.test.tsx`

## Concerns

None outstanding. `reforge/`, `ptc-surface/`, `src/appserver/`, `harness/scripts/` were not touched.
`git add -A` was never used — both commits staged the four files above by explicit path.
