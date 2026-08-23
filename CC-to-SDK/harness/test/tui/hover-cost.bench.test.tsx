// test/tui/hover-cost.bench.test.tsx — F10 T-HOVER Task 3: MEASURES (does not assert) the per-frame cost of
// `Line.tsx`'s `unDimRaw` \x1b[2m strip across a tall hovered block. H1's ownerKey grouping widened hover from
// one row to a whole message, so a hovered multi-row tool block now runs `DIM_SGR.replace` once per body row
// PER RE-RENDER while the pointer sits over it (research r2 §5's exact concern). This file is an INSTRUMENT,
// not a regression test — `describe.skipIf` keeps it out of the normal suite (a timing assertion in CI is a
// flake generator, not a signal) and it asserts nothing; the console.log lines it prints ARE the deliverable,
// recorded verbatim in `.doperpowers/sdd/2026-08-23-f10-wave/t-hover-task-3-report.md`.
//
// `HOVER_COST_BENCH=1 npm run test:tui -- hover-cost` to run it.
import React from "react";
import { describe, it } from "vitest";
import { render } from "ink-testing-library";
import { RenderItemView, TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import { HoverContext } from "../../src/tui/mouse/hoverContext.js";
import { composeFoldRun, stripSgr } from "../../src/tui/sgrFoldRow.js";
import type { FoldClause } from "../../src/tui/toolFold.js";
import type { RenderLine } from "../../src/tui/render.js";

/** `Line.tsx:28`'s own regex, duplicated here (not imported — the file exports no test seam for it) purely to
 *  measure the ISOLATED cost of the strip in Step 1's second cell. */
const DIM_SGR = /\x1b\[2m/g;

/** One row's raw dim bytes, built through the REAL producer (`composeFoldRun`, `sgrFoldRow.ts` — the only
 *  writer of a `preStyled` dim run this codebase currently has) rather than a hand-typed `\x1b[2m…` literal,
 *  matching `hover.test.tsx`'s own "real producer path, not invented bytes" discipline. Each row's clause
 *  TEXT differs by index so the 40 rows are not byte-identical — a real tool result's lines never are, and a
 *  per-input memo has to earn its keep against genuinely distinct inputs, not one string repeated 40 times. */
function rawDimRow(i: number): string {
  const label = String(i).padStart(2, "0");
  const clause: FoldClause = {
    text: `reading source line ${label} of a moderately long file path segment for row ${label}`,
    boldRanges: [[21, 21 + label.length]],
  };
  return composeFoldRun([clause], "settled");
}

/** A 40-row gutter-block whose every body row carries a `preStyled` segment with real `\x1b[2m` runs — the
 *  exact shape research r2 §5 names: "a hovered 40-row tool block would do it 40× per frame while hovered". */
function tallDimGutterBlock(n: number): RenderItem {
  const body: RenderLine[] = Array.from({ length: n }, (_, i) => {
    const raw = rawDimRow(i);
    return { text: stripSgr(raw), segments: [{ text: raw, preStyled: true as const }] };
  });
  return { kind: "gutter-block", id: "bench:tall", ownerKey: "bench:tall", gutter: TOOL_RESULT_GUTTER, body };
}

describe.skipIf(!process.env.HOVER_COST_BENCH)("hover-cost bench (HOVER_COST_BENCH=1) — instrument, not a regression test", () => {
  const TALL = tallDimGutterBlock(40);

  /** Mounts once, then re-renders `n` times at a FIXED `hovered` value and returns ms/frame — a plain
   *  `rerender()` is exactly what Ink does on every repaint (these are ordinary function components, no
   *  `React.memo` bailout anywhere in this path), so this is the real per-frame cost, not a remount cost. */
  const timeFrames = (hovered: boolean, n = 200): number => {
    const view = <HoverContext.Provider value={hovered}><RenderItemView item={TALL} start={0} end={40} /></HoverContext.Provider>;
    const r = render(view);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) r.rerender(view);
    const perFrame = (performance.now() - t0) / n;
    r.unmount();
    return perFrame;
  };

  it("records the per-frame cost of the hovered un-dim across a 40-row block", () => {
    const cold = timeFrames(false), hot = timeFrames(true);
    // eslint-disable-next-line no-console
    console.log(`[hover-cost] 40 rows: not-hovered ${cold.toFixed(3)} ms/frame, hovered ${hot.toFixed(3)} ms/frame, delta ${(hot - cold).toFixed(3)} ms`);
  });

  it("records the isolated regex-strip cost alone (no React) — the fraction of the delta above that is the strip itself, vs. React rebuilding 40 <Text> trees it rebuilds regardless of hover", () => {
    const rows = TALL.kind === "gutter-block" ? TALL.body : [];
    const raws = rows.map((l) => l.segments![0]!.text);
    const REPS = 2000;
    const t0 = performance.now();
    for (let i = 0; i < REPS; i++) for (const raw of raws) raw.replace(DIM_SGR, "");
    const perFrameEquivalent = (performance.now() - t0) / REPS;
    // eslint-disable-next-line no-console
    console.log(`[hover-cost] isolated regex strip over 40 rows: ${perFrameEquivalent.toFixed(4)} ms/frame-equivalent (${REPS} reps, no React)`);
  });
});
