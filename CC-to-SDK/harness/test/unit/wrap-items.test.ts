// test/unit/wrap-items.test.ts — FSW T17 fix round: the projection in PAINTED rows.
//
// The claim is arithmetic, not appearance. `renderItemHeight` is the number every windowing surface budgets
// with, and it is honest only over a projection already wrapped to the width it will be painted at — Ink
// re-wraps anything wider than its box, so an over-wide row costs two and is charged one. Three properties
// carry the module: the height is the painted height, a row that already fits is untouched (object identity,
// `segments` and all, which is what keeps a settled frame allocation-free), and a document POSITION survives
// a re-wrap so a held scroll offset can be translated rather than carried.
import { describe, it, expect } from "vitest";
import { paintedHeight, remapRowOffset, sourceId, wrapItemsToWidth, wrapLine } from "../../src/tui/wrapItems.js";
import { renderItemHeight } from "../../src/tui/pager.js";
import { TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";

const rows = (items: readonly RenderItem[]) => items.reduce((sum, i) => sum + renderItemHeight(i), 0);
const line = (id: string, text: string): RenderItem => ({ kind: "line", id, line: { text } });
const text = (item: RenderItem) => (item.kind === "line" ? item.line.text : item.body.map((l) => l.text).join("|"));

describe("wrapLine", () => {
  it("returns the SAME object when the line already fits", () => {
    const l = { text: "hi", bold: true, segments: [{ text: "hi", bold: true }] };
    expect(wrapLine(l, 40)[0]).toBe(l);
  });

  it("pays for the gutter's columns and keeps the glyph on the first row only", () => {
    // `⏺ ` measures three columns (U+23FA is East-Asian wide), so a 10-column pane leaves seven.
    const out = wrapLine({ text: "1234567890", gutter: { text: "⏺ " } }, 10);
    expect(out.map((l) => l.text)).toEqual(["1234567", "   890"]);
    expect(out[0]!.gutter?.text).toBe("⏺ ");
    expect(out[1]!.gutter).toBeUndefined();
  });

  // THE STYLING SURVIVES THE CUT, which is not a nicety: `renderMarkdown` does not wrap prose at all, so on
  // the finalized document nearly every assistant paragraph is a wrapped segmented line — dropping segments
  // there would take the bold, the inline code and the colour out of the whole transcript.
  it("re-cuts the segment list at the wrap's own offsets", () => {
    const out = wrapLine({ text: "abcdefghij", segments: [{ text: "abcde", bold: true }, { text: "fghij" }] }, 5);
    expect(out).toHaveLength(2);
    expect(out[0]!.segments).toEqual([{ text: "abcde", bold: true }]);
    expect(out[1]!.segments).toEqual([{ text: "fghij" }]);
  });

  it("cuts a segment that straddles a break, and indents the continuation's first segment", () => {
    const out = wrapLine({ text: "1234567890", segments: [{ text: "1234567890", color: "red" }], gutter: { text: "⏺ " } }, 10);
    expect(out.map((l) => l.text)).toEqual(["1234567", "   890"]);
    expect(out[0]!.segments).toEqual([{ text: "1234567", color: "red" }]);
    expect(out[1]!.segments).toEqual([{ text: "   890", color: "red" }]);   // the gutter's three columns ride the segment
  });

  it("falls back to the plain text when a character offset cannot mean anything", () => {
    // A `preStyled` segment is raw SGR bytes (F3's bold-count rows), and a list that does not concatenate to
    // `text` is not describing this text. Both keep their ROW COUNT, which is what the window budgets with.
    const raw = wrapLine({ text: "abcdefghij", segments: [{ text: "\x1b[1mabcdefghij\x1b[22m", preStyled: true }] }, 5);
    expect(raw).toHaveLength(2);
    expect(raw.every((l) => l.segments === undefined)).toBe(true);
    const mismatched = wrapLine({ text: "abcdefghij", segments: [{ text: "nope" }] }, 5);
    expect(mismatched).toHaveLength(2);
    expect(mismatched.every((l) => l.segments === undefined)).toBe(true);
  });
});

describe("wrapItemsToWidth", () => {
  it("reports the rows a line PAINTS, not the one item it is", () => {
    const items = wrapItemsToWidth([line("a", "x".repeat(25))], 10);
    expect(items).toHaveLength(3);
    expect(rows(items)).toBe(3);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);          // distinct keys, never a collision
    expect(items.every((i) => sourceId(i.id) === "a")).toBe(true); // …all naming the row they came from
  });

  it("returns the ARRAY it was given when nothing wrapped", () => {
    const items = [line("a", "short"), line("b", "also short")];
    expect(wrapItemsToWidth(items, 80)).toBe(items);
  });

  it("leaves a truncate-end header at one row however wide it is", () => {
    const header: RenderItem = { kind: "line", id: "h", line: { text: "T".repeat(200) }, wrap: "truncate-end" };
    expect(wrapItemsToWidth([header], 20)).toEqual([header]);
  });

  it("wraps a gutter block's BODY and keeps it one item, so the connector is still printed once", () => {
    const block: RenderItem = { kind: "gutter-block", id: "g", gutter: TOOL_RESULT_GUTTER, body: [{ text: "y".repeat(30) }] };
    const [out] = wrapItemsToWidth([block], 20);                   // 20 − 5 gutter columns = 15 per row
    expect(out!.kind).toBe("gutter-block");
    expect(renderItemHeight(out!)).toBe(2);
    expect(text(out!)).toBe("yyyyyyyyyyyyyyy|yyyyyyyyyyyyyyy");
  });

  it("caches per (item, width): the same item at the same width answers the same array", () => {
    const item = line("a", "z".repeat(25));
    const first = wrapItemsToWidth([item], 10), second = wrapItemsToWidth([item], 10);
    expect(second[0]).toBe(first[0]);
    expect(wrapItemsToWidth([item], 40)[0]).toBe(item);            // …and a different width is re-answered
  });
});

// FSW BACKLOG 3 — the same measure, WITHOUT the projection. A windowing selector walks items one at a time
// and only ever needs their heights, so building (and discarding) the wrapped array per candidate would be
// the whole document's worth of allocation per frame. This is the height alone, off the same cache.
describe("paintedHeight", () => {
  it("reports the rows a wide line paints, and 1 for one that fits", () => {
    expect(paintedHeight(line("a", "x".repeat(25)), 10)).toBe(3);   // ⌈25/10⌉
    expect(paintedHeight(line("b", "short"), 80)).toBe(1);
  });

  it("charges a gutter block its BODY rows at width − gutter", () => {
    // `TOOL_RESULT_GUTTER` is five columns, so a 30-character body at width 20 wraps at 15: two rows.
    const block: RenderItem = { kind: "gutter-block", id: "g", gutter: TOOL_RESULT_GUTTER, body: [{ text: "y".repeat(30) }] };
    expect(paintedHeight(block, 20)).toBe(2);
    expect(paintedHeight(block, 80)).toBe(1);
  });

  it("agrees with the projection it is the height of, item for item", () => {
    // The one property that matters: no caller may get a different answer from the cheap measure than the
    // renderer gets from `wrapItemsToWidth`, or the window and the frame are budgeting different documents.
    const items = [line("a", "x".repeat(25)), line("b", "fits"), { kind: "line" as const, id: "h", line: { text: "T".repeat(200) }, wrap: "truncate-end" as const }];
    for (const item of items) expect(paintedHeight(item, 10)).toBe(rows(wrapItemsToWidth([item], 10)));
  });
});

describe("remapRowOffset", () => {
  const doc = [line("a", "0".repeat(20)), line("b", "1".repeat(20)), line("c", "2".repeat(20))];
  const wide = wrapItemsToWidth(doc, 20);                          // one row each
  const narrow = wrapItemsToWidth(doc, 10);                        // two rows each

  it("translates a row number into the row that holds the same document position", () => {
    expect(remapRowOffset(wide, narrow, 1)).toBe(2);               // the top of `b`, which is now row 2
    expect(remapRowOffset(narrow, wide, 2)).toBe(1);               // …and back
  });

  it("keeps the reader's place INSIDE an item that grew", () => {
    const tall = wrapItemsToWidth([line("a", "0".repeat(40))], 10);        // four rows
    const short = wrapItemsToWidth([line("a", "0".repeat(40))], 20);       // two rows
    expect(remapRowOffset(tall, short, 2)).toBe(1);                        // halfway stays halfway
    expect(remapRowOffset(short, tall, 1)).toBe(2);
  });

  it("hands back what it was given when the position cannot be named", () => {
    expect(remapRowOffset(wide, narrow, 0)).toBe(0);
    expect(remapRowOffset(wide, narrow, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(remapRowOffset(wide, narrow, 99)).toBe(99);                     // past the end; the clamp answers
    expect(remapRowOffset(wide, wrapItemsToWidth([line("z", "z")], 10), 1)).toBe(1);   // the item is gone
  });
});
