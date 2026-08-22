// tui/src/wrapItems.ts — THE PROJECTION IN PAINTED ROWS (FSW T17 fix round, Finding 1).
//
// THE THIRD APPEARANCE OF ONE LESSON, so it is written here as the rule rather than as a third patch. T13b
// found a dialog claiming eleven rows and painting nineteen; T14 found the same unit error in the notebook
// arm; this module is the transcript's turn. `renderItemHeight` answers 1 for every `kind: "line"` item, and
// that answer is honest only while the item's text FITS the pane — Ink re-wraps anything wider
// (`wrap-text.js`), so a row a single column too long paints two and is counted as one. On a surface that
// windows a document to a row budget the arithmetic error is not cosmetic: the sticky slice stops short by
// exactly the wrap overflow, the newest rows sit below the frame, the anchor believes it is at the end (so no
// jump pill), and no gesture reaches them. WRAP FIRST, WINDOW SECOND — `streamingItems` (T3) already did this
// for the in-flight turn, `dialogs/rowBudget.paintedRows` for a dialog's body, `species.ts` for a gutter
// block's; this is the same discipline for the finalized document, and the module the other transcript
// surfaces should reach for rather than re-deriving a fourth time.
//
// THE OUTPUT IS THE SAME UNION, one item per physical row, so nothing downstream changes: `pageItemSlices`
// walks it unchanged, `renderItemHeight` becomes TRUE rather than approximate, and `RenderItemView` paints
// each row as the line it already was. A gutter block keeps its identity — one item, a taller BODY — because
// the `⎿` connector is printed once per block and splitting it into rows would print it per row.
//
// THE SEGMENTS COME WITH IT, and they had to. `streamingItems` could afford to drop inline styling on a
// wrapped line — it called that case rare because `LiveTurn` renders markdown at the live width. Measured
// here, it is not rare at all: `renderMarkdown` does NOT wrap prose (a 207-column paragraph comes back as ONE
// line whatever `width` says, because Ink has always done the wrapping at paint time), so on the finalized
// document nearly every assistant paragraph is a wrapped, segmented line. Dropping segments there would trade
// the row count for all of the bold, the inline code and the colour in the transcript. So the segment list is
// re-cut at the same offsets as the text, which is exact for one reason worth stating: `wrapAnsi` with
// `trim: false` is CHARACTER-PRESERVING — the rows concatenate back to the input, verified per call rather
// than assumed, because a style spanning a break makes wrap-ansi insert its own reset/reopen and that
// equality is how this notices. THREE lines fall back to the plain text, and `cutSegments` checks all three:
// one carrying a `preStyled` segment (raw SGR bytes, F3's bold-count rows), where a character offset means
// nothing; one whose `segments` do not concatenate to `text`; and one whose ROWS do not concatenate back to
// `text`, which a line carrying an embedded newline reaches every time (`wrapRows` splits on it and the
// character is gone from the rows) and is the shape measured on real documents; the reset/reopen the same
// comparison also catches needs ANSI in `text`, which the `preStyled` check has already turned away. Their
// ROW COUNT is right either way, which is what the window needs.
//
// THE CACHE IS PER (ITEM, WIDTH), by object identity. Re-projection mints new item objects, so a `WeakMap`
// keyed on the item both hits on every unchanged row of an appended document and lets the whole generation go
// when the projection is replaced. What that buys is bounded, and worth stating honestly: the WRAPPING is
// O(new rows) per append, but the walk over every item and the rebuild of the output array are O(document)
// on any call where something changed — a caller re-projecting the whole document (`TranscriptPager`, whose
// `makeItems` mints fresh items every render) pays that walk each time, and only the wrap itself is saved.
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import type { RenderLine, Segment } from "./render.js";
import { renderItemHeight } from "./pager.js";
import type { RenderItem } from "./toolRenderer.js";

/** Ink's own wrap, verbatim (`wrapAnsi(text, width, { trim: false, hard: true })`, ink/build/wrap-text.js) —
 *  the same call `streamingItems`, `render.wrapRows`, `species.wrapBody` and `rowBudget.paintedRows` make.
 *  `hard` breaks an unbreakable token rather than letting it overflow the width we just promised.
 *
 *  EXPORTED for F9 T-MOUSE Task 4's composer inverse map (`editor.ts`'s `offsetFromPosition` /
 *  `caretFromLocalPosition`): `ChatComposer` paints each buffer line as its own `<Text>{line}</Text>`, relying
 *  on Ink's implicit wrap — no explicit wrap call anywhere in that file — so the click math has nothing of its
 *  own to diverge from EXCEPT this primitive, which is the one every other painted-row producer in this tree
 *  already proves equal to Ink's own algorithm. Reusing the SAME function (not a second `wrapAnsi` call site
 *  with the same arguments typed twice) is what keeps that guarantee transitive. */
export const wrapRows = (text: string, width: number): string[] => text.split("\n").flatMap((line) => wrapAnsi(line, width, { trim: false, hard: true }).split("\n"));

/** One line as the rows it PAINTS at `width`. Returns the input line itself — same object, `segments` and all
 *  — whenever it already fits, which is what keeps a settled frame byte-identical to the unwrapped one.
 *
 *  THE GUTTER IS THE ONLY WIDTH SUBTLETY, and it is `streamingItems`' (T3). `<Line>` paints a line's gutter
 *  (`⏺ ` / `∴ `) as a leading `<Text>` INSIDE the wrapping `<Text>`, so the row it starts is that many columns
 *  narrower — measured with `stringWidth`, because `"⏺ "` is three columns and two characters. The glyph stays
 *  on the FIRST row (a continuation row wearing a second bullet would read as a new message) and the rows
 *  below it are indented under the text, which is what `withAssistantBullet` does to its own continuations. */
export function wrapLine(line: RenderLine, width: number): readonly RenderLine[] {
  const full = Math.max(1, Math.floor(width));
  const gutterWidth = line.gutter ? stringWidth(line.gutter.text) : 0;
  const rows = wrapRows(line.text, Math.max(1, full - gutterWidth));
  if (rows.length === 1 && rows[0] === line.text) return [line];
  const { segments, gutter, continuation: _continuation, ...style } = line;
  const cut = cutSegments(segments, line.text, rows);
  const pad = " ".repeat(gutterWidth);
  // `continuation` (F9 T-MOUSE Task 1, render.ts): row 0 is this line's own hard start — never re-tagged, even
  // when the SOURCE line was itself already a continuation of something wider (the id suffix in `wrapOne`
  // below is what strings a whole wrapped item back together; this flag is per-ROW, not per-item) — every row
  // after it is one this call produced by breaking the text, so it carries the flag the hit map reads.
  return rows.map((text, row) => ({
    ...style,
    text: row === 0 ? text : pad + text,
    ...(row === 0 && gutter ? { gutter } : {}),
    ...(row > 0 ? { continuation: true as const } : {}),
    ...(cut?.[row]?.length ? { segments: row === 0 ? cut[row]! : indentSegments(cut[row]!, pad) } : {}),
  }));
}

/** The segment list re-cut along the wrap's own break offsets, or `undefined` when it cannot be done
 *  faithfully — see the header for the three conditions, each of which is CHECKED rather than assumed. */
function cutSegments(segments: readonly Segment[] | undefined, text: string, rows: readonly string[]): Segment[][] | undefined {
  if (!segments?.length || segments.some((s) => s.preStyled)) return undefined;
  if (segments.map((s) => s.text).join("") !== text || rows.join("") !== text) return undefined;
  const out: Segment[][] = [];
  let index = 0, offset = 0;
  for (const row of rows) {
    const here: Segment[] = [];
    let want = row.length;
    while (want > 0 && index < segments.length) {
      const segment = segments[index]!, take = Math.min(segment.text.length - offset, want);
      if (take > 0) here.push({ ...segment, text: segment.text.slice(offset, offset + take) });
      offset += take; want -= take;
      if (offset >= segment.text.length) { index++; offset = 0; }
    }
    out.push(here);
  }
  return out;
}
/** A continuation row's indent belongs to its FIRST segment, exactly as `render.indentLine` puts it on the
 *  first segment of a whole line — an unstyled leading `<Text>` would be a fourth kind of gutter. */
const indentSegments = (segments: readonly Segment[], pad: string): Segment[] =>
  (pad === "" ? [...segments] : [{ ...segments[0]!, text: pad + segments[0]!.text }, ...segments.slice(1)]);

/** The suffix a wrapped row's id wears. A row is a fragment of an item, not an item, so its id has to stay
 *  unique (React keys) while remaining traceable back to the row it came from — which is what lets
 *  `remapRowOffset` below recognise the same document position across two widths. */
const WRAP_ROW = "#w";
/** The id of the ITEM a wrapped row belongs to. Total: an unwrapped item answers itself. */
export function sourceId(id: string): string {
  const at = id.lastIndexOf(WRAP_ROW);
  return at > 0 && /^\d+$/.test(id.slice(at + WRAP_ROW.length)) ? id.slice(0, at) : id;
}

const cache = new WeakMap<RenderItem, { width: number; rows: readonly RenderItem[] }>();

/** One item as the items it PAINTS at `width` — the identical object when it already fits. */
export function wrapItem(item: RenderItem, width: number): readonly RenderItem[] {
  const hit = cache.get(item);
  if (hit && hit.width === width) return hit.rows;
  const rows = wrapOne(item, width);
  cache.set(item, { width, rows });
  return rows;
}

/** THE HEIGHT A ROW BUDGET MUST USE — the rows `item` PAINTS at `width`, which is what `renderItemHeight`
 *  already answers for everything that fits and understates for everything that does not. The height ALONE,
 *  because a windowing selector walks candidates one at a time and never wants their rows: building and
 *  discarding a wrapped array per candidate would allocate the whole document per frame, where this rides
 *  `wrapItem`'s per-(item, width) cache and costs one map lookup on an unchanged row.
 *
 *  IT ANSWERS FOR THE CLASSIC RENDERER, which is who asks: every call site (ChatApp's `windowItems` and
 *  `paintedRowsOf`, useChat's two commit measures) budgets the MAIN screen, where the item is painted as
 *  itself. The fullscreen surfaces and the pager slice `wrapItemsToWidth`'s output and must keep measuring
 *  THAT — the two layouts are not the same one, and a gutter-carrying LINE is where they part: `wrapLine`
 *  reserves the gutter's columns on every row and indents the continuations (which is what the viewport
 *  paints, since it renders those rows), while `<Line>` prints the gutter as an inline `<Text>` inside the
 *  one wrapping `<Text>`, so Ink flows `gutter + text` at the FULL width with no indent and fits more.
 *  Measured against Ink itself in `test/tui/live-window-painted.test.tsx`. Everything else agrees between
 *  the two: a gutter BLOCK's connector is a sibling Box in the shared `RenderItemView`, a truncating header
 *  is one row by construction, and a plain line has no gutter to place. */
export function paintedHeight(item: RenderItem, width: number): number {
  if (item.kind === "line" && item.wrap !== "truncate-end" && item.line.gutter)
    return wrapRows(item.line.gutter.text + item.line.text, Math.max(1, Math.floor(width))).length;
  let sum = 0;
  for (const row of wrapItem(item, width)) sum += renderItemHeight(row);
  return sum;
}

function wrapOne(item: RenderItem, width: number): readonly RenderItem[] {
  if (item.kind === "gutter-block") {
    // ONE ITEM, A TALLER BODY. The five-column connector column is a sibling Box (`RenderItemView`), so the
    // body wraps at `width − gutter`; splitting the block into one item per row would print the `⎿` on each.
    const inner = Math.max(1, Math.max(1, Math.floor(width)) - item.gutter.length);
    const body = item.body.flatMap((line) => wrapLine(line, inner));
    return body.length === item.body.length && body.every((line, i) => line === item.body[i]) ? [item] : [{ ...item, body }];
  }
  // A truncating header is one row BY CONSTRUCTION (`wrap: "truncate-end"`, upstream's rule for an
  // MCP-length tool name): Ink cuts it at the edge, so there is nothing to wrap and its height was never a lie.
  if (item.wrap === "truncate-end") return [item];
  const rows = wrapLine(item.line, width);
  if (rows.length === 1 && rows[0] === item.line) return [item];
  // SPREAD, DO NOT REBUILD (tool-stream T8). This is the one arm that mints its rows from scratch, and every
  // per-item field that is not `id`/`line` was therefore silently dropped on exactly the items a reader is
  // most likely to be looking at — the over-wide ones. `foldAnchor` is what made that visible: a hit test
  // runs on PAINTED rows, so an untagged wrapped cluster row is a row that cannot be clicked. The other
  // three paths (the gutter-block spread and both identity returns) already carried it.
  return rows.map((line, row) => ({ ...item, id: `${item.id}${WRAP_ROW}${row}`, line }));
}

/** The whole projection in painted rows. Returns the input array itself when nothing wrapped, so a consumer
 *  memoising on identity re-renders nothing for a width that changed only the terminal's mind. */
export function wrapItemsToWidth(items: readonly RenderItem[], width: number): readonly RenderItem[] {
  let changed = false;
  const out: RenderItem[] = [];
  for (const item of items) {
    const rows = wrapItem(item, width);
    if (rows.length !== 1 || rows[0] !== item) changed = true;
    for (const row of rows) out.push(row);
  }
  return changed ? out : items;
}

/** THE SAME DOCUMENT POSITION, MEASURED IN THE NEW PROJECTION'S ROWS (design constraint (a)).
 *
 *  A scroll offset is a row index, and a re-wrap re-numbers every row below the first one that changed
 *  height — so carrying an offset across a width change unchanged silently moves the reader. Sticky anchors
 *  do not care (they re-derive from the tail), but a held one does: this translates it by the position it
 *  NAMES — which source item is at the top of the window, and how far into that item — rather than by the
 *  number it happens to be. Within an item the fraction is preserved, which is what keeps the reader inside
 *  the paragraph they were reading when it grows from three rows to five.
 *  Falls back to the offset it was given when the position cannot be found (an infinite "bottom" sentinel, a
 *  top row past the end, an item the new projection no longer has); the anchor's clamp answers those. */
export function remapRowOffset(from: readonly RenderItem[], to: readonly RenderItem[], offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return offset;
  let cursor = 0, i = 0;
  for (; i < from.length; i++) { const h = renderItemHeight(from[i]!); if (cursor + h > offset) break; cursor += h; }
  if (i >= from.length) return offset;
  const id = sourceId(from[i]!.id);
  // How far INTO the source item the window's top row sits, and how tall that item was — both summed over
  // the run of rows sharing the id, since one item can be several rows here.
  let inner = offset - cursor, oldHeight = renderItemHeight(from[i]!);
  for (let j = i - 1; j >= 0 && sourceId(from[j]!.id) === id; j--) { const h = renderItemHeight(from[j]!); inner += h; oldHeight += h; }
  for (let j = i + 1; j < from.length && sourceId(from[j]!.id) === id; j++) oldHeight += renderItemHeight(from[j]!);
  let out = 0, k = 0;
  for (; k < to.length; k++) { if (sourceId(to[k]!.id) === id) break; out += renderItemHeight(to[k]!); }
  if (k >= to.length) return offset;
  let newHeight = 0;
  for (let j = k; j < to.length && sourceId(to[j]!.id) === id; j++) newHeight += renderItemHeight(to[j]!);
  return out + Math.max(0, Math.min(newHeight - 1, Math.floor((inner * newHeight) / Math.max(1, oldHeight))));
}
