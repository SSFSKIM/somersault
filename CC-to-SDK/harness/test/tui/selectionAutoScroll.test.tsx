// test/tui/selectionAutoScroll.test.tsx — F10 T-SELECT S6: the auto-scroll-on-drag timer (canon's
// `Epo`/`sNw`, L551475-551561), driven with `vi.useFakeTimers()` against the REAL `FullscreenFrame` +
// `FullscreenViewport` pair and the REAL `ViewportHitmap` gesture methods — `selectionStaleness.test.tsx`'s
// own harness, reused rather than reinvented. Mount and settle with REAL timers first (`animationClock.
// test.tsx`'s own precedent: Ink's reconciler schedules its passive-effect flush through `setImmediate`,
// which switching to fake timers before the first paint would strand), THEN switch to fake timers scoped to
// exactly `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval` for the gesture itself.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import {
  FullscreenViewport, hitRowsOf, AUTOSCROLL_ROWS, AUTOSCROLL_MS, AUTOSCROLL_MAX_TICKS,
  type ViewportHitmap, type ViewportScroll,
} from "../../src/tui/FullscreenViewport.js";
import { Transcript } from "../../src/tui/Transcript.js";
import { renderItemHeight, pageItemSlices } from "../../src/tui/pager.js";
import { wrapItemsToWidth } from "../../src/tui/wrapItems.js";
import { sourceEndpointAt } from "../../src/tui/mouse/hitmap.js";
import { documentSelectionText } from "../../src/tui/mouse/documentText.js";
import type { SelectionAddresses } from "../../src/tui/mouse/address.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";
import { tick } from "./keysTestUtil.js";

const FRAME_ROWS = 12, COLS = 40; // dock(3) rows -> an 8-row region, `selectionStaleness.test.tsx`'s own geometry
const NO_ITEMS: readonly RenderItem[] = [];
const NO_LINES: readonly RenderLine[] = [];
const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
const strip = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();
const rowOf = (frame: string | undefined, text: string): number => {
  const at = rowsOf(frame).findIndex((line) => strip(line) === text);
  expect(at, `"${text}" is not painted in:\n${(frame ?? "")}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
/** The window's own last painted row, found dynamically rather than assumed: whenever the viewport is
 *  scrolled but neither sticky nor at the document's end, the jump pill takes the region's OWN last row
 *  (`FullscreenViewport.tsx`'s own header — "the pill instead COVERS the window's last row"), so a
 *  scrolled-to-top window here paints 7 `L*` rows, not 8. Counting the actual run of `L\d+` lines starting
 *  at `rowFirst` is what stays correct across that flip (and across the moment auto-scroll reaches the
 *  document's own tail, where the pill disappears and the window widens back to 8). */
const windowBottomRow = (frame: string | undefined, rowFirst: number): number => {
  const rows = rowsOf(frame);
  let last = rowFirst;
  for (let i = rowFirst; i < rows.length; i++) {
    if (/^L\d+$/.test(strip(rows[i]))) last = i + 1; else break;
  }
  return last;
};
const plain = (tag: string): RenderItem => ({ kind: "line", id: tag, line: { text: tag } });
const docOf = (n: number): readonly RenderItem[] => Array.from({ length: n }, (_, i) => plain(`L${i}`));

const dock = (n: number) => <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}</Box>;
const scene = (items: readonly RenderItem[], hitmap: React.Ref<ViewportHitmap>, scroll: React.Ref<ViewportScroll>) => (
  <FullscreenFrame rows={FRAME_ROWS} dock={dock(3)} regionChildren={<>
    <Transcript staticItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} />
    <FullscreenViewport finalizedItems={items} pendingItems={NO_ITEMS} streaming={NO_LINES} columns={COLS}
      hitmapRef={hitmap} scrollRef={scroll} />
  </>} />
);
/** Real-timer settle, for the initial mount/scroll only — `animationClock.test.tsx`'s own `flushEffects`:
 *  Ink's reconciler schedules its passive-effect flush through `setImmediate`, which the fake-timer window
 *  below never fakes, so this keeps working even after `vi.useFakeTimers()` is armed. */
const flushEffects = () => new Promise<void>((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 4; i++) await flushEffects(); };
/** Fallback for the one pre-fake-timer settle each test does with `ink-testing-library`'s own real
 *  `setTimeout(0)` scheduling (`keysTestUtil.tick`), kept alongside `flushEffects` rather than replacing it
 *  — the existing harnesses in this track (`selectionStaleness`/`selectionRemap`) both lean on it. */
const realSettle = async () => { for (let i = 0; i < 4; i++) await tick(); };

afterEach(() => vi.useRealTimers());

/** Arm fake timers scoped to exactly the four the auto-scroll interval uses — `animationClock.test.tsx`'s
 *  own narrower set, not vitest's default (which also fakes `setImmediate` and would strand Ink's own
 *  effect-flush scheduling). Returns the timer count immediately after arming, since a mounted tree can
 *  already hold timers of its own (none currently, but asserting against a captured baseline rather than a
 *  bare `0` is what the brief's own bounds cells ask for). */
function armFakeTimers(): number {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  return vi.getTimerCount();
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("F10 S6 — auto-scroll on drag: the timer's own lifecycle", () => {
  it("drag past the bottom edge: 2 rows/tick, and the copied text keeps pace with the sweep", async () => {
    const DOC = docOf(30);
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene(DOC, hitmap, scroll));
    await realSettle();
    scroll.current!.scroll({ kind: "top" });
    await realSettle();
    const rowFirst = rowOf(lastFrame(), "L0");
    const rowLast = windowBottomRow(lastFrame(), rowFirst); // the window may show 7 or 8 rows (pill)

    const pre = armFakeTimers();
    hitmap.current!.startSelectionAt(1, rowFirst);
    hitmap.current!.dragSelectionTo(50, rowLast + 1); // one row below the region's own last painted row
    expect(vi.getTimerCount()).toBe(pre + 1); // anchor (L0) is inside the window, focus is past its edge

    // A LITERAL 200ms (4 ticks at the documented 50ms/tick), not `AUTOSCROLL_MS * 4`: self-scaling the
    // advance by the constant under test would make an `AUTOSCROLL_MS` sabotage invisible here (a wrong
    // interval still fires exactly 4 ticks if the wait is defined as "4 of whatever the constant says"),
    // which is exactly the step 8.9 sabotage this cell exists to catch. `L8` is likewise a literal (2
    // rows/tick × 4 ticks), not `AUTOSCROLL_ROWS`-derived, for the identical reason on the other constant.
    await advance(200);
    expect(rowOf(lastFrame(), "L8")).toBe(rowFirst);
    const text = hitmap.current!.selectedText();
    // The anchor (L0) is still the sweep's own start, and the sweep has kept pace with the auto-scroll: the
    // copy reaches well past the row that was the window's own bottom edge at press time (L7).
    expect(text.startsWith("L0")).toBe(true);
    expect(text).toMatch(/\bL1[0-4]\b/); // some row in the 10-14 range — scrolled PAST at press time — is in it
  });

  it("bounds: at the document's top, dragging above the first row moves nothing and self-clears", async () => {
    const DOC = docOf(30);
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene(DOC, hitmap, scroll));
    await realSettle();
    scroll.current!.scroll({ kind: "top" }); // offset already 0 — nowhere further up to go
    await realSettle();
    const rowFirst = rowOf(lastFrame(), "L0");

    const pre = armFakeTimers();
    hitmap.current!.startSelectionAt(1, rowFirst + 3); // anchor mid-window (inside [1,8])
    hitmap.current!.dragSelectionTo(1, rowFirst - 1);   // one row ABOVE the region's own first row
    expect(vi.getTimerCount()).toBe(pre + 1);

    await advance(AUTOSCROLL_MS); // one tick: `scroll:lineUp` is a no-op at offset 0
    expect(vi.getTimerCount()).toBe(pre); // self-cleared — the "no movement" branch fired
    expect(rowOf(lastFrame(), "L0")).toBe(rowFirst); // and nothing scrolled
  });

  it("release mid-scroll: endSelectionDrag() stops the timer, and a further 500ms changes nothing", async () => {
    const DOC = docOf(30);
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene(DOC, hitmap, scroll));
    await realSettle();
    scroll.current!.scroll({ kind: "top" });
    await realSettle();
    const rowFirst = rowOf(lastFrame(), "L0");
    const rowLast = windowBottomRow(lastFrame(), rowFirst);

    const pre = armFakeTimers();
    hitmap.current!.startSelectionAt(1, rowFirst);
    hitmap.current!.dragSelectionTo(50, rowLast + 1);
    expect(vi.getTimerCount()).toBe(pre + 1);
    await advance(AUTOSCROLL_MS * 2); // 4 rows in
    expect(rowOf(lastFrame(), "L4")).toBe(rowFirst);

    hitmap.current!.endSelectionDrag();
    expect(vi.getTimerCount()).toBe(pre); // release stopped it

    await advance(500);
    expect(rowOf(lastFrame(), "L4")).toBe(rowFirst); // no further movement past the release
  });

  it("discardSelection() and unmount both clear a live timer", async () => {
    const DOC = docOf(30);
    // discardSelection
    {
      const hitmap = React.createRef<ViewportHitmap>();
      const scroll = React.createRef<ViewportScroll>();
      const { lastFrame } = render(scene(DOC, hitmap, scroll));
      await realSettle();
      scroll.current!.scroll({ kind: "top" });
      await realSettle();
      const rowFirst = rowOf(lastFrame(), "L0");
      const rowLast = windowBottomRow(lastFrame(), rowFirst);
      const pre = armFakeTimers();
      hitmap.current!.startSelectionAt(1, rowFirst);
      hitmap.current!.dragSelectionTo(50, rowLast + 1);
      expect(vi.getTimerCount()).toBe(pre + 1);
      hitmap.current!.discardSelection();
      expect(vi.getTimerCount()).toBe(pre);
      vi.useRealTimers();
    }
    // unmount
    {
      const hitmap = React.createRef<ViewportHitmap>();
      const scroll = React.createRef<ViewportScroll>();
      const { lastFrame, unmount } = render(scene(DOC, hitmap, scroll));
      await realSettle();
      scroll.current!.scroll({ kind: "top" });
      await realSettle();
      const rowFirst = rowOf(lastFrame(), "L0");
      const rowLast = windowBottomRow(lastFrame(), rowFirst);
      const pre = armFakeTimers();
      hitmap.current!.startSelectionAt(1, rowFirst);
      hitmap.current!.dragSelectionTo(50, rowLast + 1);
      expect(vi.getTimerCount()).toBe(pre + 1);
      unmount();
      await flushEffects();
      expect(vi.getTimerCount()).toBe(pre);
    }
  });

  it("direction latch: a drag back inside the window stops the timer; a drag past the OTHER edge starts a fresh one", async () => {
    const DOC = docOf(30);
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene(DOC, hitmap, scroll));
    await realSettle();
    scroll.current!.scroll({ kind: "top" });
    await realSettle();
    const rowFirst = rowOf(lastFrame(), "L0");
    const rowLast = windowBottomRow(lastFrame(), rowFirst);
    const midRow = rowFirst + 3;

    const pre = armFakeTimers();
    hitmap.current!.startSelectionAt(1, midRow);
    hitmap.current!.dragSelectionTo(50, rowLast + 1); // below the window: dir +1
    expect(vi.getTimerCount()).toBe(pre + 1);

    hitmap.current!.dragSelectionTo(1, midRow); // back inside the window: dir 0
    expect(vi.getTimerCount()).toBe(pre);

    hitmap.current!.dragSelectionTo(1, rowFirst - 1); // past the OTHER edge: dir -1
    expect(vi.getTimerCount()).toBe(pre + 1); // a fresh timer, in the new direction
  });

  it("anchor outside the window (canon's sNw precondition): no timer starts at all", async () => {
    const DOC = docOf(30);
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene(DOC, hitmap, scroll));
    await realSettle();
    scroll.current!.scroll({ kind: "top" });
    await realSettle();
    const rowFirst = rowOf(lastFrame(), "L0");
    const rowLast = windowBottomRow(lastFrame(), rowFirst);

    const pre = armFakeTimers();
    // The anchor lands ABOVE the window's own first row (`cellAt` happily answers a row past either
    // bound) — the precondition's own failure case, even though the focus below is also out of bounds.
    hitmap.current!.startSelectionAt(1, rowFirst - 1);
    hitmap.current!.dragSelectionTo(50, rowLast + 1);
    expect(vi.getTimerCount()).toBe(pre);
  });

  it("the 200-tick cap, at its own boundary — 199 / 200 / 201", async () => {
    const DOC = docOf(1000); // far deeper than 2*(AUTOSCROLL_MAX_TICKS+1) rows past the window
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene(DOC, hitmap, scroll));
    await realSettle();
    scroll.current!.scroll({ kind: "top" });
    await realSettle();
    const rowFirst = rowOf(lastFrame(), "L0");
    const rowLast = windowBottomRow(lastFrame(), rowFirst);

    const pre = armFakeTimers();
    hitmap.current!.startSelectionAt(1, rowFirst);
    hitmap.current!.dragSelectionTo(50, rowLast + 1);
    expect(vi.getTimerCount()).toBe(pre + 1);

    // LITERAL 50ms/tick and 2 rows/tick throughout this cell (not `AUTOSCROLL_MS`/`AUTOSCROLL_ROWS`), and a
    // literal 199/200/201 tick count — the whole point of this cell is to pin canon's own numbers against a
    // regression in EITHER constant, which self-scaling the advance/expectation off the constant under test
    // would defeat (a wrong interval or a wrong per-tick row count would still agree with itself). The
    // dedicated constants cell below pins the exported names to these same literals for anyone refactoring.
    await advance(50 * 199);
    expect(vi.getTimerCount()).toBe(pre + 1); // still live
    expect(rowOf(lastFrame(), `L${2 * 199}`)).toBe(rowFirst);

    await advance(50); // the 200th tick
    expect(vi.getTimerCount()).toBe(pre); // self-cleared at the cap
    expect(rowOf(lastFrame(), `L${2 * 200}`)).toBe(rowFirst);

    await advance(50); // a would-be 201st — nothing left running to fire it
    expect(rowOf(lastFrame(), `L${2 * 200}`)).toBe(rowFirst); // unchanged
  });
});

describe("F10 S6 — sabotage: the tick constants are load-bearing, not decorative", () => {
  it("the cell above genuinely depends on AUTOSCROLL_ROWS/MS/MAX_TICKS (documented, not re-run against a mutated build)", () => {
    // This track's module constants are `export const`s consumed directly by the tests above (never a
    // hand-typed 2/50/200) — step 8.9 of the task brief sabotages each in turn (1 row/tick, 100ms/tick, a
    // 201-tick cap) against a mutated build and confirms the affected cells fail, then reverts. Recorded
    // here as a plain assertion on the constants' own values, which is what every cell above is actually
    // indexed against.
    expect(AUTOSCROLL_ROWS).toBe(2);
    expect(AUTOSCROLL_MS).toBe(50);
    expect(AUTOSCROLL_MAX_TICKS).toBe(200);
  });
});

describe("F10 S6 — the mounted ref and the standalone module agree, byte for byte", () => {
  it("hitmapRef.current.selectedText() equals documentSelectionText() computed independently over the same document", async () => {
    // Sized so the auto-scroll SELF-TERMINATES exactly at the document's own tail (16 rows, an 8-row
    // region, 2 rows/tick: the 4th tick reaches offset 8 — the bound — and the 5th tick's "no movement"
    // check clears it), leaving a fully-settled window to compute the independent expectation against —
    // no ambiguity from a timer still mid-flight when the assertion runs.
    const DOC = docOf(16);
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene(DOC, hitmap, scroll));
    await realSettle();
    scroll.current!.scroll({ kind: "top" });
    await realSettle();
    const rowFirst = rowOf(lastFrame(), "L0");

    armFakeTimers();
    hitmap.current!.startSelectionAt(1, rowFirst);
    hitmap.current!.dragSelectionTo(50, rowFirst + 8); // one row below the 8-row region
    await advance(AUTOSCROLL_MS * 5); // 4 ticks to the bound, a 5th to observe "no movement" and clear
    expect(vi.getTimerCount()).toBe(0);
    expect(rowOf(lastFrame(), "L15")).toBe(rowFirst + 7); // settled at the very bottom: L8..L15 painted

    // Independent reconstruction: the SAME primitives the component's own recording uses
    // (`wrapItemsToWidth` -> `hitRowsOf` -> `sourceEndpointAt`), applied by THIS test to the SAME two
    // gesture points (L0 at column 1, L15 at column 50 — past its own width, an end-of-line click), never
    // reading any private ref the component holds.
    const wrapped = wrapItemsToWidth(DOC, COLS);
    const total = wrapped.reduce((sum, item) => sum + renderItemHeight(item), 0);
    const { slices } = pageItemSlices(wrapped, 0, total);
    const fullRows = hitRowsOf(slices, COLS);
    const rowL0 = fullRows.find((r) => r.itemKey === "L0")!;
    const rowL15 = fullRows.find((r) => r.itemKey === "L15")!;
    const a = sourceEndpointAt(rowL0, 1);
    const f = sourceEndpointAt(rowL15, 50);
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "L0", charOffset: a.charOffset, charEnd: a.charEnd },
      focus: { itemKey: "L15", charOffset: f.charOffset, charEnd: f.charEnd },
      span: null,
    };
    const ord = (k: string): number | undefined => {
      const m = /^L(\d+)$/.exec(k);
      return m ? Number(m[1]) : undefined;
    };
    const expected = documentSelectionText(fullRows, addrs, ord);

    // Sanity: the full document, one item per row, hard-joined — pins the reconstruction itself, not just
    // the equality below.
    expect(expected).toBe(Array.from({ length: 16 }, (_, i) => `L${i}`).join("\n"));
    expect(hitmap.current!.selectedText()).toBe(expected);
  });
});
