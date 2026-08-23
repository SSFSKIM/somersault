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
import { columnToChar, charToColumn, type HitRow } from "../../src/tui/mouse/hitmap.js";
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

// ── F10 T-HOVER H1: HitRow.ownerKey — the hover unit, through the real publish path ─────────────────────
describe("hitRowsOf publishes HitRow.ownerKey — message-level, not per-row", () => {
  const proseFS = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 80, now: 0 };
  const proseDoc = (text: string, id: string): readonly RenderItem[] => {
    const d = new TranscriptDocument();
    d.appendSdk("host", { type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } });
    return projectCompact(d, proseFS);
  };

  it("every painted row of one multi-line message carries that message's ownerKey, and its own itemKey", () => {
    const rows = publish(proseDoc("alpha\nbeta\ngamma", "m1"), 80);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((r) => r.ownerKey)).size).toBe(1);
    expect(new Set(rows.map((r) => r.itemKey)).size).toBe(rows.length);   // itemKey stays per-item
  });

  it("a wrap fragment keeps both keys of the row it came from", () => {
    const rows = publish(proseDoc("x".repeat(100), "m2"), 20);           // narrow width forces wrapping
    expect(rows.length).toBeGreaterThan(1);                              // premise: it really wrapped
    expect(new Set(rows.map((r) => r.ownerKey)).size).toBe(1);
    expect(new Set(rows.map((r) => r.itemKey)).size).toBe(1);            // one source item, one itemKey
  });
});

const mkRow = (overrides: Partial<HitRow> & Pick<HitRow, "text">): HitRow => ({
  itemKey: "k", ownerKey: "o", width: stringWidth(overrides.text), gutterWidth: 0, softWrap: "hard", kind: "line", ...overrides,
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
