// tui/test/fold-hitmap.test.tsx — tool-stream Task 9: which fold anchor, if any, is painted at a terminal cell.
//
// THE QUESTION THIS FILE PINS is the one translation nothing else in the wave owns. Task 6 decodes an SGR
// report into a 1-based `(col, row)`; Task 7 routes it to a sink; Task 8 tags every row a cluster projects to
// with its anchor id. Between the cell and the anchor sits arithmetic that spans two components — the frame
// knows where the region starts on the terminal, the viewport knows which document rows it just painted into
// it — and it is arithmetic no single unit test of either half can catch being wrong. So every case here
// renders the REAL pair through `ink-testing-library` and asserts the map against the FRAME IT PAINTED: the
// row a case hit-tests is located in `lastFrame()` first, so a map that drifts from the paint fails even when
// its own arithmetic is self-consistent.
//
// THE SIBLING IS PART OF THE FIXTURE, NOT SCENERY. `ChatApp` renders an empty `<Transcript>` above the
// viewport inside the region (`ChatApp.tsx:1179-1189`, a crash fix — the `<Static>` may never unmount), and
// the viewport's whole origin story is "my first painted row IS the region's first painted row". That is true
// today only because the empty Transcript contributes no rows, which is a fact about ANOTHER component. It is
// mounted here so the day it stops being true, these cases go red instead of the hitmap going quietly
// off-by-one.
//
// GEOMETRY, once, so every case below can name a terminal row rather than derive one:
//   frame `rows: 12` → `frameHeight` 11, park row 12. Dock is 3 rows (`floor(12/2) = 6` cap, not binding), so
//   the region's measured grant is 8: terminal rows 1-8 are the viewport, 9-11 the dock, 12 the park.
//   The document is 14 painted rows at `columns: 40`, so the sticky window shows its last 8.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { FullscreenViewport, type ViewportHitmap, type ViewportScroll } from "../../src/tui/FullscreenViewport.js";
import { Transcript } from "../../src/tui/Transcript.js";
import { GROUP_HINT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";
import { tick } from "./keysTestUtil.js";

const FRAME_ROWS = 12, COLS = 40;
const NO_ITEMS: readonly RenderItem[] = [];
const NO_LINES: readonly RenderLine[] = [];
const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
const strip = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();
/** The 1-based terminal row the given text is painted on — the fixture's own answer to "where did it land",
 *  so a case never has to hard-code a window offset it would then be testing against itself. */
const rowOf = (frame: string | undefined, text: string): number => {
  const at = rowsOf(frame).findIndex((line) => strip(line) === text);
  expect(at, `"${text}" is not painted`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const plain = (tag: string): RenderItem => ({ kind: "line", id: tag, line: { text: tag } });

const FOLD_TEXT = "FOLD-ROW";                    // 8 columns — the column bound's subject
const HINT_TEXT = "hint";                        // painted at `GROUP_HINT_GUTTER.length` + 4 = 9 columns
const WRAP_TEXT = "WRAPPED-CLUSTER-ROW " + "x".repeat(30);   // 50 columns at `columns: 40` → exactly two rows
/** Eight plain rows, then a collapsed cluster (its fold row + the active hint block it wears, both tagged
 *  `read-1`), a plain row, an over-wide cluster row that WRAPS (tagged `read-2`), and a plain tail. */
const DOC: readonly RenderItem[] = [
  ...Array.from({ length: 8 }, (_, i) => plain(`P${i}`)),
  { kind: "line", id: "g:read-1:row", line: { text: FOLD_TEXT }, foldAnchor: "read-1" },
  { kind: "gutter-block", id: "g:read-1:pending-hint", gutter: GROUP_HINT_GUTTER, body: [{ text: HINT_TEXT }], foldAnchor: "read-1" },
  plain("P8"),
  { kind: "line", id: "g:read-2:row", line: { text: WRAP_TEXT }, foldAnchor: "read-2" },
  plain("P9"),
];
const dock = (n: number) => <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}</Box>;

/** The production tree, minus everything that is not this question: a real frame, the empty `<Transcript>`
 *  that really sits above the viewport in the region, and the viewport. `rows` is the viewport's own budget
 *  override — omitted everywhere except the classic case, which has no grant to be given. */
const scene = (opts: { hitmap: React.Ref<ViewportHitmap>; scroll?: React.Ref<ViewportScroll>; classic?: boolean; rows?: number }) => (
  <FullscreenFrame mode={opts.classic ? "classic" : "fullscreen"} rows={FRAME_ROWS} dock={dock(3)} regionChildren={<>
    <Transcript staticItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} />
    <FullscreenViewport finalizedItems={DOC} pendingItems={NO_ITEMS} streaming={NO_LINES} columns={COLS}
      rows={opts.rows} hitmapRef={opts.hitmap} scrollRef={opts.scroll} />
  </>} />
);
/** The frame measures its region in an effect and publishes the grant as state, so a mount converges over two
 *  passive passes — the same `settle` every other fullscreen suite uses, and for the same reason. */
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

describe("T9: the viewport hitmap resolves a terminal cell to its fold anchor", () => {
  it("maps the painted rows of a collapsed cluster, and nothing else", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame } = render(scene({ hitmap }));
    await settle();
    const frame = lastFrame();
    // The origin, asserted rather than assumed: the region's first terminal row is the VIEWPORT's first row,
    // which is only true while the `<Transcript>` above it paints nothing (see the header).
    expect(strip(rowsOf(frame)[0])).toBe("P6");
    expect(rowsOf(frame)).toHaveLength(11);                          // 8 region + 3 dock — the frame's budget

    const foldRow = rowOf(frame, FOLD_TEXT);
    expect(hitmap.current!.anchorAt(1, foldRow)).toBe("read-1");     // first cell of the row
    expect(hitmap.current!.anchorAt(FOLD_TEXT.length, foldRow)).toBe("read-1");   // last cell that has text
    // THE COLUMN BOUND (spec §3.3): the blank cells right of the sentence are not the cluster. Canon drops a
    // blank-cell click (549361) and so does this — the row is clickable, the CELL is not.
    expect(hitmap.current!.anchorAt(FOLD_TEXT.length + 1, foldRow)).toBeUndefined();

    // The hint block is the same cluster's second painted row, and its width is the five-column connector
    // gutter PLUS its body — the gutter is a sibling Box in `RenderItemView`, so those cells are painted too.
    const hintRow = rowOf(frame, `⎿  ${HINT_TEXT}`);
    expect(hintRow).toBe(foldRow + 1);
    expect(hitmap.current!.anchorAt(3, hintRow)).toBe("read-1");     // on the `⎿` itself
    expect(hitmap.current!.anchorAt(GROUP_HINT_GUTTER.length + HINT_TEXT.length, hintRow)).toBe("read-1");
    expect(hitmap.current!.anchorAt(GROUP_HINT_GUTTER.length + HINT_TEXT.length + 1, hintRow)).toBeUndefined();

    // An untagged row is not a cluster — and the two either side of the fold row are the cases that catch a
    // map built by skipping untagged rows, which would resolve every row below the first cluster one short.
    expect(hitmap.current!.anchorAt(1, foldRow - 1)).toBeUndefined();
    expect(hitmap.current!.anchorAt(1, rowOf(frame, "P8"))).toBeUndefined();
  });

  it("resolves BOTH painted rows of a wrapped cluster row", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame } = render(scene({ hitmap }));
    await settle();
    // The item is one `RenderItem` in the document and two rows on the screen (`wrapItems` re-cuts it at
    // `columns`, carrying the tag onto both). A hit test reads PAINTED rows, so both must answer.
    const first = rowOf(lastFrame(), "WRAPPED-CLUSTER-ROW");
    expect(strip(rowsOf(lastFrame())[first])).toBe("x".repeat(30));
    expect(hitmap.current!.anchorAt(1, first)).toBe("read-2");
    expect(hitmap.current!.anchorAt(1, first + 1)).toBe("read-2");
    expect(hitmap.current!.anchorAt(31, first + 1)).toBeUndefined();  // past the continuation row's own text
  });

  it("returns nothing for a row below the region — the dock band is not the document", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame } = render(scene({ hitmap }));
    await settle();
    // The dock's three rows are terminal 9-11, and the document HAS a tagged row at those indices (the map is
    // the window's rows, not the document's — a map of the whole document would answer `read-1` at row 9).
    expect(rowOf(lastFrame(), "D0")).toBe(9);
    for (const row of [9, 10, 11, 12]) expect(hitmap.current!.anchorAt(1, row)).toBeUndefined();
  });

  it("shifts with the scroll offset, and leaves the jump pill's row inert", async () => {
    const hitmap = React.createRef<ViewportHitmap>(), scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene({ hitmap, scroll }));
    await settle();
    const before = rowOf(lastFrame(), FOLD_TEXT);

    scroll.current!.scroll({ kind: "lines", n: -1 });
    await tick();
    // One line up: the window moved and so did the cluster. The row that answered before is now the plain row
    // that took its place — a map cached from the first paint would still answer `read-1` there.
    const after = rowOf(lastFrame(), FOLD_TEXT);
    expect(after).toBe(before + 1);
    expect(hitmap.current!.anchorAt(1, after)).toBe("read-1");
    expect(hitmap.current!.anchorAt(1, before)).toBeUndefined();

    // THE PILL'S ROW IS PAID FOR OUT OF THE WINDOW (`body = height - 1`), so it is not a document row at all.
    // A map built from a second slice at the FULL grant would have an eighth entry and make the pill clickable.
    const pill = 8;
    expect(strip(rowsOf(lastFrame())[pill - 1])).toContain("↓");
    expect(hitmap.current!.anchorAt(1, pill)).toBeUndefined();
  });

  it("resolves nothing under the classic renderer, tagged rows and all", async () => {
    // A SYNTHETIC MOUNT, deliberately: `ChatApp` renders this viewport only in fullscreen, so the budget it
    // would get from the frame's context (0 — there is no grant on the main screen) is handed to it directly
    // instead, and the same document paints. What is being pinned is that the map gates on the RENDERER and
    // not on tag presence: `groupItems` tags fold rows unconditionally, including here, where the field never
    // paints and no click path exists — so the rows are on screen and none of them is addressable.
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame } = render(scene({ hitmap, classic: true, rows: 8 }));
    await settle();
    const foldRow = rowOf(lastFrame(), FOLD_TEXT);
    expect(hitmap.current!.anchorAt(1, foldRow)).toBeUndefined();
    expect(hitmap.current!.anchorAt(1, foldRow + 1)).toBeUndefined();
  });
});
