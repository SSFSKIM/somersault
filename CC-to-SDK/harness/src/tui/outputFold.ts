// tui/src/outputFold.ts — F3 Task 5: upstream's generic output body (`p2` → `y_s`, L420173/186474), lifted out
// of `toolRenderer.tsx` unchanged so `toolSummaries.ts` can compose a Bash body (stdout fold + stderr fold +
// the typed dim rows) without importing the renderer that imports IT. The only edit is the move: every rule,
// bound and comment below is F1's, byte for byte.
import wrapAnsi from "wrap-ansi";
import { EXPAND_HINT_FALLBACK, SHOW_ALL_HINT } from "./keys/hints.js";
import type { RenderLine } from "./render.js";

/** How much of a result a surface wants: the transcript's three-row compact form, a fully expanded pager view, or
 *  the detail view's own collapsed form (which offers ctrl+e rather than ctrl+o). */
export type ResultProjection = "compact" | "detail-all" | "detail-collapsed";
/** `expandHint` (F4 Task 10b) is the RESOLVED `(chord to expand)` sentence, threaded from the live keymap the
 *  same way `bashHint` is — see `keys/hints.ts`'s `expandHintText` for the three-state contract. ABSENT means
 *  no keymap was in scope, which is `pA`'s fallback case and keeps the literal; EMPTY means the user unbound
 *  `app:toggleTranscript`, and then the marker carries no offer at all rather than a dead chord. */
export interface FoldOptions { projection: ResultProjection; compactRows: number; revealOneExtraWithoutMarker: boolean; expandHint?: string; }
/** The marker's trailing clause for one projection, already spaced. `""` when there is nothing honest to offer. */
export const foldHint = (options: Pick<FoldOptions, "projection" | "expandHint">): string => {
  const hint = options.projection === "compact" ? options.expandHint ?? EXPAND_HINT_FALLBACK : SHOW_ALL_HINT;
  return hint === "" ? "" : ` ${hint}`;
};

/** Slice to VISUAL rows first, then clip — so the overflow count is what the reader actually cannot see, not a
 *  logical-line count that undercounts a wrapped row. `revealOneExtraWithoutMarker` is upstream's four-row
 *  exception: showing a 4th row beats spending that row on "… +1 line". This is the ORDINARY-output fold only —
 *  errors count physical lines instead and never come through here (`errorBody`).
 *  Upstream `Omy` slices at the exact column with NO word wrapping and `trimEnd`s every emitted row (so at width 10
 *  "hello world" is "hello worl"/"d", not "hello"/"world"), and a blank input row stays a blank output row. */
const visualRows = (line: string, width: number): string[] => wrapAnsi(line, width, { hard: true, trim: false, wordWrap: false }).split("\n").map((row) => row.trimEnd());
/** A compact projection shows 3–10 rows, so wrapping a multi-megabyte result would stall Ink on rows nobody can see —
 *  and the 600 ms blink re-renders make it recurring. Upstream `y_s` bounds the work at `compactRows * width * 4`
 *  characters and pays for it with an ESTIMATED hidden count over the whole input, floored by the exact count the
 *  wrapped prefix already proves. `detail-all` is the one projection that must stay unbounded. */
export function foldToolOutput(lines: readonly string[], columns: number, options: FoldOptions): readonly RenderLine[] {
  const width = Math.max(columns - 10, 10);
  if (options.projection === "detail-all") return lines.flatMap((line) => visualRows(line, width)).map((text) => ({ text }));
  const bound = options.compactRows * width * 4, length = lines.reduce((sum, line) => sum + line.length, 0) + Math.max(lines.length - 1, 0);
  const prefix: string[] = [];                                               // exactly the logical lines of `text.slice(0, bound)`
  for (let i = 0, used = 0; i < lines.length; i++) {
    if (i > 0 && ++used > bound) break;                                      // the separating newline itself fell outside the bound
    const line = lines[i], room = bound - used;
    prefix.push(line.length > room ? line.slice(0, room) : line); used += Math.min(line.length, room);
    if (line.length > room) break;
  }
  const visual = prefix.flatMap((line) => visualRows(line, width));
  // The no-marker path requires the WHOLE input inside the bound: SGR-heavy source can exceed the bound in bytes
  // while its clipped prefix wraps to few visual rows, and returning here would silently drop the tail.
  if (length <= bound && visual.length <= options.compactRows + (options.revealOneExtraWithoutMarker ? 1 : 0)) return visual.map((text) => ({ text }));
  const estimated = length > bound ? Math.max(lines.length, Math.ceil(length / width)) - options.compactRows : 0;
  const hidden = Math.max(visual.length - options.compactRows, estimated);
  return [...visual.slice(0, options.compactRows).map((text) => ({ text })), { text: `… +${hidden} ${hidden === 1 ? "line" : "lines"}${foldHint(options)}`, dim: true }];
}

/** Upstream `y_s` `trimEnd`s the WHOLE result before it folds anything, so trailing blank rows never buy a fold slot
 *  — and a result that is nothing but whitespace renders no body, which means no gutter block at all. Interior
 *  blanks are content and stay exactly where they are. */
export const withoutTrailingBlanks = (lines: readonly string[]): readonly string[] => {
  let end = lines.length; while (end > 0 && lines[end - 1]!.trim() === "") end--;
  const kept = lines.slice(0, end);
  // Upstream trimEnd()s the WHOLE string, which also strips padding from the last nonblank line — left in place it
  // would wrap into a phantom empty row (or a bogus marker) before the per-row trim ever saw it.
  if (kept.length) kept[kept.length - 1] = kept[kept.length - 1]!.trimEnd();
  return kept;
};
