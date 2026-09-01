# bl10 fix wave 4 — report

Repo: `/Users/new/Developer/GitHub/somersault`, branch `main`, in place. All commands run from
`CC-to-SDK/harness/`.

## W4-1 — hover-cells.sh h1: pin the intended behavior instead of failing by design

**Evidence.** `scripts/hover-cells.sh`'s `run_h1_cell` asserted `after_dim -ge before_dim` as a
FAIL condition with an explicit "expected FAIL" comment (T-CLICKGATE Task 2, bl4, commit
f06085c8e, gated hover un-dim to `clickable`-stamped owners; local/`visual` events never qualify).
Since `npm run test:hover-cells` always runs h1, the suite permanently exited nonzero.

**Fix.** `src/tui/../scripts/hover-cells.sh`:
- Header comment above `run_h1_cell` rewritten to describe the cell as a POSITIVE pin of the
  T-CLICKGATE Task 2 gate: hovering staged local (non-`clickable`) content must leave the dim-row
  count unchanged; a DROP is now named as the actual regression this cell watches for. Kept the
  f06085c8e / `hover.test.tsx` citations. Added a tech-debt note: the staged fixture is a keyless
  local echo, not a genuinely hoverable `clickable`-stamped tool-result owner — upgrading it would
  let the cell also assert the positive un-dim path.
- Cell's echo line updated to describe the pinned-positive intent instead of "expected FAIL".
- Core assertion flipped: `if [ "$after_dim" -ne "$before_dim" ]` (was `-ge`) → a count CHANGE
  (specifically a drop) is now the failure, not the pass condition.
- The band-negation half (no row gains a background) was left untouched, as instructed.

**Verification.**
```
$ npm run build                # tsc -p tsconfig.build.json — clean
$ npm run test:hover-cells
hover-cells: h1 h2
  cell h1: staged local content hover — dim-row count stays unchanged (T-CLICKGATE Task 2, f06085c8e)
  PASS h1
  cell h2: palette hover swaps rows, arrows take it back, click accepts
  PASS h2

hover-cells: 2 passed, 0 failed
```
Exit code 0. `tmux ls` before and after showed only the pre-existing `PTC` session (untouched);
no other sessions were created/left over across all three runs of this script in this wave.

Commit: `a5cd9cfc0` — `fix(hover-cells): pin h1 as a positive assertion of the T-CLICKGATE gate`.

## W4-2 — Flatten and truncate names in the MCP tool-detail view

**Evidence.** `src/tui/McpDialog.tsx`'s `server-tool-detail` view rendered `currentServer.name`,
`tool.name`, and `annotations.join(", ")` as raw `<Text>`, while `MCP_DETAIL_FIXED_ROWS` /
`MCP_DETAIL_ANNOTATIONS_ROWS` (`mcpDialogModel.ts`) budget exactly one row each. A name wider than
the dialog (or containing a `\n`) wraps under Ink and can push the frame past `rows` — the same
tall-frame hazard RF2/RF4 already fixed for `ServerLabel`/`ToolLabel`/`serverMenuFields`.

**Fix.** Applied the same `flattenLabel` (collapse whitespace/newlines) + `truncateLabel` (clip to
budget, ellipsis) treatment already used elsewhere in the file to all three lines: `currentServer.
name` and `tool.name` truncated to `detailWidth` (`columns - 2`, the width already computed for
the description), and the annotations line truncated to `columns - 3 - stringWidth("Annotations:")`
(mirroring `serverMenuFields`'s own field-value width formula).

**Test (TDD, verified red before the fix).** Added
`McpDialog — tool-detail name/annotations flatten and truncate (bl10 fw4 W4-2)` in
`test/tui/mcp-dialog.test.tsx`: a server + tool each with a 500-character repeated-char name and a
full 3-value annotations list, rendered at `rows=14, columns=40`. Asserts the composed frame stays
under 14 lines and that the full untruncated annotations string does not appear.
- **Before the fix** (verified by `git stash push -- src/tui/McpDialog.tsx`, running the test,
  then `git stash pop`): `expected 19 to be less than 14` — confirmed red.
- **After the fix:** frame collapses to 9 lines; `Annotations: read-only, destructive, …` (ellipsis
  present, full string absent).

**Verification.**
```
$ npx vitest run test/tui/mcp-dialog.test.tsx
 ✓ test/tui/mcp-dialog.test.tsx (24 tests)
 Test Files  1 passed (1)
      Tests  24 passed (24)
$ npm run typecheck   # tsc --noEmit — clean
```

Commit: `49adf21b4` — `fix(mcp-dialog): flatten and truncate names in the tool-detail view`.

## W4-3 — Don't claim "0 servers" beside a fetch error

**Evidence.** In `McpDialog`, a rejected `fetchServers()` sets `fetchError` and `servers = []`, but
the frame always rendered `subtitle={mcpSubtitle(serverCount)}` → "0 servers" next to the error
line — a contradictory claim, since the real count is unknown, not zero.

**Fix.** `const mcpDialogSubtitle = fetchError === undefined ? mcpSubtitle(serverCount) : undefined;`
— the subtitle is passed only when there is no live fetch error; `DialogFrame`'s `DialogHeader`
already treats `subtitle == null` as "render nothing" (`subtitle?: React.ReactNode`), so no other
change was needed. A genuine empty configuration (no `fetchError`) is unaffected and still shows
"0 servers" (covered by the pre-existing "shows the canon empty-list message" test).

**Test (TDD, verified red before the fix).** Added
`McpDialog — subtitle omitted beside a fetch error (bl10 fw4 W4-3)` in
`test/tui/mcp-dialog.test.tsx`: renders with a rejecting `fetchServers`, asserts the error text
shows and `"0 servers"` does not.
- **Before the fix:** `expected '...Manage MCP servers 0 servers ✗ Couldn't load MCP servers:
  ECONNRESET Esc cancel' not to contain '0 servers'` — confirmed red.
- **After the fix:** passes; error text present, "0 servers" absent.

**Verification.**
```
$ npx vitest run test/tui/mcp-dialog.test.tsx
 ✓ test/tui/mcp-dialog.test.tsx (24 tests)
 Test Files  1 passed (1)
      Tests  24 passed (24)
$ npm run typecheck   # tsc --noEmit — clean
```

Commit: `374927576` — `fix(mcp-dialog): don't claim "0 servers" beside a fetch error`.

## Final tallies

```
$ npm run typecheck
> tsc --noEmit
(clean, no output)

$ npx vitest run test/tui/
 Test Files  201 passed | 10 skipped (211)
      Tests  5067 passed | 11 skipped (5078)
 Duration    174.88s

$ npm run build && npm run test:hover-cells
hover-cells: h1 h2
  cell h1: staged local content hover — dim-row count stays unchanged (T-CLICKGATE Task 2, f06085c8e)
  PASS h1
  cell h2: palette hover swaps rows, arrows take it back, click accepts
  PASS h2

hover-cells: 2 passed, 0 failed
```

All 24 skipped tests in the `test/tui/` run are the pre-existing `live/*.e2e.test.ts` files and the
`hover-cost.bench.test.tsx` bench file, which gate on live credentials/opt-in flags not present in
this run — unrelated to this wave.

Files touched: `scripts/hover-cells.sh`, `src/tui/McpDialog.tsx`, `test/tui/mcp-dialog.test.tsx`.
No changes to `reforge/`, `ptc-surface/`, or `src/appserver/`. All three commits used explicit-path
`git add`, no `git add -A`.

## Status: complete

Commits (in order, all on `main`):
- `a5cd9cfc0` — fix(hover-cells): pin h1 as a positive assertion of the T-CLICKGATE gate
- `49adf21b4` — fix(mcp-dialog): flatten and truncate names in the tool-detail view
- `374927576` — fix(mcp-dialog): don't claim "0 servers" beside a fetch error

Concerns: none blocking. Tech debt noted inline in h1's header comment (staged fixture is a
keyless local echo, not a genuinely `clickable`-stamped tool-result owner — tracked as a known gap,
not fixed in this wave per the brief's scope).
