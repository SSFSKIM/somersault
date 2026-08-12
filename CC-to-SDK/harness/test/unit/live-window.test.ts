// test/unit/live-window.test.ts — fullscreen-live-window task 1. The selector is the substrate's ONE pure
// decision: which finalized items stay in the live (re-rendered) subtree and which are committed to Static
// forever. Everything downstream — the alternate-screen renderer, the commit ratchet — is bookkeeping on top
// of this answer, so it is pinned here as a pure function with no Ink, no React and no terminal in the graph.
//
// The two invariants the whole wave rests on, and why each is a hard failure rather than a preference:
//  · WHOLE ITEMS. A gutter block split across the commit boundary would print its `⎿` connector in Static and
//    its continuation rows in the live subtree, and the two halves reflow independently on resize. So the cut
//    is always between items: `concat(commit, window) === items`, in input order, no item in both, none lost.
//  · THE CAP IS HARD. Ink 5.2.1 `build/ink.js:121` — when the rendered live subtree reaches `stdout.rows` it
//    writes `clearTerminal + fullStaticOutput + output` straight to stdout and returns, i.e. it reprints the
//    ENTIRE session on every frame. `capRows` exists to keep the frame away from that cliff, so a window that
//    merely "usually" fits is worthless: no input may produce a window summing past the cap.
import { describe, expect, it } from "vitest";
import { mainWindowCap, selectLiveWindow, WINDOW_SLACK } from "../../src/tui/liveWindow.js";
import { renderItemHeight } from "../../src/tui/pager.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
// From `species.ts`, NOT `toolRenderer.tsx` (which merely re-exports it at :38): toolRenderer is a `.tsx`
// module and importing it would pull React + Ink into this file's graph, contradicting the header above.
import { TOOL_RESULT_GUTTER } from "../../src/tui/species.js";

/** Height 1 — `renderItemHeight` gives every `line` item exactly one row. */
const line = (id: string): RenderItem => ({ kind: "line", id, line: { text: id } });
/** Height `n` — a gutter block is `body.length` rows tall (pager.ts:43), so `n` is the height, exactly. */
const block = (id: string, n: number): RenderItem =>
  ({ kind: "gutter-block", id, gutter: TOOL_RESULT_GUTTER, body: Array.from({ length: n }, (_, i) => ({ text: `${id}:${i}` })) });
const rows = (items: readonly RenderItem[]): number => items.reduce((sum, item) => sum + renderItemHeight(item), 0);
const ids = (items: readonly RenderItem[]): string[] => items.map((item) => item.id);

/** The partition law, asserted on EVERY result in this file: the two halves are a suffix split of the input,
 *  order preserved on both sides, nothing duplicated and nothing dropped. Identity comparison, not structural
 *  — an item that came back re-created rather than passed through would be a silent reflow bug. */
function expectSuffixSplit(items: readonly RenderItem[], result: { window: readonly RenderItem[]; commit: readonly RenderItem[] }): void {
  expect([...result.commit, ...result.window]).toEqual(items);
  for (let i = 0; i < items.length; i++) expect([...result.commit, ...result.window][i]).toBe(items[i]);
}

describe("selectLiveWindow", () => {
  it("cuts only at item edges and takes the SMALLEST suffix that reaches targetRows", () => {
    const items = [line("a"), line("b"), block("c", 3), line("d"), line("e")];
    const r = selectLiveWindow(items, 4, 100);
    expectSuffixSplit(items, r);
    // `d`+`e` is 2 rows (short); `c`+`d`+`e` is 5 ≥ 4 and is the smallest suffix that gets there. Taking `b`
    // too would be 6 rows of live subtree for no reason — the point of the window is that it is minimal.
    expect(ids(r.window)).toEqual(["c", "d", "e"]);
    expect(ids(r.commit)).toEqual(["a", "b"]);
    expect(rows(r.window)).toBe(5);
  });

  it("stops exactly at target when a suffix lands on it", () => {
    const items = [line("a"), block("b", 2), line("c"), line("d")];
    const r = selectLiveWindow(items, 2, 100);
    expectSuffixSplit(items, r);
    expect(ids(r.window)).toEqual(["c", "d"]);
  });

  it("never exceeds capRows and is never short without a reason, over 400 random height profiles", () => {
    // Property-style: the cap is the invariant that keeps Ink off its whole-session-reprint branch, so it is
    // checked against arbitrary shapes rather than the handful of profiles a human would think to write.
    //
    // The cap bound alone is one-sided — it is an UPPER bound, and a selector that returned an empty window
    // for every input would satisfy it forever. So each profile also carries the complementary LOWER bound:
    // a window that stops short of the target must have been stopped by the cap, never by choice. Exactly one
    // of three things must be true of every result — the walk consumed the whole input, or the window reached
    // the target, or the one item just above the cut would have pushed the window past the cap.
    let seed = 0x5eed;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let trial = 0; trial < 400; trial++) {
      const items: RenderItem[] = Array.from({ length: rand(14) }, (_, i) => (rand(2) === 0 ? line(`i${i}`) : block(`i${i}`, rand(12))));
      const cap = rand(20), target = rand(30);
      const r = selectLiveWindow(items, target, cap);
      expectSuffixSplit(items, r);
      expect(rows(r.window)).toBeLessThanOrEqual(cap);
      const cut = items.length - r.window.length;
      const wholeInput = cut === 0;
      const reachedTarget = rows(r.window) >= target;
      const nextWouldOverflow = cut > 0 && rows(r.window) + renderItemHeight(items[cut - 1]!) > cap;
      expect({ trial, cap, target, cut, windowRows: rows(r.window), stoppedForAReason: wholeInput || reachedTarget || nextWouldOverflow })
        .toMatchObject({ stoppedForAReason: true });
    }
  });

  it("commits an over-cap item WHOLE and keeps the window below it", () => {
    const items = [line("a"), block("tall", 50), line("c"), line("d")];
    const r = selectLiveWindow(items, 30, 10);
    expectSuffixSplit(items, r);
    // The tall block can never fit under the cap, so it is a floor: it and everything above it commit, and the
    // window is whatever sits BELOW it — still live, still reflowing. The recorded divergence is that the tall
    // item itself is excluded from reflow, not that the window collapses.
    expect(ids(r.commit)).toEqual(["a", "tall"]);
    expect(ids(r.window)).toEqual(["c", "d"]);
  });

  it("yields an empty window when the over-cap item is last", () => {
    const items = [line("a"), block("tall", 50)];
    const r = selectLiveWindow(items, 30, 10);
    expectSuffixSplit(items, r);
    expect(r.window).toEqual([]);
    expect(ids(r.commit)).toEqual(["a", "tall"]);
  });

  it("returns two empty halves for empty input", () => {
    const r = selectLiveWindow([], 20, 40);
    expect(r.window).toEqual([]);
    expect(r.commit).toEqual([]);
  });

  it("degenerates to cap-bounded when targetRows ≥ capRows", () => {
    const items = [line("a"), line("b"), line("c"), line("d"), line("e")];
    const wanted = selectLiveWindow(items, 4, 4), unreachable = selectLiveWindow(items, 999, 4);
    // An unreachable target must not push the window past the cap, and must not behave differently from a
    // target that merely equals it: past the cap, target has no say at all.
    expect(ids(unreachable.window)).toEqual(ids(wanted.window));
    expect(rows(unreachable.window)).toBe(4);
    expect(ids(unreachable.commit)).toEqual(["a"]);
  });

  it("keeps a zero cap's window empty", () => {
    const items = [line("a"), line("b")];
    const r = selectLiveWindow(items, 10, 0);
    expectSuffixSplit(items, r);
    expect(r.window).toEqual([]);
  });

  it("is total over its input: published-ness is the CALLER's filter, not a validation here", () => {
    // INPUT CONTRACT (plan review C1): task 3 filters by `publishedIds` before calling, which is what makes
    // the spec's one-way commit ratchet automatic. The selector therefore has no notion of published items
    // and no rejection path — feed it items already committed in an earlier pass and it partitions them like
    // any others rather than throwing. This test exists so nobody "hardens" the selector into a validator and
    // silently moves the ratchet's home.
    const already = [line("published-1"), line("published-2"), line("fresh")];
    const r = selectLiveWindow(already, 1, 10);
    expectSuffixSplit(already, r);
    expect(ids(r.window)).toEqual(["fresh"]);
  });
});

describe("mainWindowCap", () => {
  it("is rows minus the measured 14-row dock, floored at zero", () => {
    expect(mainWindowCap(40)).toBe(26);
    expect(mainWindowCap(24)).toBe(10);
    expect(mainWindowCap(15)).toBe(1);
    expect(mainWindowCap(14)).toBe(0);
    expect(mainWindowCap(8)).toBe(0);
    expect(mainWindowCap(0)).toBe(0);
  });
});

describe("WINDOW_SLACK", () => {
  it("is two rows", () => { expect(WINDOW_SLACK).toBe(2); });
});
