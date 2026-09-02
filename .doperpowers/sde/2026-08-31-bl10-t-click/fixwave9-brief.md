# bl10 fix wave 9 — one finding: the Settings scroll window can skip an oversized line forever

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). Commands from
`CC-to-SDK/harness/`. `npm run typecheck` + `npx vitest run test/tui/status-family-dialog.test.tsx`
(and whichever file holds the `readOnlyScrollWindow` tests), full `npx vitest run test/tui/` at the
end. TDD red-first. One commit, no Co-Authored-By, explicit-path staging (shared checkout — never
`git add -A`). Only `src/tui/SettingsDialog.tsx` + its tests.

## The finding (P2, verified, destructive)

`readOnlyScrollWindow` (`src/tui/SettingsDialog.tsx` ~:157-175) windows the read-only tab body by
LOGICAL lines: the `end` loop adds `costs[end]` (that line's wrapped physical-row count) until the
budget is exceeded. When ONE logical line wraps to more physical rows than the whole budget — e.g. a
long per-model cost row or a long fetch-error line on a short, narrow pane — then at `start === i`
the loop breaks immediately (`end === start`, nothing shown), and because scrolling advances by
logical lines, that line is rendered at NO offset: permanent content loss, the exact thing the
scroll shipped to prevent.

## The fix

Guarantee every logical line is reachable: when the line at `start` alone exceeds the budget,
render it PARTIALLY — its first `budget` painted rows (the `paintedRows(l.text, width)` slices the
function already computes) with the overflow markers still accounting truthfully. Keep the change
inside the windowing seam: e.g. have `readOnlyScrollWindow` (or a sibling helper the render calls)
return, for the oversized-at-start case, the physical-row slice to paint instead of a logical
range — pick the smallest API that keeps existing callers/tests green. Frame height must stay ≤
`rows` at every offset (the wave-2/wave-8 invariant tests must stay green). Deeper physical-row
scrolling INSIDE one oversized line is not required this round: showing its head at its offset
(with the `↓ more` marker) is sufficient — no logical line may be entirely unreachable.

Tests (red-first): narrow width + short rows + one logical line whose wrapped cost exceeds the
budget, surrounded by normal lines — before the fix, scrolling to that line renders none of it
(assert the current skip to prove red); after, its head rows render at its offset and the frame
stays within `rows`; normal payloads and the existing scroll tests unchanged.

## Report

Append to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave9-report.md`
(red evidence, fix, test output, final typecheck + full test/tui tallies).
Return only: status, commit hash, one-line summary, concerns. Run everything foreground and read
output the same turn — never end a turn waiting on a background notification.
