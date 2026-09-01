# bl10 fix wave 4 — three small verified findings (final wave)

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). Commands from
`CC-to-SDK/harness/`. `npm run typecheck` + `npx vitest run test/tui/<file>` per finding, full
`npx vitest run test/tui/` at the end. TDD red-first where a unit test applies. Commit per
finding, no Co-Authored-By, explicit-path staging only (shared checkout — never `git add -A`).
Do not touch `reforge/`, `ptc-surface/`, `src/appserver/`.

## W4-1 — hover-cells.sh h1: pin the intended behavior instead of failing by design

`scripts/hover-cells.sh` cell h1 (~:160-175): a prior wave restaged the cell and left its core
assertion deliberately red (`rc=1` when dim-rows don't drop), with a header comment explaining
the hover un-dim was intentionally gated to clickable tool-result owners by T-CLICKGATE Task 2
(bl4, commit f06085c8e) — local `! printf` output never qualifies. But `npm run
test:hover-cells` includes h1, so the suite now always exits nonzero, which poisons the
signal. Flip the cell to assert the INTENDED behavior: hovering staged local output leaves the
dim-row count UNCHANGED (`after_dim` == `before_dim` passes; a DROP is the failure — it would
mean the clickgate regressed). Keep the existing band-negation half (no row gains a background)
exactly as is — it is already an intended-behavior assertion. Rewrite the cell's header comment
and echo copy so they describe the cell as a positive pin of the T-CLICKGATE gate against the
real binary (keep the f06085c8e / hover.test.tsx:407 citations); note the "genuinely hoverable
tool-result fixture" upgrade is tracked as tech debt. Verification: rebuild if needed
(`npm run build`) and run `npm run test:hover-cells` — both cells must pass, exit 0. Tmux
rules: private socket only (the script handles it), never `tmux kill-server`, never touch a
session named `PTC`, tear down only sessions the script creates.

## W4-2 — Flatten and truncate names in the MCP tool-detail view

`src/tui/McpDialog.tsx` (~:270-285): the detail view renders `currentServer.name`,
`tool.name`, and the `annotations.join(", ")` line as raw `Text`, while
`mcpToolDetailDescriptionRows` / `MCP_DETAIL_*` reserve exactly one row each. A name wider
than the dialog (or containing a newline) wraps and can push the frame past the terminal
height (Ink tall-frame replay). Apply the same `flattenLabel` + width-truncation treatment the
root list and tools list already use to these three lines (one physical row each, truncated to
the columns budget the frame gives them). Test: a tool detail with an over-wide name and an
over-wide annotations list renders each on one physical row and total frame height stays
within `rows`; must fail before the fix.

## W4-3 — Don't claim "0 servers" beside a fetch error

`src/tui/McpDialog.tsx` (~:296-300): when `fetchServers()` rejects, the catch keeps
`servers = []` and the frame still renders `subtitle={mcpSubtitle(serverCount)}` → "0 servers"
next to the error message, a contradictory claim (the count is unknown, not zero). Gate the
subtitle on the error state: when `fetchError` is set (and the list is empty because of it),
omit the subtitle entirely. Test: render with a rejecting fetch and assert the error text shows
and the subtitle "0 servers" does NOT; a genuine empty configuration still shows "0 servers".

## Report

Full report (per finding: evidence, fix, test command + output; final typecheck + full
test/tui tallies; the hover-cells run output) to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave4-report.md`.
Return only: status, commit hashes, one-line summary, concerns. Run everything foreground and
read output the same turn — never end a turn waiting on a background notification.
