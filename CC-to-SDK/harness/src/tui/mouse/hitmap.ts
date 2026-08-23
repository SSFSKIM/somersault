// tui/src/mouse/hitmap.ts — F9 T-MOUSE Task 1: the widened hit-map substrate every later mouse feature
// (hover, click-to-caret, drag selection) queries. `FullscreenViewport.hitRowsOf` (tool-stream Task 9)
// published one entry per painted row — `{anchor, width}` — enough to turn a tap into a fold toggle and
// nothing else. R1 §3 found the three remaining features share ONE missing substrate: ccx has no addressable
// layout tree (canon's `cachedLayout` plus a cell-addressed screen buffer), so every one of them has to be
// answered as a QUERY against the rows already painted rather than a walk over a tree that does not exist.
// This module is that query surface: the widened `HitRow` (plain text, gutter, soft-wrap class, identity,
// link spans) plus the two functions that turn a terminal column into — and back out of — a grapheme index,
// canon's own wide-cell backstep (R1 §2.2's `n = col - 1` machinery, minus the tree). Kept a leaf module
// (pager.js's `RenderItemSlice`, render.js's `RenderLine`, string-width and the shared grapheme snapper are
// its only imports) so `FullscreenViewport.tsx`, which builds the array, stays a thin caller of it.
import stringWidth from "string-width";
import { snapToGraphemes } from "../graphemes.js";
import type { RenderLine } from "../render.js";

/** One PAINTED row's full clickable identity — the widening this task exists to build. `itemKey` and `anchor`
 *  answer "which source item, and which fold cluster if any"; `text`/`gutterWidth` answer "what is here and
 *  where does it start"; `softWrap` answers "is this row a fresh logical line or the tail of one"; `kind`
 *  mirrors the `RenderItem` union it came from. `anchor`/`linkRanges` are absent — never present-but-empty —
 *  for the "no data" case a consumer branches on, exactly as `RenderItem.foldAnchor` already does.
 *
 *  `itemKey` MUST be the source item's own durable id (message uuid + block ordinal, or the tool event id a
 *  fold group anchors on — see `toolRenderer.tsx`'s `sdkItemId`/`localItemId`/event-id producers), never a
 *  position in the painted array or the slice list: a slice/publish INDEX shifts the moment an earlier item
 *  streams in above it, which would silently repoint every later row's identity at the wrong source item on
 *  the very next frame. `wrapItems.ts`'s `sourceId` is how a caller recovers it from a (possibly wrap-
 *  fragmented) `RenderItem.id` — every fragment of one wrapped item resolves to the SAME `sourceId`, which is
 *  what makes "all wrap fragments of one item share one key" true by construction rather than by convention. */
export interface HitRow {
  itemKey: string;
  anchor?: string;
  width: number;
  text: string;
  gutterWidth: number;
  softWrap: "hard" | "continuation";
  kind: "line" | "gutter-block";
  linkRanges?: readonly { start: number; end: number; href: string }[];
  /** F10 S4 — the half-open SOURCE-character range this painted row covers within its item's CANONICAL
   *  text: the pre-wrap, pre-cosmetic-indent text, with a `\n` separator between the hard rows of a
   *  multi-row (gutter-block) item. Minted by `wrapItems` where it wraps (it knows the split points before
   *  it adds padding) and carried through slices unchanged, so a partially-visible item's rows still name
   *  true source positions. NEVER derived by summing painted `text` lengths.
   *    REQUIRED, not optional (spec v4.1 Wave assembly): an optional field would let a constructor that
   *  forgot it typecheck and then address the wrong characters at runtime, which is the whole failure this
   *  substrate exists to prevent. Every constructor is inventoried in step 4.7. */
  charStart: number;
  charEnd: number;
  /** The painted-character index at which this row's source range begins — 0 for a hard row, the cosmetic
   *  continuation indent's length for a wrapped row that carries one. The offset `sourceEndpointAt`
   *  corrects by; without it a continuation row's pad is indistinguishable from real leading spaces. */
  textStart: number;
}

/** F10 S4 — a painted COLUMN resolved to the SOURCE range it names. `where` separates the three outcomes
 *  `columnToChar` returns one `undefined` for, because an endpoint has to treat them differently: a gutter
 *  column addresses the row's opening edge, a column past the last painted cell addresses its closing edge,
 *  and a hit addresses one grapheme. Built on the REAL `charEnd` `columnToChar` returns — probing `col + 1`
 *  cannot see past a double-width cluster's leading cell. */
export interface SourceEndpoint { charOffset: number; charEnd: number; where: "gutter" | "text" | "eol" }

/** A terminal column resolved to the grapheme cluster it lands on, snapped exactly as `snapToGraphemes` snaps
 *  a highlight range: `charStart`/`charEnd` are the half-open `[start, end)` character bounds of that ONE
 *  cluster in `row.text`, never a sub-cluster offset. `row` is left at `0` here and exists for a FUTURE caller
 *  walking several `HitRow`s at once (a drag spans rows, task 5) to stamp with the row's own screen position —
 *  a single `HitRow` has no idea which physical row it is, only `FullscreenViewport`'s array index does. */
export interface CellAddress { row: number; charStart: number; charEnd: number }

/** `row.text` as the grapheme clusters it paints, each still to be measured for its own cell width (1 for
 *  almost everything, 2 for CJK/most emoji) by the caller — built by widening EVERY codepoint's own
 *  `[i, i+1)` range with the shared snapper (`snapToGraphemes`), the same function `matchRanges` calls for a
 *  highlight span, one codepoint at a time.
 *    ONE AT A TIME, AND THAT IS NOT INCIDENTAL. `snapToGraphemes` merges two ranges in the SAME call when the
 *  widened first one reaches the second's start (`s <= last[1]`) — built for a caller handing it a few sparse
 *  match spans, where "widening made them touch" is real signal. Every codepoint range in a string is
 *  ADJACENT to its neighbour by construction (index `i`'s range ends exactly where `i+1`'s begins), so one
 *  bulk call over the whole codepoint list trips that merge on EVERY pair regardless of whether they are
 *  actually the same cluster — measured: it silently swallows `"你"` into `"a"`'s range in `"a你b"`, because
 *  `[0,1]` widened touches `[1,2]`'s start whether or not U+4F60 is a combining mark. Calling the snapper once
 *  per codepoint sidesteps the merge state entirely (nothing to merge WITH inside a one-range call) and a
 *  cluster is instead recognised by two consecutive codepoints snapping to the SAME start — which is what a
 *  combining mark or a ZWJ sequence actually does.
 *    THE COST is one `Intl.Segmenter` pass per NON-ASCII codepoint rather than one for the whole row — real,
 *  and accepted rather than hidden: `NON_LATIN1` (inside the snapper) still short-circuits every ASCII
 *  codepoint back to its own `[i, i+1)` range with no segmenter at all, so a plain-text row (the common one)
 *  stays the O(n) walk it always was. A CJK/emoji-heavy row pays O(n²) in the worst case, and that is fine
 *  here: unlike `wrapItems`' per-frame wrap, this runs once per discrete mouse gesture (a click, a hover
 *  tick), never per render, against a row bounded by the terminal's own width. */
function clustersOf(text: string): Array<[number, number]> {
  const clusters: Array<[number, number]> = [];
  let i = 0;
  for (const ch of text) {
    const [start, end] = snapToGraphemes(text, [[i, i + ch.length]])[0]!;
    if (clusters.length === 0 || clusters[clusters.length - 1]![0] !== start) clusters.push([start, end]);
    i += ch.length;
  }
  return clusters;
}

/** Map a 1-based terminal column to grapheme bounds in `row.text` — accounting for `gutterWidth` (a column at
 *  or before it addresses no character, canon drops a blank/gutter-cell click the same way `anchorAt` already
 *  does for the row as a whole) and double-width cells: a column on the TRAILING half of a wide cluster snaps
 *  back to that same cluster's bounds — canon's backstep (R1 §2.2's `n = col - 1` plus the double-width
 *  step-back `_0p` performs during word-select, L198606). `undefined` past the row's last painted cluster —
 *  a click beyond the text is a click on nothing, exactly as `anchorAt`'s own width bound already treats it. */
export function columnToChar(row: HitRow, col: number): CellAddress | undefined {
  if (col <= row.gutterWidth) return undefined;
  let cursor = row.gutterWidth + 1;
  for (const [start, end] of clustersOf(row.text)) {
    const width = Math.max(1, stringWidth(row.text.slice(start, end)));
    if (col >= cursor && col < cursor + width) return { row: 0, charStart: start, charEnd: end };
    cursor += width;
  }
  return undefined;
}

/** The inverse of `columnToChar`: the 1-based terminal column where the grapheme cluster CONTAINING
 *  `charIndex` starts painting — the cluster's leading cell, so a caret placed at either half of a wide
 *  character lands on the same column a click there would resolve to. `charIndex` at or past `row.text`'s
 *  length answers the column immediately after the last painted cell (the row's own end-of-line caret). */
export function charToColumn(row: HitRow, charIndex: number): number {
  let cursor = row.gutterWidth + 1;
  for (const [start, end] of clustersOf(row.text)) {
    const width = Math.max(1, stringWidth(row.text.slice(start, end)));
    if (charIndex >= start && charIndex < end) return cursor;
    cursor += width;
  }
  return cursor;
}

/** A painted COLUMN → the SOURCE range it names. The row's own `textStart` is what makes this correct on a
 *  continuation row: `HitRow.text` there begins with `wrapLine`'s cosmetic indent, which is not source text
 *  and must not consume offsets.
 *    IT USES `columnToChar`'s OWN `charEnd`. The obvious alternative — take the start here and probe
 *  `col + 1` for the end — is wrong on every double-width grapheme: the trailing cell of a CJK or emoji
 *  cluster resolves back to the SAME cluster (`columnToChar`'s deliberate backstep), so the probe reports no
 *  progress and any "then it must run to the row's end" fallback selects the whole remainder of the row.
 *  `where` exists for the same reason: `columnToChar` answers `undefined` for a gutter column AND for a
 *  column past the text, and an endpoint has to place those at opposite edges of the row. */
export function sourceEndpointAt(row: HitRow, col: number): SourceEndpoint {
  const toSource = (painted: number): number =>
    Math.min(row.charEnd, Math.max(row.charStart, row.charStart + Math.max(0, painted - row.textStart)));
  const hit = columnToChar(row, col);
  if (hit) {
    const start = toSource(hit.charStart);
    return { charOffset: start, charEnd: Math.max(start, toSource(hit.charEnd)), where: "text" };
  }
  if (col <= row.gutterWidth) return { charOffset: row.charStart, charEnd: row.charStart, where: "gutter" };
  return { charOffset: row.charEnd, charEnd: row.charEnd, where: "eol" };
}
/** …and back. `charToColumn` answers the column immediately after the last painted cell for an index at or
 *  past the row's text, which is exactly the end-of-row caret an upper endpoint at `charEnd` wants. */
export function columnOfSourceChar(row: HitRow, v: number): number {
  return charToColumn(row, row.textStart + Math.max(0, Math.min(row.charEnd, v) - row.charStart));
}

/** T-PRLINK's `linkRanges` (`toolFold.ts`'s `FoldClause.linkRanges`), recovered at the ROW rather than parsed
 *  a second time from scratch: `sgrFoldRow.ts`'s `composeFoldRun` already writes each linked span as an
 *  unbroken `OSC8-open label OSC8-close` substring (a hard guarantee its own header states, so the label
 *  between the two never carries an interleaved SGR code), and `groupRowLine` already carries that raw byte
 *  string as a `preStyled` segment beside the line's plain ones. So the "existing channel" this task's brief
 *  points at IS the segment list: nothing here re-derives an href, it just walks `line.segments` in order,
 *  adding each segment's own SGR-stripped length to a running plain-text offset — matching exactly how
 *  `toolRenderer.tsx` builds `RenderLine.text` itself (`segments.map(stripSgr-if-preStyled).join("")`) — and
 *  opens/closes a link span at the OSC-8 tokens it crosses along the way. `undefined` when the line carries no
 *  segments at all (the ordinary un-styled case) or none of them link anything — never an allocated `[]`, so a
 *  consumer can tell "no link data" from "walked and found nothing" without inspecting length either way. */
export function linkRangesOf(line: RenderLine): readonly { start: number; end: number; href: string }[] | undefined {
  if (!line.segments?.length) return undefined;
  const out: { start: number; end: number; href: string }[] = [];
  let pos = 0;
  for (const segment of line.segments) pos = segment.preStyled === true ? scanLinks(segment.text, pos, out) : pos + segment.text.length;
  return out.length ? out : undefined;
}

/** One OSC-8 open (non-empty capture) or close (empty capture) token, or an SGR `CSI…m` code that carries no
 *  plain text of its own — the same two-shape alternation `sgrFoldRow.ts`'s `SGR_OR_OSC8` strips, widened with
 *  a capture group so THIS walk can tell which kind of token it just crossed instead of only removing it.
 *  Re-declared here rather than imported: that module's copy has no capture group (it only ever strips), and
 *  giving it one for a single other caller would change what every one of its own covering tests pins. */
const OSC8_OR_SGR = /\x1b\[[0-9;]*m|\x1b\]8;;([^\x07]*)\x07/g;
/** Walks one `preStyled` segment's raw bytes, emitting a link span (in the ROW's plain-text coordinates,
 *  `pos`-based, not the segment's own) for every OSC-8 open/close pair it crosses, and returns `pos` advanced
 *  by the segment's own SGR-stripped length — the running offset `linkRangesOf` threads across the whole
 *  segment list. An open with no matching close (should not happen — `composeFoldRun` always balances its own
 *  pairs) is simply dropped; a close with no open pending is ignored the same way. */
function scanLinks(raw: string, startPos: number, out: { start: number; end: number; href: string }[]): number {
  let pos = startPos, cursor = 0, openHref: string | undefined, openPos = 0;
  OSC8_OR_SGR.lastIndex = 0;
  for (let match = OSC8_OR_SGR.exec(raw); match !== null; match = OSC8_OR_SGR.exec(raw)) {
    pos += match.index - cursor;               // the plain text just before this token
    cursor = OSC8_OR_SGR.lastIndex;
    if (match[1] === undefined) continue;       // an SGR `CSI…m` code — no plain text, nothing to open/close
    if (match[1] !== "") { openHref = match[1]; openPos = pos; }
    else if (openHref !== undefined) { out.push({ start: openPos, end: pos, href: openHref }); openHref = undefined; }
  }
  return pos + (raw.length - cursor);           // the segment's own trailing plain text, if any
}
