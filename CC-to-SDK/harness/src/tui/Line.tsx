// tui/src/Line.tsx — the ONE `RenderLine` → `<Text>` view. Extracted out of Transcript.tsx by F1 Task 4:
// Transcript now renders THROUGH the shared tool renderer (toolRenderer.tsx), and that module already owns
// the gutter view — so leaving `Line` in Transcript.tsx would make the two import each other.
import React, { useContext } from "react";
import { Text } from "ink";
import type { RenderLine, Segment } from "./render.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { HoverContext } from "./mouse/hoverContext.js";
import { stripSgr } from "./sgrFoldRow.js";

/** The final safety boundary (F1 Task 2): a RenderLine can be preformatted anywhere — render.ts, liveTurn,
 *  bash, useChat, a replayed transcript on disk — so its colors may still be in §2.2's TH2 grammar
 *  (`rgb()`/`ansi256()`/`ansi:<name>`), which Ink does not accept. Resolving here means no producer can
 *  leak an unrenderable color into the terminal. resolveThemeColor is idempotent on hex and bare names,
 *  so producers that already resolved (all of ours do) are unaffected. */
const ink = (color?: string) => (color === undefined ? undefined : resolveThemeColor(color));

// F9 T-MOUSE Task 3 — the two hover-brighten halves (spec M3, canon §2.3), both applied ONLY when
// `HoverContext` reads `true` for this row:
//   (a) DIM IS DROPPED, not recolored — canon's own `QmS` (L203979) does the same: `dimColor && !hovered`
//       reads straight through to the undimmed color when hovered, it does not pick a brighter color.
//   (b) THE BAND SWAPS, not every background — canon's pair is keyed to ONE specific token
//       (`userMessageBackground` ⇄ `userMessageBackgroundHover`, L562653/562668/562779 etc.), so a diff
//       row's red/green band or a rule's dim title band must NOT light up just because its row is hovered.
//       Comparing the RESOLVED colors (both sides go through `resolveThemeColor`) is what makes this an
//       identity check on the TOKEN rather than a guess at which raw hex a producer happened to pass.
const hoverBand = (bg: string | undefined, hovered: boolean): string | undefined => {
  if (!hovered || bg === undefined) return bg;
  return bg === resolveThemeColor(themeTokens().userMessageBackground) ? resolveThemeColor(themeTokens().userMessageBackgroundHover) : bg;
};
// A `preStyled` segment's dim is BAKED INTO ITS BYTES (F3 Task 1's exact-bytes contract — it renders through
// a bare `<Text>` with no style props at all, so there is no `dimColor` to flip). Un-dimming it hovered is
// therefore a literal `\x1b[2m` strip rather than a re-style — the brief's own phrasing for this row shape.
const DIM_SGR = /\x1b\[2m/g;
const unDimRaw = (raw: string, hovered: boolean): string => (hovered ? raw.replace(DIM_SGR, "") : raw);

// ── F9 T-MOUSE Task 6 — SELECTION PAINT ─────────────────────────────────────────────────────────────────
// `FullscreenViewport` resolves a mouse `RowSpan` (terminal columns) through T1's `columnToChar`/T5's
// `charRangeOf` against the exact `HitRow` it built THIS row from, and hands the result down as a CHARACTER
// range in `RenderLine.text`'s own coordinates — never terminal columns, never a preStyled segment's raw
// byte offset, so this file does no grapheme math of its own, only plain-string slicing.
/** Half-open `[charStart, charEnd)` into `RenderLine.text` — `undefined` for "this row carries no
 *  selection", matching every other optional-prop convention in this file (`l.bg`, `l.color`, …). */
export interface LineSelection { charStart: number; charEnd: number }

const selectionBg = (): string => resolveThemeColor(themeTokens().selectionBg);

/** One printable run, tagged with whether it falls inside the selection — the unit both the segmented and
 *  the plain-text render paths split into. With no selection (or no overlap), this returns the run
 *  UNCHANGED as a single `selected: false` piece — the identity case that keeps every existing row's output
 *  byte-for-byte what it was before this task. */
interface Piece { text: string; selected: boolean }
function splitBySelection(text: string, runStart: number, sel: LineSelection | undefined): Piece[] {
  if (!sel || sel.charEnd <= sel.charStart || text.length === 0) return [{ text, selected: false }];
  const runEnd = runStart + text.length;
  const lo = Math.max(sel.charStart, runStart), hi = Math.min(sel.charEnd, runEnd);
  if (lo >= hi) return [{ text, selected: false }];
  const pieces: Piece[] = [];
  if (lo > runStart) pieces.push({ text: text.slice(0, lo - runStart), selected: false });
  pieces.push({ text: text.slice(lo - runStart, hi - runStart), selected: true });
  if (hi < runEnd) pieces.push({ text: text.slice(hi - runStart), selected: false });
  return pieces;
}
/** A selected piece's background always wins over the hover band — dragging a selection across an
 *  already-hovered row is the one case both can be live at once, and the selection is the more specific,
 *  more transient state (Task 7's own auto-copy latch reads selection as the "something is happening"
 *  signal, never hover). */
const pieceBg = (bg: string | undefined, hovered: boolean, selected: boolean): string | undefined =>
  selected ? selectionBg() : hoverBand(bg, hovered);

/** `\x1b[48;2;r;g;bm` … `\x1b[49m` wrapped around a `preStyled` segment's RAW bytes — the one shape this file
 *  cannot reach with an ordinary `backgroundColor` prop, because a preStyled segment is a bare `<Text>`
 *  around bytes Ink is told not to touch (F3 Task 1's exact-bytes contract). Wrapping OUTSIDE those bytes is
 *  safe regardless of what is inside them (an OSC-8 open/close pair, another SGR run) — nothing inside is
 *  parsed or altered, only bracketed.
 *    COLUMN-PRECISE splitting INSIDE a preStyled run is deliberately not attempted: a raw BYTE offset is not
 *  a PLAIN-TEXT character offset once escape sequences are mixed in, and getting that wrong corrupts the
 *  escape sequence rather than merely mispainting a cell. A selection that reaches into a preStyled run (a
 *  fold header, a hyperlink label) therefore paints that run's WHOLE width once any of it overlaps, not just
 *  the intersection — a known, narrower divergence than the plain-text path, and out of this task's required
 *  cells (none of them selects across a linked/fold-header row).
 *    `selectionBg()`'s real values are always `rgb()` tokens (theme.ts, all four palettes) which always
 *  resolve to hex; anything else has no safe raw-SGR form here and is left unpainted rather than guessed at. */
function wrapPreStyledSelection(raw: string): string {
  const hex = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(selectionBg());
  if (!hex) return raw;
  const r = parseInt(hex[1]!, 16), g = parseInt(hex[2]!, 16), b = parseInt(hex[3]!, 16);
  return `\x1b[48;2;${r};${g};${b}m${raw}\x1b[49m`;
}

/** One `Segment` → one `<Text>` (or, only when the selection actually splits it, several) — `runStart` is
 *  the segment's own start offset in the ROW's plain-text coordinates (`l.gutter` is a SEPARATE field, never
 *  concatenated into `l.text`/segments, so the very first segment starts at 0 with no gutter term to
 *  subtract). A `preStyled` segment's plain LENGTH is `stripSgr(s.text).length`, never `s.text.length` (raw
 *  bytes) — the same byte-vs-plain distinction `hitmap.ts`'s own `linkRangesOf` draws for the identical
 *  reason. With no selection touching this segment, the single-piece branch reproduces EXACTLY the `<Text>`
 *  this file emitted before this task — same props, same key, same child. */
function renderSegment(s: Segment, key: number, runStart: number, hovered: boolean, sel: LineSelection | undefined): { node: React.ReactNode; length: number } {
  if (s.preStyled === true) {
    const plainLength = stripSgr(s.text).length;
    const overlaps = sel !== undefined && sel.charEnd > sel.charStart && sel.charStart < runStart + plainLength && sel.charEnd > runStart;
    const raw = unDimRaw(s.text, hovered);
    return { node: <Text key={key}>{overlaps ? wrapPreStyledSelection(raw) : raw}</Text>, length: plainLength };
  }
  const pieces = splitBySelection(s.text, runStart, sel);
  const node = pieces.length === 1
    ? <Text key={key} color={ink(s.color)} backgroundColor={pieceBg(ink(s.bg), hovered, pieces[0]!.selected)} dimColor={hovered ? false : s.dim} bold={s.bold} italic={s.italic} strikethrough={s.strikethrough} underline={s.underline}>{s.text}</Text>
    : <Text key={key}>{pieces.map((p, i) => <Text key={i} color={ink(s.color)} backgroundColor={pieceBg(ink(s.bg), hovered, p.selected)} dimColor={hovered ? false : s.dim} bold={s.bold} italic={s.italic} strikethrough={s.strikethrough} underline={s.underline}>{p.text}</Text>)}</Text>;
  return { node, length: s.text.length };
}

/** RenderLine → <Text>. Exported because PlanDialog renders renderMarkdown() output the same way — one
 *  renderer, so a styling-rule change can't silently drift between the transcript and the dialogs.
 *  `selection` is `undefined` on every call site that predates F9 T-MOUSE Task 6 and on every row Task 6's
 *  own paint finds nothing selected on — the identity path through `splitBySelection`/`renderSegment` above
 *  guarantees those renders are byte-identical to what this file produced before selection existed. The
 *  gutter (`l.gutter`) NEVER receives `selection` — it is a separate field, not part of `l.text`'s character
 *  coordinates, and `selection.ts`'s own column clamp (`gutterWidth + 1`) guarantees a `RowSpan` never
 *  describes a gutter column in the first place, so "gutter chars unpainted" holds by construction on both
 *  sides of this boundary. */
export const Line = ({ l, wrap, selection }: { l: RenderLine; wrap?: "wrap" | "truncate-end"; selection?: LineSelection }) => {
  const hovered = useContext(HoverContext);
  let cursor = 0;
  const segmentNodes = l.segments?.map((s, i) => {
    const { node, length } = renderSegment(s, i, cursor, hovered, selection);
    cursor += length;
    return node;
  });
  const displayText = l.text || " ";
  const plainPieces = l.segments ? null : splitBySelection(displayText, 0, selection);
  return (
    <Text wrap={wrap}>
      {l.gutter ? <Text color={ink(l.gutter.color)} dimColor={hovered ? false : l.gutter.dim} italic={l.gutter.italic}>{l.gutter.text}</Text> : null}
      {segmentNodes ?? (plainPieces!.length === 1
        ? <Text color={ink(l.color)} backgroundColor={pieceBg(ink(l.bg), hovered, plainPieces![0]!.selected)} dimColor={hovered ? false : l.dim} bold={l.bold} italic={l.italic} strikethrough={l.strikethrough} underline={l.underline}>{plainPieces![0]!.text}</Text>
        : plainPieces!.map((p, i) => <Text key={i} color={ink(l.color)} backgroundColor={pieceBg(ink(l.bg), hovered, p.selected)} dimColor={hovered ? false : l.dim} bold={l.bold} italic={l.italic} strikethrough={l.strikethrough} underline={l.underline}>{p.text}</Text>))}
    </Text>
  );
};
