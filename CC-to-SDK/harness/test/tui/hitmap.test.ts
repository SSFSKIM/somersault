// tui/test/hitmap.test.ts — F9 T-MOUSE Task 1: the widened hit-map substrate every later mouse feature
// (hover, click-to-caret, drag selection) will query. `fold-hitmap.test.tsx` already proves the component
// wiring — the frame origin, `anchorAt`'s column bound, the scroll/classic/dock gates — and none of that is
// re-proved here. What THIS file pins is the shape `hitRowsOf` (`FullscreenViewport.tsx`, now exported for
// exactly this) now publishes per row, and the two pure column-addressing functions `mouse/hitmap.ts` adds.
// No React tree is mounted anywhere below: every case builds `RenderItem`s, runs them through the REAL
// `wrapItemsToWidth` → `pageItemSlices` → `hitRowsOf` pipeline (the same one `FullscreenViewport` calls at
// paint time), and reads the `HitRow[]` it publishes.
import { describe, it, expect } from "vitest";
import stringWidth from "string-width";
import { wrapItemsToWidth } from "../../src/tui/wrapItems.js";
import { pageItemSlices } from "../../src/tui/pager.js";
import { hitRowsOf } from "../../src/tui/FullscreenViewport.js";
import { columnToChar, charToColumn, sourceEndpointAt, columnOfSourceChar, type HitRow } from "../../src/tui/mouse/hitmap.js";
import { GROUP_HINT_GUTTER, TOOL_RESULT_GUTTER, projectCompact, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

/** Runs a document of `RenderItem`s through the SAME pipeline `FullscreenViewport` publishes from: wrap to
 *  `columns`, window the whole thing (a budget larger than any fixture here needs), then build the hit map.
 *  This is "the real publish path" the brief's test descriptions ask for — map ≡ paint, same as production. */
const publish = (items: readonly RenderItem[], columns: number): readonly HitRow[] => {
  const wrapped = wrapItemsToWidth(items, columns);
  const { slices } = pageItemSlices(wrapped, 0, 200);
  return hitRowsOf(slices, columns);
};

const plainLine = (id: string, text: string, foldAnchor?: string): RenderItem => ({ kind: "line", id, line: { text }, ...(foldAnchor ? { foldAnchor } : {}) });

describe("hitRowsOf publishes the widened HitRow", () => {
  it("carries plain text and gutter for a gutter-block row", () => {
    // The body line's text carries raw SGR bytes on purpose — no real producer does this (`toolRenderer.tsx`
    // already strips a `preStyled` run before it reaches `RenderLine.text`), but the brief's contract is
    // "plain text via the existing `stripSgr`", and the only way to prove `hitRowsOf` actually calls it
    // (rather than trusting an upstream guarantee) is to hand it something that still needs stripping.
    const item: RenderItem = { kind: "gutter-block", id: "g:read-1:result", gutter: TOOL_RESULT_GUTTER, body: [{ text: "\x1b[2mhello\x1b[22m" }], foldAnchor: "read-1" };
    const [row] = publish([item], 40);
    expect(row!.kind).toBe("gutter-block");
    expect(row!.text).toBe("hello");
    expect(row!.text).not.toContain("\x1b");
    expect(row!.gutterWidth).toBe(TOOL_RESULT_GUTTER.length);
    expect(row!.anchor).toBe("read-1");
  });

  // F10 T-MAINT item 6 (F9 mouse/T1 Minor): the OTHER arm. `kind` is directly asserted for
  // `gutter-block` above and nowhere for the ordinary line, so the `hitRowsOf` branch that handles the
  // overwhelming majority of painted rows (`FullscreenViewport.tsx:259`) had no direct pin at all —
  // swapping the two arms' `kind` would have left this file green.
  it("an ordinary line row is kind `line`, with no gutter", () => {
    const [row] = publish([plainLine("p1", "plain row")], 40);
    expect(row!.kind).toBe("line");
    expect(row!.gutterWidth).toBe(0);
    expect(row!.text).toBe("plain row");
  });

  it("marks soft-wrap continuations", () => {
    const item = plainLine("long", "x".repeat(50));
    const rows = publish([item], 20);
    expect(rows.length).toBeGreaterThanOrEqual(3);           // 50 chars at width 20 wraps to 3 rows
    expect(rows[0]!.softWrap).toBe("hard");
    expect(rows[1]!.softWrap).toBe("continuation");
    expect(rows[2]!.softWrap).toBe("continuation");
  });

  it("every row carries an itemKey; fold rows also carry anchor", () => {
    const rows = publish([plainLine("p1", "plain row"), plainLine("g1", "fold row", "anchor-1")], 40);
    expect(rows[0]!.itemKey).toBe("p1");
    expect(rows[0]!.anchor).toBeUndefined();
    expect(rows[1]!.itemKey).toBe("g1");
    expect(rows[1]!.anchor).toBe("anchor-1");
  });

  it("itemKey is stable across repaint with insertion — a slice-index key would fail this", () => {
    const target = plainLine("target", "y".repeat(50));                 // wraps to several rows at width 20
    const before = publish([target], 20);
    const targetRowsBefore = before.filter((r) => r.itemKey === "target");
    expect(targetRowsBefore.length).toBeGreaterThanOrEqual(3);
    const keyBefore = targetRowsBefore[0]!.itemKey;
    // Every wrap fragment of the SAME source item shares the SAME key — never a per-fragment suffix.
    expect(new Set(targetRowsBefore.map((r) => r.itemKey)).size).toBe(1);

    // Insert a brand-new item ABOVE the target and republish. A slice-INDEX-based key would shift by
    // however many rows the inserted item painted (three here); `sourceId(item.id)` does not.
    const after = publish([plainLine("inserted", "z".repeat(50)), target], 20);
    const targetRowsAfter = after.filter((r) => r.itemKey === "target");
    expect(targetRowsAfter.length).toBe(targetRowsBefore.length);
    expect(targetRowsAfter[0]!.itemKey).toBe(keyBefore);
    expect(new Set(targetRowsAfter.map((r) => r.itemKey)).size).toBe(1);
    // The row's own array POSITION did move — proving the fixture actually exercises the insertion, not a
    // no-op — while the key it carries did not.
    expect(after.indexOf(targetRowsAfter[0]!)).toBeGreaterThan(before.indexOf(targetRowsBefore[0]!));
  });

  it("linkRanges arrive through the real fold publish path (T-PRLINK)", () => {
    // The exact fixture `fullscreen-prlink.test.tsx` pins for the visual half: a real `gh pr create` Bash
    // call, scraped into a `GitPrOp`, folded into ONE collapsed-cluster row whose clause run links `#12`.
    const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
      ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
    const result = (id: string, content = "body") =>
      ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } }) as Record<string, unknown>;
    const prose = (text: string, id: string) => ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
    const doc = new TranscriptDocument();
    doc.appendSdk("host", call("bash-1", "Bash", { command: "gh pr create --fill" }));
    doc.appendSdk("host", result("bash-1", "https://github.com/o/r/pull/12\n"));
    // A run is only PUBLISHED once a breaker closes it (`projectCompact`'s own rule — the trailing fold run
    // stays pending, not `group:`-prefixed, until the next entry breaks it); this trailing prose is that
    // breaker, exactly as `fullscreen-prlink.test.tsx`'s own fixture carries one.
    doc.appendSdk("host", prose("done", "t-done"));
    const FS = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0, fullscreen: true, expandHint: "" };
    const items = projectCompact(doc, FS);
    const clauseItem = items.find((i) => i.id.startsWith("group:"));
    expect(clauseItem).toBeDefined();

    const rows = publish([clauseItem!], 100);
    const row = rows.find((r) => r.linkRanges !== undefined);
    expect(row, `no row carried linkRanges; texts: ${rows.map((r) => JSON.stringify(r.text)).join(", ")}`).toBeDefined();
    expect(row!.text).toContain("Created PR #12");
    const [link] = row!.linkRanges!;
    expect(link!.href).toBe("https://github.com/o/r/pull/12");
    expect(row!.text.slice(link!.start, link!.end)).toBe("#12");
  });
});

describe("F10 S4 — HitRow carries the SOURCE range, minted at wrap time (or its fallback)", () => {
  it("an unwrapped line: charStart 0, charEnd is the whole source length, textStart 0", () => {
    const [row] = publish([plainLine("p1", "hello")], 40);
    expect(row).toMatchObject({ charStart: 0, charEnd: "hello".length, textStart: 0 });
  });

  it("a line wrapped into three rows: contiguous ranges, last charEnd is the source length", () => {
    const rows = publish([plainLine("w1", "x".repeat(25))], 10);
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ charStart: 0, charEnd: 10 });
    expect(rows[1]).toMatchObject({ charStart: 10, charEnd: 20 });
    expect(rows[2]).toMatchObject({ charStart: 20, charEnd: 25 });
  });

  it("a gutter block with two body lines: the second's range starts one past the first's length", () => {
    const item: RenderItem = { kind: "gutter-block", id: "b1", gutter: TOOL_RESULT_GUTTER,
      body: [{ text: "x".repeat(20) }, { text: "second" }] };
    const rows = publish([item], 40);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ charStart: 0, charEnd: 20 });
    expect(rows[1]).toMatchObject({ charStart: 21, charEnd: 21 + "second".length });
  });

  it("the same gutter block sliced from row 1 keeps its surviving rows' true source positions", () => {
    const item: RenderItem = { kind: "gutter-block", id: "b2", gutter: TOOL_RESULT_GUTTER,
      body: [{ text: "aaaa" }, { text: "bbbbb" }, { text: "cc" }] };
    const wrapped = wrapItemsToWidth([item], 40);
    const full = hitRowsOf(pageItemSlices(wrapped, 0, 3).slices, 40);
    const { slices } = pageItemSlices(wrapped, 1, 2);          // cuts the first body row ("aaaa") away
    const sliced = hitRowsOf(slices, 40);
    expect(sliced.length).toBe(2);
    // Unchanged by the slice: the surviving rows name the SAME source positions as in the unsliced publish.
    expect(sliced[0]).toMatchObject({ charStart: full[1]!.charStart, charEnd: full[1]!.charEnd });
    expect(sliced[1]).toMatchObject({ charStart: full[2]!.charStart, charEnd: full[2]!.charEnd });
    expect(sliced[0]).toMatchObject({ charStart: 5, charEnd: 10 });     // 4 + 1 ("aaaa" + \n)
    expect(sliced[1]).toMatchObject({ charStart: 11, charEnd: 13 });    // 5 + 1 + 5 + 1 ("bbbbb" + \n)
  });
});

const mkRow = (overrides: Partial<HitRow> & Pick<HitRow, "text">): HitRow => ({
  itemKey: "k", width: stringWidth(overrides.text), gutterWidth: 0, softWrap: "hard", kind: "line",
  charStart: 0, charEnd: overrides.text.length, textStart: 0, ...overrides,
});

describe("columnToChar / charToColumn — grapheme-snapped column addressing", () => {
  it("snaps wide cells (CJK)", () => {
    const row = mkRow({ text: "a你b" });
    expect(columnToChar(row, 1)!.charStart).toBe(0);     // 'a'
    expect(columnToChar(row, 2)!.charStart).toBe(1);     // '你' leading half
    expect(columnToChar(row, 3)!.charStart).toBe(1);     // trailing half snaps back
    expect(columnToChar(row, 4)!.charStart).toBe(2);     // 'b'
  });

  it("respects emoji + combining marks as single clusters", () => {
    // "é" as "e" + combining acute (U+0301) — one grapheme cluster, two UTF-16 code units.
    const combining = mkRow({ text: "éx" });
    const first = columnToChar(combining, 1)!;
    expect(first.charStart).toBe(0);
    expect(first.charEnd).toBe(2);                       // the whole "e"+combining cluster, not just "e"

    // "👍" is a surrogate pair (2 UTF-16 code units) and paints as ONE wide cluster.
    const emoji = mkRow({ text: "👍y" });
    const thumb = columnToChar(emoji, 1)!;
    expect(thumb.charStart).toBe(0);
    expect(thumb.charEnd).toBe(2);
    const y = columnToChar(emoji, 1 + stringWidth("👍"))!;
    expect(y.charStart).toBe(2);
    expect(emoji.text.slice(y.charStart, y.charEnd)).toBe("y");
  });

  it("gutter columns address no char", () => {
    const row = mkRow({ text: "hi", gutterWidth: 3 });
    expect(columnToChar(row, 1)).toBeUndefined();
    expect(columnToChar(row, 3)).toBeUndefined();
    expect(columnToChar(row, 4)!.charStart).toBe(0);      // the first column past the gutter
  });

  it("charToColumn inverts columnToChar's leading edge, gutter included", () => {
    const row = mkRow({ text: "a你b", gutterWidth: 2 });
    expect(charToColumn(row, 0)).toBe(3);                 // 'a', right after the two gutter columns
    expect(charToColumn(row, 1)).toBe(4);                 // '你' leading edge
    expect(charToColumn(row, 2)).toBe(6);                 // 'b', past the CJK char's two cells
  });
});

describe("F10 S4 — sourceEndpointAt: the grapheme's REAL bounds, not a probe at col+1", () => {
  const wide = mkRow({ text: "a你b", charStart: 100, charEnd: 104, textStart: 0 });   // a@1, 你@2-3, b@4
  it("both halves of a CJK cluster answer the SAME half-open source range", () => {
    expect(sourceEndpointAt(wide, 2)).toEqual({ charOffset: 101, charEnd: 102, where: "text" });
    expect(sourceEndpointAt(wide, 3)).toEqual({ charOffset: 101, charEnd: 102, where: "text" });
  });
  it("the cluster's leading cell does NOT swallow the rest of the row", () =>
    expect(sourceEndpointAt(wide, 2).charEnd).not.toBe(wide.charEnd));
  it("an emoji ZWJ sequence is one grapheme", () => {
    const e = mkRow({ text: "x👩‍💻y", charStart: 0, charEnd: "x👩‍💻y".length, textStart: 0 });
    const at = sourceEndpointAt(e, 2);
    expect(at.where).toBe("text");
    expect(e.text.slice(at.charOffset, at.charEnd)).toBe("👩‍💻");
  });
  it("a combining mark rides its base character", () => {
    const c = mkRow({ text: "éf", charStart: 0, charEnd: 3, textStart: 0 });   // e + U+0301, then f
    expect(sourceEndpointAt(c, 1)).toEqual({ charOffset: 0, charEnd: 2, where: "text" });
  });
  it("a gutter column addresses the row's OPENING edge, flagged as such", () =>
    expect(sourceEndpointAt(mkRow({ text: "hi", gutterWidth: 2, charStart: 7, charEnd: 9, textStart: 0 }), 1))
      .toEqual({ charOffset: 7, charEnd: 7, where: "gutter" }));
  it("a column past the last painted cell addresses the CLOSING edge, flagged as such", () =>
    expect(sourceEndpointAt(mkRow({ text: "hi", charStart: 7, charEnd: 9, textStart: 0 }), 40))
      .toEqual({ charOffset: 9, charEnd: 9, where: "eol" }));
  it("a continuation row's cosmetic pad consumes no source offsets", () => {
    const cont = mkRow({ text: "   tail", softWrap: "continuation", charStart: 50, charEnd: 54, textStart: 3 });
    expect(sourceEndpointAt(cont, 4)).toEqual({ charOffset: 50, charEnd: 51, where: "text" });
  });
  it("columnOfSourceChar round-trips a hit to the cluster's LEADING cell", () => {
    for (const col of [1, 2, 4]) expect(columnOfSourceChar(wide, sourceEndpointAt(wide, col).charOffset)).toBe(col);
    expect(columnOfSourceChar(wide, sourceEndpointAt(wide, 3).charOffset)).toBe(2);   // trailing half → leading cell
  });
});
