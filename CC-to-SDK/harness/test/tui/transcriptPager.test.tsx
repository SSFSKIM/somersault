// tui/test/transcriptPager.test.tsx — the Ctrl-O transcript pager (Task 5): opens at the bottom,
// j/k/Ctrl-U/Ctrl-D/space/b/g/G navigate via the pure pager.ts reducer, q/Esc/Ctrl-C all close.
// Task 5 migrated the prop a second time (Task 4: `lines` → `items`; here: `items` → `makeItems`), because
// the pager now asks the retained source for a projection instead of being handed one frozen list.
//
// F2 task 7: the pager stopped calling `useInput` — it pushes the `Transcript` context and registers the
// bundle's scroll/exit/toggle ACTIONS, so a key only reaches it through <KeymapProvider>. Rendered bare it
// has no input path at all, hence `renderWithKeymap`. home/end are new here (P86: Ink's `useInput` cannot
// tell them apart from insert or F1–F12, so they were unreachable before the parser).
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { TranscriptPager, PAGER_INSET } from "../../src/tui/TranscriptPager.js";
import { pagerChromeRows } from "../../src/tui/RegionPager.js";
import { pageItemSlices } from "../../src/tui/pager.js";
import { remapRowOffset, sourceId, wrapItemsToWidth } from "../../src/tui/wrapItems.js";
import { TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import { FullscreenViewport } from "../../src/tui/FullscreenViewport.js";

const tick = () => new Promise((r) => setTimeout(r, 20));
const mkLines = (n: number): RenderItem[] => Array.from({ length: n }, (_, i) => ({ kind: "line", id: `i${i}`, line: { text: `line ${i + 1}` } }));
const always = (items: RenderItem[]) => () => items;

describe("TranscriptPager", () => {
  it("paginates a long gutter result as physical slices with exactly one gutter", () => {
    // The gutter's fifth column is U+00A0 — import the constant, never retype it.
    const item: RenderItem = { kind: "gutter-block", id: "r", gutter: TOOL_RESULT_GUTTER, body: Array.from({ length: 40 }, (_, i) => ({ text: `line ${i + 1}` })) };
    const first = pageItemSlices([item], 0, 3), second = pageItemSlices([item], 3, 3);
    expect(first.slices[0]).toMatchObject({ start: 0, end: 3, showGutter: true }); expect(second.slices[0]).toMatchObject({ start: 3, end: 6, showGutter: false });
  });
  it("opens at the BOTTOM (most recent) and shows the window position", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    expect(r.lastFrame()).toContain("line 50");
    expect(r.lastFrame()).not.toContain("line 40 ");     // 41–50 visible
    expect(r.lastFrame()).toContain("41–50 of 50");
  });
  it("k scrolls up a line, g jumps to top, G back to bottom", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("k"); await tick();
    expect(r.lastFrame()).toContain("40–49 of 50");
    r.stdin.write("g"); await tick();
    expect(r.lastFrame()).toContain("1–10 of 50");
    r.stdin.write("G"); await tick();
    expect(r.lastFrame()).toContain("41–50 of 50");
  });
  it("home jumps to the top and end back to the bottom (NEW — the keys Ink's useInput could not name)", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("\x1b[H"); await tick();                // home
    expect(r.lastFrame()).toContain("1–10 of 50");
    r.stdin.write("\x1b[F"); await tick();                // end
    expect(r.lastFrame()).toContain("41–50 of 50");
    r.stdin.write("\x1b[1~"); await tick();               // the tilde spelling of home is the same key
    expect(r.lastFrame()).toContain("1–10 of 50");
    r.stdin.write("\x1b[4~"); await tick();               // …and of end
    expect(r.lastFrame()).toContain("41–50 of 50");
  });
  it("Ctrl-U scrolls half a page up; space a full page down", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("\x15"); await tick();                  // Ctrl-U
    expect(r.lastFrame()).toContain("36–45 of 50");
    r.stdin.write(" "); await tick();
    expect(r.lastFrame()).toContain("41–50 of 50");       // clamped at bottom
  });
  // FSW BACKLOG 5 — THE WHEEL READS THE PAGER TOO. Once the alt-screen guard arms `?1000h ?1006h`, a wheel
  // tick arrives as the key `wheelup`/`wheeldown` (canon `RUu`, L169140) and the `Transcript` context binds
  // both to its own line pair — the same operation j/k perform, one row per tick (canon L181212's ±1 delta).
  it("the wheel scrolls a line at a time, exactly as j/k do", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("\x1b[<64;10;5M"); await tick();        // wheel up
    expect(r.lastFrame()).toContain("40–49 of 50");
    r.stdin.write("\x1b[<64;10;5M"); await tick();
    expect(r.lastFrame()).toContain("39–48 of 50");
    r.stdin.write("\x1b[<65;10;5M"); await tick();        // wheel down
    expect(r.lastFrame()).toContain("40–49 of 50");
  });

  // …AND THE PAGER IS THE ONE THAT READS IT. In fullscreen the ctrl+O pager mounts innermost over a viewport
  // that binds the same two keys in its own `Scroll` context, and mount order is what arbitrates: without the
  // `Transcript` entries the tick would fall through and scroll the transcript UNDERNEATH the box the reader
  // is looking at. The real fullscreen tree swaps the two rather than stacking them (`RegionPager` replaces
  // the region), so this pins the TABLE's precedence directly, where a surface change cannot hide it.
  it("wins the wheel over a viewport mounted beneath it", async () => {
    const doc: RenderItem[] = Array.from({ length: 200 }, (_, i) => ({ kind: "line", id: `V${i}`, line: { text: `V${i}` } }));
    const r = render(<>
      <FullscreenViewport finalizedItems={doc} pendingItems={[]} streaming={[]} columns={80} rows={10} />
      <TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />
    </>);
    await tick();
    const before = (r.lastFrame() ?? "").includes("V190");   // the viewport is stuck to its own tail
    r.stdin.write("\x1b[<64;10;5M"); await tick();
    expect(before).toBe(true);
    expect(r.lastFrame()).toContain("40–49 of 50");           // the pager moved…
    expect(r.lastFrame()).toContain("V190");                  // …and the viewport did not
  });

  // Ctrl-O is new to the pager itself: ChatApp used to special-case it as "the pager's close arm" behind the
  // owner gate; the Transcript context binds it to transcript:exit now, so the pager owns all four.
  it("q, Esc, Ctrl-C and Ctrl-O all close", async () => {
    for (const keyByte of ["q", "\x1b", "\x03", "\x0f"]) {
      let closed = 0;
      const r = render(<TranscriptPager makeItems={always(mkLines(5))} onClose={() => { closed++; }} height={10} />);
      await tick();
      r.stdin.write(keyByte); await tick();
      expect(closed).toBe(1);
    }
  });
  it("short transcript renders whole and never scrolls negative", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(3))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("k"); await tick();
    expect(r.lastFrame()).toContain("1–3 of 3");
  });
});

// ── THE POSITION LINE COUNTS THE ROWS IT PAINTS (FSW T17 fix round, the pager's turn) ──────────────────────
// `renderItemHeight` answers 1 for every `kind: "line"` item, and `renderMarkdown` does NOT wrap prose — so a
// 200-column paragraph is ONE logical line the box paints as three. Counted logically, the pager's total is
// short by the wrap overflow: the header names rows the box cannot reach, the clamp stops the reader before
// the tail, and the box runs taller than the height it was budgeted. Wrap at the pager's inner width
// (`columns − PAGER_INSET`) and all three follow from one honest total.
describe("TranscriptPager counts painted rows, not logical ones", () => {
  // `ink-testing-library`'s stdout stub reports 100 columns; the border (2) + paddingX (2) leave 96 inside,
  // so a 208-column line paints three rows.
  const COLS = 100;
  const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
  const wide = (n: number): RenderItem[] =>
    Array.from({ length: n }, (_, i) => ({ kind: "line", id: `w${i}`, line: { text: `w${i}-${"x".repeat(200)}-end${i}` } }));

  it("its total is the WRAPPED row count, and the tail is reachable at the bottom", async () => {
    const r = render(<TranscriptPager makeItems={always(wide(20))} onClose={() => {}} height={10} />);
    await tick();
    expect(r.lastFrame()).toContain("51–60 of 60");     // 20 items × 3 painted rows, not 20
    expect(r.lastFrame()).toContain("-end19");          // …and the last item's LAST row is on screen
  });

  it("never paints more body rows than the height it was given", async () => {
    const r = render(<TranscriptPager makeItems={always(wide(20))} onClose={() => {}} height={10} />);
    await tick();
    expect(rowsOf(r.lastFrame())).toHaveLength(10 + pagerChromeRows(COLS));
  });

  it("scrolls by painted row, so g/G bracket the wrapped document", async () => {
    const r = render(<TranscriptPager makeItems={always(wide(20))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("g"); await tick();
    expect(r.lastFrame()).toContain("1–10 of 60");
    expect(r.lastFrame()).toContain("w0-");
    r.stdin.write("k"); await tick();
    expect(r.lastFrame()).toContain("1–10 of 60");      // already at the top; no negative row
    r.stdin.write("G"); await tick();
    expect(r.lastFrame()).toContain("51–60 of 60");
  });

  it("takes the width it is TOLD over the terminal's, so the region's pager wraps at the region's width", async () => {
    // Half the width, so each line paints five rows instead of three (208 / 46 = 5).
    const r = render(<TranscriptPager makeItems={always(wide(20))} onClose={() => {}} height={10} columns={50} />);
    await tick();
    expect(r.lastFrame()).toContain("of 100");
  });
});

// ── A WIDTH CHANGE MUST NOT MOVE THE READER (FSW backlog 1) ────────────────────────────────────────────────
// `offset` is a PAINTED-ROW index at the width it was measured at, so a resize re-numbers every row below the
// first item whose wrapped height changed and the same number then names a different document position. The
// held offset is therefore translated by the position it NAMES — `remapRowOffset`, the same remedy
// `FullscreenViewport` applies on its own width axis. The bottom sentinel needs none of it: Infinity is
// "wherever the tail is", and `pageItemSlices` clamps it.
describe("TranscriptPager keeps its place across a width change", () => {
  const HEIGHT = 10, WIDE = 100, NARROW = 50;
  // Every row of an item carries that item's own marker, so the FIRST BODY ROW of a frame names the source
  // item at the top of the window whether it is a first row or a continuation. 180 columns: two painted rows
  // at the wide inset (96), four at the narrow one (46).
  const marked = (n: number): RenderItem[] =>
    Array.from({ length: n }, (_, i) => ({ kind: "line", id: `w${i}`, line: { text: `w${i} `.repeat(60).trimEnd() } }));
  /** Row 0 is the top border, row 1 the `lines a–b of N` header; the body starts under them. */
  const firstBodyRow = (frame: string | undefined): string => (frame ?? "").split("\n")[2] ?? "";
  const rowsAt = (items: readonly RenderItem[], columns: number) => wrapItemsToWidth(items, columns - PAGER_INSET);

  it("translates a held offset, so the same SOURCE item stays at the top", async () => {
    const items = marked(8);
    const r = render(<TranscriptPager makeItems={always(items)} onClose={() => {}} height={HEIGHT} columns={WIDE} />);
    await tick();
    r.stdin.write("g"); await tick();
    for (const _ of [0, 1, 2]) { r.stdin.write("j"); await tick(); }
    const held = 3;                                                     // three rows below the top
    const before = pageItemSlices(rowsAt(items, WIDE), held, HEIGHT);
    expect(r.lastFrame()).toContain(`lines ${held + 1}–${held + HEIGHT} of ${before.total}`);
    expect(firstBodyRow(r.lastFrame())).toContain("w1 ");               // the item the reader is on
    expect(sourceId(before.slices[0]!.item.id)).toBe("w1");

    r.rerender(<TranscriptPager makeItems={always(items)} onClose={() => {}} height={HEIGHT} columns={NARROW} />);
    await tick();
    // THE CONTRACT, not a re-derivation: the expected row is `remapRowOffset`'s own answer.
    const expected = remapRowOffset(rowsAt(items, WIDE), rowsAt(items, NARROW), held);
    const after = pageItemSlices(rowsAt(items, NARROW), expected, HEIGHT);
    expect(expected).not.toBe(held);                                    // the rows really did re-number
    expect(sourceId(after.slices[0]!.item.id)).toBe("w1");
    expect(r.lastFrame()).toContain(`lines ${expected + 1}–${expected + HEIGHT} of ${after.total}`);
    expect(firstBodyRow(r.lastFrame())).toContain("w1 ");
  });

  it("a scroll after the resize starts from the translated row, not the old number", async () => {
    const items = marked(8);
    const r = render(<TranscriptPager makeItems={always(items)} onClose={() => {}} height={HEIGHT} columns={WIDE} />);
    await tick();
    r.stdin.write("g"); await tick();
    for (const _ of [0, 1, 2]) { r.stdin.write("j"); await tick(); }
    r.rerender(<TranscriptPager makeItems={always(items)} onClose={() => {}} height={HEIGHT} columns={NARROW} />);
    await tick();
    const expected = remapRowOffset(rowsAt(items, WIDE), rowsAt(items, NARROW), 3);
    r.stdin.write("j"); await tick();
    // The total comes off the pager's OWN slicer, as in the test above — a hand-rolled reduce here would be a
    // second height model, and pinning the header against it would prove only that the two agree today.
    const { total } = pageItemSlices(rowsAt(items, NARROW), expected + 1, HEIGHT);
    expect(r.lastFrame()).toContain(`lines ${expected + 2}–${expected + 1 + HEIGHT} of ${total}`);
  });

  // BL1 REVIEW MINOR — the guard's other side, and the one a remap keyed on the wrong thing would break:
  // `makeItems` mints FRESH item objects on every render, so identity churn alone must not translate anything.
  // Same width, re-projected document, header byte-identical — the reader stays exactly where they scrolled to.
  it("leaves the header alone when the document is re-projected at an unchanged width", async () => {
    const r = render(<TranscriptPager makeItems={() => marked(8)} onClose={() => {}} height={HEIGHT} columns={WIDE} />);
    await tick();
    r.stdin.write("g"); await tick();
    for (const _ of [0, 1, 2]) { r.stdin.write("j"); await tick(); }
    const header = (r.lastFrame() ?? "").split("\n")[1];
    expect(header).toContain(`lines 4–${3 + HEIGHT} of `);              // the positive control: we really scrolled
    r.rerender(<TranscriptPager makeItems={() => marked(8)} onClose={() => {}} height={HEIGHT} columns={WIDE} />);
    await tick();
    expect((r.lastFrame() ?? "").split("\n")[1]).toBe(header);
  });

  it("the bottom sentinel needs no remap — a width change still shows the last rows", async () => {
    const items = marked(8);
    const r = render(<TranscriptPager makeItems={always(items)} onClose={() => {}} height={HEIGHT} columns={WIDE} />);
    await tick();
    const wideTotal = rowsAt(items, WIDE).length;
    expect(r.lastFrame()).toContain(`lines ${wideTotal - HEIGHT + 1}–${wideTotal} of ${wideTotal}`);
    r.rerender(<TranscriptPager makeItems={always(items)} onClose={() => {}} height={HEIGHT} columns={NARROW} />);
    await tick();
    const narrowTotal = rowsAt(items, NARROW).length;
    expect(r.lastFrame()).toContain(`lines ${narrowTotal - HEIGHT + 1}–${narrowTotal} of ${narrowTotal}`);
    expect(r.lastFrame()).toContain("w7 ");                             // the tail is still on screen
  });
});
