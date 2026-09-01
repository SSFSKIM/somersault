# bl10 fix wave 2 — fixer A report (code findings F2–F6)

Status: **DONE**. All five findings fixed, each with a TDD red test committed alongside the fix.
`npm run typecheck` clean; full `npx vitest run test/tui/` green (201 files passed, 10 skipped;
5061 tests passed, 11 skipped; 176s).

Commits (in order):

| Finding | Commit | Subject |
|---|---|---|
| F2 | `5df713990` | fix(tui): window Settings read-only tab bodies to the frame budget |
| F3 | `e059407a1` | fix(tui): restore the legacy state fallback in the MCP normalizer |
| F4 | `65caa2de6` | fix(tui): ref-back McpDialog's server/tool focus for useSelectKeys |
| F5 | `b826bd410` | fix(tui): give McpDialog's tools view its own row budget and clip names |
| F6 | `cf3dbe156` | fix(tui): stop Help's keyhint bar from contradicting the search footer |

All commits touch only `src/tui/SettingsDialog.tsx`, `src/tui/mcpDialogModel.ts`,
`src/tui/McpDialog.tsx`, `src/tui/HelpDialog.tsx`, and their respective test files — no touches to
`reforge/`, `ptc-surface/`, `src/appserver/`, or `harness/scripts/`. Each `git add`/`git commit`
staged explicit paths, never `-A`.

---

## F2 — Window the Settings read-only tab bodies

**Red first.** Added two tests to `test/tui/settings-dialog.test.tsx` (describe block "read-only
tab bodies window to the frame budget"): one rendering the Usage tab with 40 fetched lines at
`rows={15}`, asserting the composed frame's line count stays `<= 15`; one with only 4 lines at
`rows={40}`, asserting every line renders and no truncation marker appears. Before the fix, the
first test failed: `expected 47 to be less than or equal to 15` — `readOnlyTabBody` mapped every
fetched `RenderLine` with no windowing at all, so the frame grew unbounded with the payload.

**Fix.** `readOnlyTabBody` now reuses the house `rowBudget.tsx` primitives
(`paintedRows`/`MoreRow`, already used by `GenericPermission.tsx` for the identical "dock-pinned
consult, nothing to scroll" shape): it computes each line's painted-row cost at the tab's
available width (`readOnlyRowWidth`, a new export — `columns - 2` for the plain `paddingX={1}`
inset, no `Select` gutter here), sums against a new `READONLY_CHROME_ROWS = 7` budget (measured
empirically against a real render: border + title + tab strip + spacer + body's trailing blank +
auto keyhint bar + Ink's own `>=` margin), and keeps the head of the list plus a dim
`… +N more lines` marker — inside the budget — when the payload doesn't fit.

**Covering tests.** `npx vitest run test/tui/settings-dialog.test.tsx` → 21 passed.

---

## F3 — Restore the legacy `state` fallback in the MCP normalizer

**Red first.** Added three tests to `test/tui/mcpDialogModel.test.ts`: a row with only
`state: "connected"` (no `status`) must normalize to `status: "connected"`; a row with neither a
known `status` nor a known `state` still falls back to `"failed"`; `status` wins when both are
present. Before the fix: `expected 'failed' to be 'connected'` — `normalizeMcpServers` validated
only `e.status`.

**Fix.** One line: `const rawStatus = e.status ?? e.state;`, validated against `KNOWN_STATUSES`
exactly as before, `"failed"` fallback preserved for a genuinely unrecognized value on either
field. Matches the pre-dialog `/mcp` formatter's own `r.status ?? r.state` (commands.ts:470).

**Covering tests.** `npx vitest run test/tui/mcpDialogModel.test.ts` → 28 passed.

---

## F4 — Ref-backed focus in McpDialog

**Red first, and an honest caveat.** I wrote the exact scenario the brief specifies — a single
batched stdin chunk (`"j\r"`, and separately two batched arrow-downs) driving `McpDialog`,
asserting the second event acts on the post-first-event row — mirroring `select.test.tsx`'s own
regression test for the identical hazard in `Select.tsx`. Before touching `McpDialog.tsx`, I
instrumented both `Select.tsx` (temporarily, reverted after) and `McpDialog.tsx` with debug logs
and confirmed empirically that **this specific reproduction does not currently fail** in this
runtime: `console.error` showed `onMove -> 1`, `onMove -> 2`, `onAccept serverFocus= 2` — correct,
even with the pre-fix plain-`useState` code. Root cause: Ink creates its React container with
`createContainer(rootNode, 0 /* LegacyRoot */, …)` (`ink/build/ink.js:59-61`), and a `setState`
call made outside any batching wrapper (the raw stdin `'data'` handler is exactly that) flushes
**synchronously and immediately** under React 18's Legacy Root — so a render already refreshes the
`useKeyActions` registry between the two events in the same chunk, before the second one dispatches.
I could not, after deliberately trying several angles (double `j`, which parse.ts actually folds
into one text event and doesn't reproduce it either; double arrow-down; boundary-clamp bailouts),
construct a black-box render test that fails pre-fix in this dependency combination.

**What I did anyway.** The fix is objectively correct and required regardless of current
reproducibility: it is `useSelectKeys`' own documented contract (`selectKeys.ts:18-22`, "one stdin
chunk dispatches several events with no render between them" — a defensive assumption this
runtime happens not to violate today, but which every other list surface in this codebase
(`Select.tsx`, `MultiSelect.tsx`) already codes to, and which would silently break the moment Ink
or a future React major moves off Legacy Root). I applied it: `serverFocus`/`toolFocus` are now
`useRefState` (ref-backed, same primitive `Select.tsx`/`SettingsDialog.tsx` already use), the
`index` passed to `useSelectKeys` is a getter reading the ref (`() =>
view.type === "server-tools" ? toolFocusRef.current : serverFocusRef.current`), and both
`onAccept` closures read the ref instead of the state variable. I kept the two same-chunk tests
in `test/tui/mcp-dialog.test.tsx` as regression guards for the documented contract (they pass
both before and after the fix in this runtime, for the reason above — not a true red/green here,
which I'm flagging rather than passing off as one).

**Covering tests.** `npx vitest run test/tui/mcp-dialog.test.tsx test/tui/mcp-wiring.test.tsx
test/tui/mcp-dock-geometry.test.tsx test/tui/mcpDialogModel.test.ts` → 40 passed.

---

## F5 — Tools-view row budget and label truncation

**Red first.** Two tests added to `test/tui/mcp-dialog.test.tsx`: 20 short-named tools at
`rows=14` must render a frame **strictly under** 14 lines (Ink's own hazard is `outputHeight >=
stdout.rows`, matching the "+1: strictly shorter than the pane" term every other chrome budget in
this codebase reserves); 5 tools with a 120-char unclipped name at `rows=14` likewise. Both failed
before the fix: `expected 14 to be less than 14` (exactly at the boundary — the tools view was
borrowing the root list's budget without paying for its own extra chrome) and `expected 17 to be
less than 14` (the long name wrapped under Ink, costing its row 2+ physical lines against a
window that counted it as one).

**Fix.** `mcpDialogModel.ts` gains `mcpToolsVisibleRows(rows) = mcpListVisibleRows(rows -
MCP_TOOLS_EXTRA_CHROME_ROWS)` with `MCP_TOOLS_EXTRA_CHROME_ROWS = 2` (the bold server-name line
and the `marginTop={1}` spacer the tools view draws that the root list never does).
`McpDialog.tsx`'s `server-tools` view now uses this budget instead of `mcpListVisibleRows`
directly, and a new `ToolLabel` component clips the composed `name  description` string to the
row's available columns (`Math.max(10, columns - 4)`, the same chrome `ServerLabel` already
budgets for the root list — pointer + gap + DialogFrame padding), truncating the name itself when
it alone exceeds the width, mirroring `ServerLabel`'s exact discipline from bl10 fix wave 1
finding 4.

**Covering tests.** `npx vitest run test/tui/mcp-dialog.test.tsx test/tui/mcp-wiring.test.tsx
test/tui/mcp-dock-geometry.test.tsx test/tui/mcpDialogModel.test.ts` → 40 passed.

---

## F6 — Help hint bar during search

**Red first.** Updated the existing test in `test/tui/help-dialog.test.tsx` that had (wrongly)
pinned the buggy behavior — it asserted `"dismiss"` stayed visible while searching — removing that
assertion, and added a new test asserting the auto keyhint bar does **not** advertise `"dismiss"`
while a Commands/Custom search is active, that the browser's own `"esc to clear"` footer text is
still present, and that non-search state still shows the real dismiss hint. Before the fix, this
new test failed: the frame contained both `"Type to filter · esc to clear"` (correct) and a
separate `"Esc dismiss"` from the auto bar (the contradiction).

**Fix.** `HelpDialog.tsx`'s `DialogFrame` now passes `hintActions={[]}` instead of
`hintScope={["Help"]}` while `search !== null` — `Help`'s only other bound action
(`app:interrupt`) has no `KEY_HINT_DESCRIPTIONS` row, so an empty explicit set is the true
reachable one, not an approximation. Non-search state is unchanged (`hintScope={["Help",
"Tabs"]}`).

**Covering tests.** `npx vitest run test/tui/help-dialog.test.tsx` → 14 passed.

---

## Full suite

```
npm run typecheck        # clean
npx vitest run test/tui/ # 201 files passed | 10 skipped  ·  5061 tests passed | 11 skipped  ·  176.11s
```

## Concerns

1. **F4's red test doesn't reproduce a live failure in this runtime** (see F4 section above for
   the full instrumented investigation) — the fix is still correct and applied, but it is
   contract-conformance/future-proofing rather than a fix for a currently-observable defect.
   Flagging this explicitly rather than presenting a passing test as a true red→green.
2. Noticed but out of scope: `fixwave2b-brief.md` appeared in the shared directory partway through
   this run (a second fixer's brief, per the "concurrent session" note in my own brief) — did not
   open or act on it.
