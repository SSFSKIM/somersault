// test/unit/streaming-items.test.ts — FSW Task 3's honesty module. The claim under test is arithmetic, not
// appearance: after `streamingItems`, the number of rows a live line will occupy is knowable BEFORE Ink lays
// it out, because each physical row is its own one-row item. Task 10's viewport slices by those rows
// (`pageItemSlices`), so a line that reports one row and paints three would push the frame past the height
// the fullscreen frame promised.
import { describe, it, expect } from "vitest";
import { streamingItems } from "../../src/tui/streamingItems.js";
import { renderItemHeight } from "../../src/tui/pager.js";
import type { RenderLine } from "../../src/tui/render.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

const rows = (items: readonly RenderItem[]) => items.reduce((sum, i) => sum + renderItemHeight(i), 0);
const text = (item: RenderItem) => (item.kind === "line" ? item.line.text : item.body.map((l) => l.text).join("\n"));

describe("streamingItems", () => {
  it("reports three rows for a line three times the width, one item per physical row", () => {
    const line: RenderLine = { text: "abcdefghij".repeat(3) };      // 30 columns at a width of 10
    const items = streamingItems([line], 10);
    expect(items).toHaveLength(3);
    expect(rows(items)).toBe(3);
    expect(items.map(text)).toEqual(["abcdefghij", "abcdefghij", "abcdefghij"]);
  });

  it("leaves a line that already fits completely untouched — styling, segments and all", () => {
    const line: RenderLine = { text: "hi there", bold: true, segments: [{ text: "hi ", bold: true }, { text: "there", color: "#ff0000" }] };
    const items = streamingItems([line], 40);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind === "line" && items[0]!.line).toEqual(line);
  });

  it("pays for the gutter's columns and keeps the glyph on the first row only", () => {
    // `⏺ ` MEASURES three columns, not two — U+23FA is East-Asian wide, which is exactly why the inset is
    // taken from `stringWidth` and not from the glyph count. A 10-column terminal therefore leaves seven for
    // the body, and the continuation row is indented to sit under it rather than under the bullet.
    const line: RenderLine = { text: "1234567890", gutter: { text: "⏺ " } };
    const items = streamingItems([line], 10);
    expect(items).toHaveLength(2);
    expect(items.map(text)).toEqual(["1234567", "   890"]);
    expect(items[0]!.kind === "line" && items[0]!.line.gutter?.text).toBe("⏺ ");
    expect(items[1]!.kind === "line" && items[1]!.line.gutter).toBeUndefined();
  });

  it("gives an embedded newline its own row, and an empty line one row rather than none", () => {
    expect(rows(streamingItems([{ text: "a\nb\nc" }], 80))).toBe(3);
    expect(rows(streamingItems([{ text: "" }], 80))).toBe(1);
  });

  it("ids are positional and stable across calls, so React keeps its instances between deltas", () => {
    const first = streamingItems([{ text: "one" }, { text: "two" }], 80).map((i) => i.id);
    const second = streamingItems([{ text: "one" }, { text: "two!!" }], 80).map((i) => i.id);
    // T17 fix round: the id of a row that did NOT wrap is the SOURCE id, and a wrapped one wears
    // `wrapItems`' `#w<row>` suffix — which is what lets a held scroll offset be remapped across a re-wrap.
    expect(first).toEqual(["stream:0", "stream:1"]);
    expect(second).toEqual(first);
    // …and a wrapped line's rows are distinct ids, never a collision that would drop rows.
    expect(new Set(streamingItems([{ text: "x".repeat(25) }], 10).map((i) => i.id)).size).toBe(3);
  });
});
