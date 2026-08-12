// tui/dialogs/rowBudget.tsx — THE UNIT A DIALOG'S ROW BUDGET IS SPENT IN (FSW T13b, and its review's C1).
//
// A dock-pinned consult cannot scroll: what the frame clips is unreachable, so under a budget the chrome is
// reserved and the variable BODY windows into what is left, naming the rows it withheld in a marker that
// rides inside the window. That much is T13b's. What T13b got wrong is the UNIT — it windowed LOGICAL LINES
// while the frame pays in PAINTED ROWS. Ink re-wraps anything wider than its box (`wrap-text.js`), so a
// 150-column line in an 80-column pane costs two rows against a budget that charged one, and a dialog that
// claimed eleven rows painted nineteen — pushing the question, every option and `esc cancel` off the frame,
// which is the exact failure the budget exists to remove. WRAP FIRST, WINDOW SECOND: the diff arms were
// already safe only because `renderDiff` pre-wraps to its column budget, and this is that discipline made
// available to every other body.
import React from "react";
import { Text } from "ink";
import wrapAnsi from "wrap-ansi";

/** The rows a block of text ACTUALLY PAINTS at `width` — Ink's own wrap, verbatim (`wrapAnsi(text, width,
 *  { trim: false, hard: true })`, ink/build/wrap-text.js, the same call `diffRender.wrapRows` transcribes).
 *  `hard` is what breaks an unbroken 150-character token rather than letting it overflow the box. Empty
 *  lines survive as empty rows, because a blank line still costs the frame a row. */
export function paintedRows(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  return text.split("\n").flatMap((line) => (line === "" ? [""] : wrapAnsi(line, w, { trim: false, hard: true }).split("\n")));
}

/** The window itself: how many of `count` rows print, and how many the marker must account for. A body that
 *  FITS is untouched; one that does not gives a row back to the marker — and a budget of one row spends it on
 *  the marker alone rather than on a single line of a fifty-row diff. `count` is PAINTED rows (above); handed
 *  logical lines it will under-count exactly as far as the content is over-wide. */
export function bodyWindow(count: number, budget: number | undefined): { keep: number; hidden: number } {
  if (budget === undefined || count <= budget) return { keep: count, hidden: 0 };
  const keep = Math.max(0, budget - 1);
  return { keep, hidden: count - keep };
}

/** The one row that says rows are missing. Inside the window, never after it — placed after the content it
 *  would be the first row a tight budget clipped. */
export const MoreRow = ({ hidden }: { hidden: number }) => <Text dimColor>… +{hidden} more lines</Text>;
