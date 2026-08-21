// tui/test/selection.test.ts — F9 T-MOUSE Task 5: pure selection geometry + extraction. Every case below
// builds `HitRow` fixtures directly (this module's whole point is to be a leaf that never touches React,
// paint, or the wrap engine) EXCEPT the linkRanges case, which — per the brief — runs the fixture through the
// REAL fold publish path (`TranscriptDocument` → `projectCompact` → `wrapItemsToWidth` → `pageItemSlices` →
// `hitRowsOf`), the same pipeline `test/tui/hitmap.test.ts` uses to prove `linkRanges` reaches a `HitRow` at
// all — this file trusts that plumbing and starts from its output rather than re-proving it.
import { describe, it, expect } from "vitest";
import stringWidth from "string-width";
import {
  createSelectionState,
  startSelection,
  dragTo,
  multiClick,
  hasSelection,
  selectedSpans,
  type SelectionState,
} from "../../src/tui/mouse/selection.js";
import { extractText } from "../../src/tui/mouse/extract.js";
import { charToColumn, type HitRow } from "../../src/tui/mouse/hitmap.js";
import { wrapItemsToWidth } from "../../src/tui/wrapItems.js";
import { pageItemSlices } from "../../src/tui/pager.js";
import { hitRowsOf } from "../../src/tui/FullscreenViewport.js";
import { projectCompact, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

// `width` mirrors production's own formula (`FullscreenViewport.hitRowOfLine`): the gutter's columns PLUS the
// text's painted width, never just the text — a gutter-bearing row whose fixture used bare `stringWidth(text)`
// would silently truncate every full-row span computed against it.
const mkRow = (overrides: Partial<HitRow> & Pick<HitRow, "text">): HitRow => {
  const gutterWidth = overrides.gutterWidth ?? 0;
  return { itemKey: "k", width: gutterWidth + stringWidth(overrides.text), gutterWidth, softWrap: "hard", kind: "line", ...overrides };
};

/** A `\uD800`-`\uDFFF` code unit not paired with its other half — the exact defect a naive `.slice()` on
 *  UTF-16 offsets (rather than the grapheme-cluster offsets `columnToChar` resolves) would produce by cutting
 *  a surrogate pair (e.g. an emoji) in half. */
const hasLoneSurrogate = (s: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);

describe("click vs sweep discrimination", () => {
  it("a plain click (drag to the same cell) never records a selection", () => {
    const s = createSelectionState();
    startSelection(s, { row: 1, col: 5 });
    dragTo(s, { row: 1, col: 5 });
    expect(hasSelection(s)).toBe(false);
    expect(s.focus).toBeNull();
  });

  it("a real sweep (drag to a different cell) records one", () => {
    const s = createSelectionState();
    startSelection(s, { row: 1, col: 5 });
    dragTo(s, { row: 1, col: 9 });
    expect(hasSelection(s)).toBe(true);
  });

  it("dragging away and back to the anchor un-records the selection", () => {
    const s = createSelectionState();
    startSelection(s, { row: 1, col: 5 });
    dragTo(s, { row: 1, col: 9 });
    expect(hasSelection(s)).toBe(true);
    dragTo(s, { row: 1, col: 5 }); // back to anchor
    expect(hasSelection(s)).toBe(false);
  });

  it("a fresh press resets a stale anchorSpan from a prior multi-click", () => {
    const s = createSelectionState();
    const row = mkRow({ text: "hello world" });
    multiClick(s, { row: 1, col: 2 }, 2, row);
    expect(hasSelection(s)).toBe(true);
    startSelection(s, { row: 1, col: 1 });
    expect(s.anchorSpan).toBeNull();
    expect(hasSelection(s)).toBe(false);
  });
});

describe("selectedSpans — span math across three rows", () => {
  it("partial first row, full middle row, partial last row", () => {
    const rows: HitRow[] = [
      mkRow({ text: "x".repeat(20) }),
      mkRow({ text: "y".repeat(20) }),
      mkRow({ text: "z".repeat(20) }),
    ];
    const s = createSelectionState();
    startSelection(s, { row: 1, col: 5 });
    dragTo(s, { row: 3, col: 10 });
    const spans = selectedSpans(s, rows);
    expect(spans).toEqual([
      { row: 1, colStart: 5, colEnd: 21 },  // partial: from col 5 to the row's own end
      { row: 2, colStart: 1, colEnd: 21 },  // full width, untouched by either endpoint
      { row: 3, colStart: 1, colEnd: 11 },  // partial: from the row's own start THROUGH col 10 (exclusive end)
    ]);
  });

  it("a reversed drag (focus above anchor) orders lo/hi the same way", () => {
    const rows: HitRow[] = [mkRow({ text: "x".repeat(20) }), mkRow({ text: "y".repeat(20) })];
    const s = createSelectionState();
    startSelection(s, { row: 2, col: 10 });
    dragTo(s, { row: 1, col: 5 });
    expect(selectedSpans(s, rows)).toEqual([
      { row: 1, colStart: 5, colEnd: 21 },
      { row: 2, colStart: 1, colEnd: 11 },
    ]);
  });

  it("no anchor/focus/anchorSpan yields no spans", () => {
    expect(selectedSpans(createSelectionState(), [mkRow({ text: "abc" })])).toEqual([]);
  });
});

describe("extractText — soft-wrap-aware join", () => {
  it("a continuation row joins its predecessor with no separator", () => {
    const rows: HitRow[] = [mkRow({ text: "hello ", softWrap: "hard" }), mkRow({ text: "world", softWrap: "continuation" })];
    const spans = [
      { row: 1, colStart: 1, colEnd: 7 },
      { row: 2, colStart: 1, colEnd: 6 },
    ];
    expect(extractText(spans, rows)).toBe("hello world");
  });

  it("a hard row joins with a newline", () => {
    const rows: HitRow[] = [mkRow({ text: "line one", softWrap: "hard" }), mkRow({ text: "line two", softWrap: "hard" })];
    const spans = [
      { row: 1, colStart: 1, colEnd: 9 },
      { row: 2, colStart: 1, colEnd: 9 },
    ];
    expect(extractText(spans, rows)).toBe("line one\nline two");
  });

  it("the FIRST span never gets a leading separator, whatever its own softWrap says", () => {
    const rows: HitRow[] = [mkRow({ text: "tail", softWrap: "continuation" })];
    expect(extractText([{ row: 1, colStart: 1, colEnd: 5 }], rows)).toBe("tail");
  });
});

describe("grapheme-safe extraction — CJK and emoji never split", () => {
  it("a drag ending on a CJK char's trailing half selects the WHOLE character", () => {
    const rows: HitRow[] = [mkRow({ text: "a你b" })]; // a@1, 你@2-3 (wide), b@4
    const s = createSelectionState();
    startSelection(s, { row: 1, col: 2 });        // leading half of 你
    dragTo(s, { row: 1, col: 3 });                // trailing half of 你 — same cluster, must not split
    const spans = selectedSpans(s, rows);
    expect(spans).toEqual([{ row: 1, colStart: 2, colEnd: 4 }]);
    const text = extractText(spans, rows);
    expect(text).toBe("你");
    expect(hasLoneSurrogate(text)).toBe(false);
  });

  it("a drag ending mid-emoji selects the whole surrogate pair, never a lone half", () => {
    const rows: HitRow[] = [mkRow({ text: "x👍y" })]; // x@1, 👍@2-3 (wide), y@4
    const s = createSelectionState();
    startSelection(s, { row: 1, col: 1 });
    dragTo(s, { row: 1, col: 3 });                // trailing half of the thumb
    const text = extractText(selectedSpans(s, rows), rows);
    expect(text).toBe("x👍");
    expect(hasLoneSurrogate(text)).toBe(false);
  });
});

describe("multiClick — word select", () => {
  it("foo_bar/baz selects as ONE word under the char class, and stops at the space", () => {
    const row = mkRow({ text: "foo_bar/baz other" });
    const s = createSelectionState();
    multiClick(s, { row: 1, col: 5 }, 2, row); // col 5 lands inside "foo_bar/baz" ('b' of bar)
    const spans = selectedSpans(s, [row]);
    const text = extractText(spans, [row]);
    expect(text).toBe("foo_bar/baz");
  });

  it("a click on the leading char of the token still selects the whole token", () => {
    const row = mkRow({ text: "foo_bar/baz other" });
    const s = createSelectionState();
    multiClick(s, { row: 1, col: 1 }, 2, row); // the very first 'f'
    expect(extractText(selectedSpans(s, [row]), [row])).toBe("foo_bar/baz");
  });
});

describe("multiClick — link-aware word select (real fold publish path)", () => {
  const publish = (items: readonly RenderItem[], columns: number): readonly HitRow[] => {
    const wrapped = wrapItemsToWidth(items, columns);
    const { slices } = pageItemSlices(wrapped, 0, 200);
    return hitRowsOf(slices, columns);
  };

  it("a double-click anywhere inside the link's text selects the WHOLE link, not just a char-class run", () => {
    // The same fixture `hitmap.test.ts` pins for `linkRanges` itself: a real `gh pr create` Bash call folded
    // into one collapsed-cluster row whose clause run links `#12`. The link text is "#12" — "#" does NOT
    // match the word char class, so a plain char-class walk starting on "1" would stop AT "#", selecting only
    // "12". Proving the whole "#12" comes back is proof the linkRanges branch actually fired.
    const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
      ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
    const result = (id: string, content = "body") =>
      ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } }) as Record<string, unknown>;
    const prose = (text: string, id: string) => ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
    const doc = new TranscriptDocument();
    doc.appendSdk("host", call("bash-1", "Bash", { command: "gh pr create --fill" }));
    doc.appendSdk("host", result("bash-1", "https://github.com/o/r/pull/12\n"));
    doc.appendSdk("host", prose("done", "t-done")); // breaker — closes the fold run so it publishes
    const FS = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0, fullscreen: true, expandHint: "" };
    const items = projectCompact(doc, FS);
    const clauseItem = items.find((i) => i.id.startsWith("group:"));
    expect(clauseItem).toBeDefined();

    const rows = publish([clauseItem!], 100);
    const row = rows.find((r) => r.linkRanges !== undefined);
    expect(row).toBeDefined();
    const [link] = row!.linkRanges!;
    expect(row!.text.slice(link!.start, link!.end)).toBe("#12");

    const rowIndex = rows.indexOf(row!) + 1; // 1-based, matching Cell.row's convention
    // Click on the "1" inside "#12" — one codepoint INTO the link, away from the leading "#". Resolved to a
    // terminal column the same way the gesture layer would: `charToColumn`, T1's own inverse of the column
    // map `selectedSpans`/`multiClick` themselves use — never a hand-rolled width walk.
    const clickChar = link!.start + 1;
    const clickCol = charToColumn(row!, clickChar);

    const s = createSelectionState();
    multiClick(s, { row: rowIndex, col: clickCol }, 2, row!);
    const spans = selectedSpans(s, rows);
    const text = extractText(spans, rows);
    expect(text).toBe("#12");
  });
});

describe("multiClick — triple-click selects the full logical line across both wrap rows", () => {
  it("clicking the hard row selects both it and its continuation", () => {
    const rows: HitRow[] = [
      mkRow({ text: "this line wraps ", softWrap: "hard" }),
      mkRow({ text: "onto a second row", softWrap: "continuation" }),
    ];
    const s = createSelectionState();
    multiClick(s, { row: 1, col: 3 }, 3, rows[0]!);
    const spans = selectedSpans(s, rows);
    expect(spans).toEqual([
      { row: 1, colStart: 1, colEnd: rows[0]!.width + 1 },
      { row: 2, colStart: 1, colEnd: rows[1]!.width + 1 },
    ]);
    expect(extractText(spans, rows)).toBe("this line wraps onto a second row");
  });

  it("clicking the continuation row itself still resolves the same full-line group", () => {
    const rows: HitRow[] = [
      mkRow({ text: "this line wraps ", softWrap: "hard" }),
      mkRow({ text: "onto a second row", softWrap: "continuation" }),
    ];
    const s = createSelectionState();
    multiClick(s, { row: 2, col: 4 }, 3, rows[1]!);
    const spans = selectedSpans(s, rows);
    expect(extractText(spans, rows)).toBe("this line wraps onto a second row");
  });

  it("a hard row with no adjacent continuation selects only itself", () => {
    const rows: HitRow[] = [mkRow({ text: "solo line", softWrap: "hard" }), mkRow({ text: "next line", softWrap: "hard" })];
    const s = createSelectionState();
    multiClick(s, { row: 1, col: 2 }, 3, rows[0]!);
    expect(extractText(selectedSpans(s, rows), rows)).toBe("solo line");
  });
});

describe("gutter exclusion", () => {
  it("a drag starting inside the gutter clamps to the first real column, never extracting gutter chars", () => {
    const row = mkRow({ text: "read the file", gutterWidth: 5, kind: "gutter-block" });
    const s = createSelectionState();
    startSelection(s, { row: 1, col: 1 });  // inside the 5-column gutter
    dragTo(s, { row: 1, col: 13 });         // through "read the" (gutter cols 1-5, text starts col 6)
    const spans = selectedSpans(s, [row]);
    expect(spans[0]!.colStart).toBe(row.gutterWidth + 1);
    expect(extractText(spans, [row])).toBe("read the");
  });

  it("a full-row (line) selection on a gutter row never includes the gutter's columns", () => {
    const row = mkRow({ text: "body only", gutterWidth: 5, kind: "gutter-block" });
    const s: SelectionState = createSelectionState();
    multiClick(s, { row: 1, col: 8 }, 3, row);
    const spans = selectedSpans(s, [row]);
    expect(spans).toEqual([{ row: 1, colStart: 6, colEnd: row.width + 1 }]);
    expect(extractText(spans, [row])).toBe("body only");
  });
});
