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
import stringWidth from "string-width";
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

/** THE WIDTH DOCUMENT — the one thing `DOC` above cannot say, because every string in it is ASCII. The bound
 *  the viewport applies is a PAINTED extent (`stringWidth`, plus the row's gutter columns), and against pure
 *  ASCII that is character-for-character the same number as `text.length`: swap the measure and every case in
 *  this file stays green while the last cell of every active cluster row quietly stops answering. So these
 *  three rows are chosen for the property that they DISAGREE with their own character count, one per width
 *  expression the map contains.
 *    Five painted rows, all of them inside the eight-row window, so the geometry note at the top of this file
 *  is untouched and `rowOf` still locates each row in the frame that was painted. */
const ACTIVE_FOLD_TEXT = "⏺ Reading 1 file";   // 16 chars, 17 columns — `⏺` is ONE character, TWO cells
const CJK_HINT_TEXT = "読み込み中";              // 5 chars, 10 columns, at the gutter's 5-column offset
const BULLET_TEXT = "assistant";                 // behind a `RenderLine.gutter` of `"⏺ "` — 2 chars, 3 columns
const WIDE_DOC: readonly RenderItem[] = [
  plain("W0"),
  // The ACTIVE group row as `groupRowLine` really builds it: the leader is part of `line.text` (a segment,
  // joined into the plain text), not a gutter — so `text.length` is one short of the row's last painted cell.
  { kind: "line", id: "g:read-9:row", line: { text: ACTIVE_FOLD_TEXT }, foldAnchor: "read-9" },
  // The same cluster's hint block with a wide body. Two bounds in one row: the five gutter columns ahead of
  // the text, and the text's own doubled cells.
  { kind: "gutter-block", id: "g:read-9:pending-hint", gutter: GROUP_HINT_GUTTER, body: [{ text: CJK_HINT_TEXT }], foldAnchor: "read-9" },
  // The line arm's GUTTER term, which the two rows above do not reach. No projection tags a gutter-bearing
  // line today (a cluster row is never an assistant bullet), so this row is the `RenderItem` union's case
  // rather than a screenshot of production — deliberately, because it is the only cover that term has.
  { kind: "line", id: "g:read-9:bullet", line: { text: BULLET_TEXT, gutter: { text: "⏺ " } }, foldAnchor: "read-9" },
  plain("W1"),
];
const dock = (n: number) => <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}</Box>;

/** The production tree, minus everything that is not this question: a real frame, the empty `<Transcript>`
 *  that really sits above the viewport in the region, and the viewport. `rows` is the viewport's own budget
 *  override — omitted everywhere except the two cases that render a classic arm, which has no grant to give;
 *  `items` swaps the document for the width fixture below. */
const scene = (opts: { hitmap: React.Ref<ViewportHitmap>; scroll?: React.Ref<ViewportScroll>; classic?: boolean; rows?: number; items?: readonly RenderItem[] }) => (
  <FullscreenFrame mode={opts.classic ? "classic" : "fullscreen"} rows={FRAME_ROWS} dock={dock(3)} regionChildren={<>
    <Transcript staticItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} />
    <FullscreenViewport finalizedItems={opts.items ?? DOC} pendingItems={NO_ITEMS} streaming={NO_LINES} columns={COLS}
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
    // THE ORIGIN INVARIANT, and this one line is the whole of its defence: the frame's FIRST PAINTED ROW is
    // the viewport's FIRST DOCUMENT ROW. Both halves of the origin ride on it — the frame's published
    // `REGION_TOP_ROW` (nothing paints above the region) and the viewport's "my rows start where the region
    // does" (the `<Transcript>` sibling contributes none). Neither is measurable: Ink answers a size and
    // never a position, so an origin can be computed or asserted against a paint, and this is the assertion.
    // A banner, a padded region or a Transcript that starts emitting rows breaks it HERE rather than as a
    // silent off-by-N in the click path.
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

  it("bounds every row at its PAINTED width, never at its character count", async () => {
    // FIX-ROUND CELL (round 1). Reverting either `stringWidth` in `hitRowsOf` to `.length` left all five of
    // the cells above green, because `DOC` is ASCII throughout and `GROUP_HINT_GUTTER.length` happens to
    // equal its display width. Nothing in the file could tell the two rules apart, and the rule that would
    // survive the swap makes the last cell of every ACTIVE cluster row — the blinking-leader row, the one a
    // reader clicks mid-turn — inert. `WIDE_DOC` exists so that it cannot.
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame } = render(scene({ hitmap, items: WIDE_DOC }));
    await settle();
    const frame = lastFrame();
    // The fixture's own premise, asserted before anything is built on it: these three strings are WIDER than
    // they are long, or the cells below would prove nothing.
    expect(stringWidth(ACTIVE_FOLD_TEXT)).toBe(ACTIVE_FOLD_TEXT.length + 1);
    expect(stringWidth(CJK_HINT_TEXT)).toBe(CJK_HINT_TEXT.length * 2);
    expect(stringWidth("⏺ ")).toBe(3);

    // 1 — THE LEADER ROW. `⏺` is one character and two columns, so the last cell that has text is at
    // `stringWidth(text)`, one PAST `text.length`. A character-count bound answers `undefined` there.
    const lead = rowOf(frame, ACTIVE_FOLD_TEXT);
    expect(hitmap.current!.anchorAt(ACTIVE_FOLD_TEXT.length, lead)).toBe("read-9");
    expect(hitmap.current!.anchorAt(stringWidth(ACTIVE_FOLD_TEXT), lead)).toBe("read-9");
    expect(hitmap.current!.anchorAt(stringWidth(ACTIVE_FOLD_TEXT) + 1, lead)).toBeUndefined();

    // 2 — A GUTTER BLOCK'S BODY ROW, whose text starts at column 6 and whose cells are doubled. Both terms
    // of that arm are pinned at once: drop the gutter and the row ends at 10, count characters and it ends
    // at 10 as well — the same wrong answer from either mistake, five cells short of the text it paints.
    const hint = rowOf(frame, `⎿  ${CJK_HINT_TEXT}`);
    expect(hitmap.current!.anchorAt(GROUP_HINT_GUTTER.length + 1, hint)).toBe("read-9");   // first text cell
    expect(hitmap.current!.anchorAt(GROUP_HINT_GUTTER.length + stringWidth(CJK_HINT_TEXT), hint)).toBe("read-9");
    expect(hitmap.current!.anchorAt(GROUP_HINT_GUTTER.length + stringWidth(CJK_HINT_TEXT) + 1, hint)).toBeUndefined();

    // 3 — THE LINE ARM'S OWN GUTTER, the third width expression and the one no production row reaches yet
    // (see `WIDE_DOC`). `"⏺ "` paints three columns out of two characters.
    const bullet = rowOf(frame, `⏺ ${BULLET_TEXT}`);
    expect(hitmap.current!.anchorAt(stringWidth("⏺ ") + BULLET_TEXT.length, bullet)).toBe("read-9");
    expect(hitmap.current!.anchorAt(stringWidth("⏺ ") + BULLET_TEXT.length + 1, bullet)).toBeUndefined();
  });

  it("goes dead when a MOUNTED frame flips to classic — the gate is the published origin", async () => {
    // FIX-ROUND CELL (round 1). The case below mounts the classic arm from cold with the viewport's own
    // `rows` override, which means it also passes against a viewport that never reads `useRegionTop` at all:
    // the synthetic mount hands the budget over directly while the ROWS context still answers 0, so "some
    // gate exists" is all that is pinned. Replacing `useRegionTop()` with a local derivation kept every cell
    // green. Flipping the SAME mounted frame from one renderer to the other, at one geometry, with one
    // document, leaves the published origin as the only thing that changed — so this is the cell that says
    // the gate IS the frame's origin. It is also the only cover the flip path has.
    //   WHAT IT STILL CANNOT SEPARATE, measured rather than assumed: an origin derived from the OTHER frame
    // channel — `useRegionRows() > 0 ? 1 : 0` — passes every cell in this file, because the rows context is
    // 0 on exactly the renderer the top context is 0 on. The two are indistinguishable at every geometry the
    // frame can produce, and they part company only the day something paints ABOVE the region: the rows
    // channel would still say "bounded" while every row moved down. That day is what the published origin
    // exists for and what no synthetic mount can stage — the paint-order canary in the first case is the
    // half of it a test CAN hold.
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene({ hitmap, rows: 8 }));
    await settle();
    const foldRow = rowOf(lastFrame(), FOLD_TEXT);
    expect(hitmap.current!.anchorAt(1, foldRow)).toBe("read-1");

    rerender(scene({ hitmap, classic: true, rows: 8 }));
    await settle();
    // The paint is unchanged — same rows, same document, same window — so nothing about WHERE the cluster is
    // can explain the answer below. Only the origin the frame publishes has moved, from 1 to 0.
    expect(rowOf(lastFrame(), FOLD_TEXT)).toBe(foldRow);
    expect(hitmap.current!.anchorAt(1, foldRow)).toBeUndefined();
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
