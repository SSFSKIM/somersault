# F10 T-HOVER Task 3 — the `\x1b[2m` strip measurement

Spec (§ H1, last bullet): "Measure the per-row `\x1b[2m` regex strip across a tall hovered block; memoize
if it shows." Research r2 §5 named the concern: `Line.tsx:35`'s `unDimRaw` re-runs `DIM_SGR.replace` on
every `preStyled` segment's raw bytes, once per hovered row, on EVERY re-render while a block is hovered.
H1's ownerKey grouping (Task 1) widened "hovered" from one row to a whole message, so a hovered 40-row
tool block would do the strip 40× per frame while the pointer sits over it — the one place the change
multiplies work.

## Harness

`test/tui/hover-cost.bench.test.tsx`, skipped unless `HOVER_COST_BENCH=1` (an instrument, never part of
the normal suite — a timing assertion in CI is a flake generator). It builds a 40-row `gutter-block`
`RenderItem` whose every body row carries a `preStyled` segment produced by `composeFoldRun`
(`src/tui/sgrFoldRow.ts`) — the codebase's real (only) writer of a `preStyled` dim run, not a hand-typed
`\x1b[2m…` literal — each row given DISTINCT clause text so the 40 rows are not byte-identical (a real
tool result's lines never are; this is the harder case for a memo to earn its keep against, since only
repeats ACROSS FRAMES of the same 40 raw strings — not repeats within one frame — are what a memo could
collapse).

Two measurements:
1. **End-to-end**: mount `RenderItemView` over the 40-row block inside `HoverContext.Provider`, then
   `rerender()` the identical element 200 times at a fixed `hovered` value (exactly what Ink does on every
   repaint — these are plain function components, no `React.memo` bailout anywhere on this path). Reports
   ms/frame for `hovered=false` (cold) and `hovered=true` (hot), and the delta.
2. **Isolated**: `raw.replace(DIM_SGR, "")` over the same 40 rows' raw bytes, 2000 reps, no React at all —
   isolates what fraction of any end-to-end delta is the regex itself vs. React rebuilding 40 `<Text>`
   trees it rebuilds on every re-render regardless of hover state (r2 §5's own point).

## Runs

Three consecutive foreground runs, `HOVER_COST_BENCH=1 npx vitest run test/tui/hover-cost.bench.test.tsx`:

| run | cold (not-hovered) ms/frame | hot (hovered) ms/frame | delta | isolated regex ms/frame-equiv (40 rows, no React) |
|---|---|---|---|---|
| 1 | 1.234 | 1.078 | -0.157 | 0.0032 |
| 2 | 1.255 | 1.066 | -0.189 | 0.0033 |
| 3 | 1.236 | 1.073 | -0.163 | 0.0034 |

**Medians: cold 1.236 ms/frame, hot 1.073 ms/frame, delta -0.163 ms, isolated regex 0.0033 ms/frame.**

Machine context: this is a shared dev Mac (not a dedicated benchmark rig, no CPU pinning, other processes
running), so these are indicative timings, not a lab measurement — but the numbers are decisive enough
(three orders of magnitude below the threshold, and the "hovered" case measures no slower than "not
hovered" at all) that ordinary machine noise cannot be hiding a real cost here.

## Reading the numbers

- The end-to-end delta is **negative in all three runs** — the hovered render measured *faster* than the
  not-hovered one, by noise (~0.15-0.19 ms), not effect. There is no measurable end-to-end cost from
  hovering a 40-row block at all, let alone one attributable to `unDimRaw`.
- The isolated regex strip over all 40 rows together costs **~0.003 ms per frame-equivalent** — roughly
  400× smaller than the noise band on the end-to-end measurement, and about 0.01% of Ink's 32 ms repaint
  throttle. `String.prototype.replace` over ~80-character strings, 40 times, is simply too cheap to show up
  against React reconciling 40 `<Text>` trees (millisecond-scale) or against ordinary process jitter.

## Decision

Threshold (stated before measuring, per the brief): Ink's repaint throttle is 32 ms; **under 1 ms/frame
delta (~3% of budget) → no memo ships; at or above 1 ms → ship Step 4.**

Measured delta: **-0.163 ms (median)** — hovered is not measurably slower than not-hovered, and the
isolated regex cost (0.0033 ms) is roughly 300× under the 1 ms line even taken alone.

**Verdict: NO MEMO SHIPS.** The strip does not show. `memoizeByInput` was not added to `Line.tsx`; no
change was made to `src/tui/Line.tsx` or `test/tui/hover.test.tsx`. The only new file is the bench harness
itself, which stays in the tree as a skipped instrument for re-measuring if a future change (e.g. much
taller blocks, or a heavier per-row transform) reopens the question.

## Files

- `CC-to-SDK/harness/test/tui/hover-cost.bench.test.tsx` — new, the bench harness (skipped unless
  `HOVER_COST_BENCH=1`).
- `src/tui/Line.tsx` — unchanged (measurement did not justify the memo).
- This report.
