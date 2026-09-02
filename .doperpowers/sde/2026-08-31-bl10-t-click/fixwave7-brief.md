# bl10 fix wave 7 — close three recurring defect classes (sweeps, not site patches)

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). Commands from
`CC-to-SDK/harness/`. `npm run typecheck`; per-file vitest runs while iterating; full
`npx vitest run test/tui/` at the end. TDD red-first per finding. Commit per finding, no
Co-Authored-By, explicit-path staging only (shared checkout — never `git add -A`). Do not touch
`reforge/`, `ptc-surface/`, `src/appserver/`, `harness/scripts/`.

Context: an external review loop has now found the SAME three defect classes at successive
sites across the new bl10 dialog code. This wave's mandate is to close each class everywhere it
exists, so the next review cannot find a fourth site. For each finding: fix the cited site,
then sweep the named surface for remaining instances and fix those too, and say in your report
what the sweep covered and what it found.

## W7-1 — Hint bars must reflect the active input state (cited: Settings Config search)

`src/tui/SettingsDialog.tsx` ~:547-548: while the Config tab's `/` query is open, `Select` is
unmounted and `Tabs` is disabled, yet the frame still derives hints from the full
Settings+Tabs scopes — the bar advertises navigate/select/search while keys actually edit the
query, contradicting the adjacent `SEARCH_FOOTER`. Fix like `HelpDialog`'s search state (see
its `hintScope={search !== null ? ...}` arm): a search-specific (or empty) `hintActions` set
while the query is open. THEN SWEEP: enumerate every `hintScope`/`hintActions` usage across
`src/tui/` (DialogFrame consumers) and check each against the states its dialog can be in
(searches, sub-pickers, loading, empty lists, read-only tabs, immutable rows). Fix any state
where an advertised action has no live handler. Precedents to mirror: HelpDialog search arm,
SettingsDialog read-only arm, PermissionsDialog Workspace focus-derived arm, McpDialog
count-gated arm. Tests: Config-search state shows no stale navigate/select/search hints (red
first); one test per additional site the sweep fixes.

## W7-2 — No unbounded string may reach a dialog frame (cited: MCP fetch-error message)

`src/tui/McpDialog.tsx` ~:171-174: the fetch-error path renders the raw `Error.message` with
no width/row bounding — a long or multiline message can push the frame past `rows` (Ink
tall-frame replay). Fix: flatten (the model exports `flattenLabel`) and clip the failure text
to the columns/rows budget like every other string in the dialog. THEN SWEEP the bl10 dialog
surfaces (`McpDialog.tsx`, `SettingsDialog.tsx`, `PermissionsDialog.tsx`, `HelpDialog.tsx`,
`DialogFrame.tsx` — title/subtitle/titleEnd props included) for any other string rendered
without width-or-row bounding where the value is not a compile-time literal; bound what you
find. Tests: multiline/over-long fetch error renders bounded within `rows` (red first).

## W7-3 — Identity must be the raw name; flattening is display-only (wave-5 regression)

`src/tui/mcpDialogModel.ts` ~:63-65: the normalization now applies `flattenLabel` to
`name` itself, but `name` is the row identity — React keys, `findServer` lookups, the view
stack's `server` field. Two configured servers whose names differ only in whitespace/newlines
collapse to one identity and the second row resolves the first server's details. Fix: keep the
RAW name as `name` (identity, never flattened); add a `label` (flattened) field the render
sites use for display. Update `McpDialog.tsx` render sites to show `label` while keys/lookups/
view-stack entries use `name`. Keep flattening for the non-identity fields (description,
error, url, command, etc.). Tests (red first): two servers `"foo"` and `"foo "` normalize to
distinct rows; selecting the second opens the second's details; display still shows the
flattened form (headings stay one row for a newline-bearing name — the wave-5 tests must stay
green via `label`).

## Report

Full report (per finding: red evidence, fix, sweep inventory + what it caught, test output;
final typecheck + full test/tui tallies) to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave7-report.md`.
Return only: status, commit hashes, one-line summary, concerns. Run everything foreground and
read output the same turn — never end a turn waiting on a background notification.
