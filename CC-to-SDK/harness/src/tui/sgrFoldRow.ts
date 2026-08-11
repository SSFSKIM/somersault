// tui/src/sgrFoldRow.ts — F3 Task 2: the fold row's clause run, written as RAW SGR BYTES rather than as
// styled segments. Why a writer at all: Ink's `<Text dimColor bold>` drops bold (F1's measurement), and a
// styled <Text> lets chalk rewrite any raw code inside it — so the ONLY way to put a genuinely bold count
// inside a dim run is to hand Ink a finished string through a bare <Text> (F3 Task 1's `preStyled` seam).
//
// The shape is upstream 2.1.220's own (bundle L428046): ONE `<Text dimColor={!settled}>` holding the whole
// clause sentence, with each count a nested `<Text bold>`. That nesting is what produces the tracked
// golden's per-cell attributes for `⏺ Reading 1 file… (ctrl+o to expand)`:
//     " Reading "  dim, uncoloured   ·   "1"  dim + bold   ·   " file…"  PLAIN
// The plain tail is not a rendering accident of ours to correct — a nested bold child closes with
// `\x1b[22m`, which clears FAINT as well as bold, and upstream never re-opens the dim. Matching it
// byte-for-byte is the decision (spec Decision Log 2026-08-04: "a 'corrected' writer that keeps dim after
// the count diverges from the golden forever"). So: no dim re-open after a count, ever.
//
// Both forms' runs are dim (R3.5's `dimColor={!s}` polarity is wrong for the active row — spec revision
// 2026-08-03, measured on the golden); the settled run additionally carries the `inactive` grey.
import { resolveThemeColor, themeTokens } from "./theme.js";
import type { FoldClause } from "./toolFold.js";

const DIM = "\x1b[2m", BOLD = "\x1b[1m", NORMAL_INTENSITY = "\x1b[22m", DEFAULT_FG = "\x1b[39m";

/** A resolved theme colour → its 24-bit open/close pair. `resolveThemeColor` yields `#rrggbb` for every
 *  shipped theme's `inactive` (all four are `rgb(...)` tokens), and a 3-digit hex expands the same way; a
 *  bare ANSI name — reachable only through a token form no theme uses — simply renders uncoloured rather
 *  than emitting an unbalanced stream. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function foreground(color: string): { open: string; close: string } | undefined {
  const match = HEX.exec(color);
  if (match === null) return undefined;
  const digits = match[1]!.length === 3 ? match[1]!.replace(/./g, (c) => c + c) : match[1]!;
  const [red, green, blue] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  return { open: `\x1b[38;2;${red};${green};${blue}m`, close: DEFAULT_FG };
}

/** Every SGR the writer emits is a CSI-m code, so this is the exact inverse of the wrapping above — the
 *  row's `RenderLine.text` (width math, tests, the pager) must stay the plain sentence. */
export const stripSgr = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

/** The clause run as one pre-styled string: the clauses joined by the literal `", "` (R3.8), each
 *  `boldRanges` span opened and closed independently, and — for the active row only — the trailing `…`
 *  appended INSIDE the run so it rides whatever state the tail is in (plain after a count, dim when the
 *  sentence carried none). Excludes the leader glyph and the `(ctrl+o to expand)` hint: those stay
 *  ordinary segments, since the golden paints them with their own attributes. */
export function composeFoldRun(clauses: readonly FoldClause[], form: "active" | "settled", options?: { ellipsis?: boolean }): string {
  if (clauses.length === 0) return "";
  const colour = form === "settled" ? foreground(resolveThemeColor(themeTokens().inactive)) : undefined;
  let out = (colour?.open ?? "") + DIM;
  for (const [index, clause] of clauses.entries()) {
    if (index > 0) out += ", ";
    let cursor = 0;
    for (const [start, end] of clause.boldRanges) {
      out += clause.text.slice(cursor, start) + BOLD + clause.text.slice(start, end) + NORMAL_INTENSITY;
      cursor = end;
    }
    out += clause.text.slice(cursor);
  }
  if (options?.ellipsis === true) out += "…";
  return out + NORMAL_INTENSITY + (colour?.close ?? "");
}
