// tui/composerRows.ts — S1: the composer's PAINTED buffer height, the one term the bottom-up caret origin
// (ChatComposer.tsx) cannot read off `wrapRows` alone. `caretFromLocalPosition` (editor.ts:752) walks the
// same `wrapRows` per logical line to turn a click into a cursor, so the two MUST agree about how many rows
// each line takes — this module is that walk plus the paint-time runs `renderBuffer` adds around the text:
//   · the CURSOR CELL. At end-of-line `renderBuffer` paints `at = line[cursor.col] ?? " "` — a real blank
//     cell past the text — so a line of exactly `innerWidth` characters with the cursor at its end paints
//     TWO rows where the text alone paints one. Inside the line the cell REPLACES a character and costs
//     nothing.
//   · the GHOST SUFFIX (CM36). `tail` is drawn after the cursor cell in the same row Box, so it lengthens
//     the row and can push it over the boundary.
//   · the PLACEHOLDER. An empty buffer paints `PlaceholderCursor` (composerFrame.tsx:76-79) INSTEAD of the
//     buffer, and a long placeholder wraps like any other text.
// Pure — no React, no Ink — so the boundary cells are a table rather than a mount; `dockOrigin.test.tsx`
// pins the whole thing against what the real frame actually paints, which is the claim that matters.
import { wrapRows } from "./wrapItems.js";

export interface BufferPaint {
  lines: readonly string[];
  cursor: { row: number; col: number };
  /** CM36's inline completion suffix, or null. Painted as `<Text dimColor>` after the cursor cell. */
  ghost: string | null;
  /** The placeholder painted INSTEAD of the buffer when it is empty (`PlaceholderCursor`), or null. */
  placeholder: string | null;
  /** `cols - stringWidth(POINTER + NBSP)` — what `renderBuffer`'s per-line `<Text>` has to paint into. */
  innerWidth: number;
}

/** The exact string one buffer row paints, cursor cell and ghost included — `renderBuffer`'s own
 *  composition, spelled once so the height walk and the caret walk cannot drift. */
function paintedRow(paint: BufferPaint, index: number): string {
  const line = paint.lines[index] ?? "";
  if (index !== paint.cursor.row) return line.length ? line : " ";
  const g = paint.ghost ? [...paint.ghost] : null;
  const at = g ? (g[0] ?? " ") : (line[paint.cursor.col] ?? " ");
  const tail = g ? g.slice(1).join("") : "";
  return line.slice(0, paint.cursor.col) + at + tail + line.slice(paint.cursor.col + 1);
}

/** Everything `renderBuffer` (ChatComposer.tsx:118-147) and `PlaceholderCursor` (composerFrame.tsx:76-79)
 *  need to know how many PHYSICAL rows the buffer paints. */
export function bufferPhysicalRows(paint: BufferPaint): number {
  const width = Math.max(1, Math.floor(paint.innerWidth));
  const empty = paint.lines.length <= 1 && (paint.lines[0] ?? "") === "";
  if (empty) return wrapRows(paint.placeholder && paint.placeholder.length ? paint.placeholder : " ", width).length;
  let rows = 0;
  for (let i = 0; i < paint.lines.length; i++) rows += wrapRows(paintedRow(paint, i), width).length;
  return Math.max(1, rows);
}

/** The bottom-up origin itself, as a pure function so the pane-height × footer-config table is a table and
 *  not a set of mounts. Answers the 1-based terminal row of the buffer's FIRST painted line, or `0` for
 *  "not addressable" — every refusal the composer owns (no frame, the frame's watchdog, a hoisted palette,
 *  a composer whose own top would sit above the dock band's first row). */
export interface OriginInput {
  dockTop: number;            // useDockTop() — the dock band's first row, the sanity floor
  dockBottom: number;         // useDockBottom() — the frame's last row, 0 while the watchdog refuses
  footerRows: number;         // ChatApp's footerRows(footerStatusInput())
  inlineSearchOpen: boolean;  // InlineSearchRow, one row under the buffer's bottom rule
  waitingForPermission: boolean;
  paletteHoisted: boolean;
  bufferPhysicalRows: number;
}

/** The composer's position, computed FROM BELOW. Every term is either the frame's own, the app's own or the
 *  composer's own; no occupant ABOVE the composer appears — which is the whole point (see ChatComposer's
 *  own header, and `dockDialogRows`, still charging a two-row CompactionRow one row). */
export function composerOriginRow(i: OriginInput): number {
  if (i.dockTop <= 0 || i.dockBottom <= 0 || i.footerRows <= 0 || i.paletteHoisted) return 0;
  const bufferBottom = i.dockBottom - i.footerRows - (i.inlineSearchOpen ? 1 : 0) - 1;
  const bufferTop = bufferBottom - (Math.max(1, i.bufferPhysicalRows) - 1);
  const composerTop = bufferTop - 1 - (i.waitingForPermission ? 2 : 0);   // the top rule, then the wait box
  return composerTop >= i.dockTop ? bufferTop : 0;
}
