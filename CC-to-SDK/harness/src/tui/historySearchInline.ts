// tui/src/historySearchInline.ts — the PURE half of CM58, the inline reverse-i-search that ctrl+r opens
// inside the composer (F5 task 12). No React, no Ink, no fs: the walk, the two literals, and the two buffer
// transforms. The stateful half is `InlineHistorySearch.tsx`.
//
// WHY THE INLINE SEARCH AND NOT THE PICKER. Upstream ships both and picks by LAYOUT, not by preference:
//  · `Mn("history:search", B, { context: "Global", isActive: yie() ? !1 : !a })` (bundle L489752) — the
//    inline hook claims ctrl+r only when `yie()` (the fullscreen-layout check, L110225) is FALSE.
//  · `if (yie() && mr) return <qGf …>` (bundle L496209) — the full-screen picker renders only when it is TRUE.
// Our REPL is permanently classic layout, so ctrl+r is the inline search and the picker is reachable through
// the `/history` command instead (a recorded ccx addition — upstream has no such command because fullscreen
// gives it the picker for free). See 03-composer.md §6.4.
//
// Transcribed from `r9f` (bundle L489642-L489728) and `xWf` (L493443-L493466):
//  · L489664  the match test — `let ee = ne.toLowerCase().lastIndexOf(ce)`. A SUBSTRING test whose answer is
//             the offset of the LAST occurrence, not the first, and not a ranking: the walk takes the first
//             ENTRY that contains the query anywhere, and parks the caret on the last occurrence inside it.
//  · L489665  the dedup — `R.current`, a Set of DISPLAYS, so two identical prompts count once per walk
//  · L489656  a query change restarts the walk (`x.current = kBs()`) AND clears that Set; `W` (L489686)
//             passes `!0` so ctrl+r continues the same walk with the same Set and therefore steps OLDER
//  · L489648  an emptied query restores the parked draft (value, caret, mode and pastes) — `r(g), n(_), i(A), c(T)`
//  · L489683  `B`, the open: park `{ value, cursorOffset, mode, pastedContents }` before anything moves
//  · L489692  `U`, accept: keep the match (upstream also strips the `!` and sets its own mode state — see
//             DIVERGENCE 1 below for why we do neither)
//  · L489704  `j`, cancel: put the parked draft back
//  · L489707  `G`, execute: an empty query submits the PARKED draft, a live match submits the match
//  · L493445  `xWf`'s two literals — `search prompts:` and, on a failed walk, `no matching prompt:`
//
// FOUR recorded divergences:
//
//  1. THE `!` STAYS IN THE BUFFER, and the caret offset is measured against the text that is actually there.
//     Upstream keeps `mode` in its own state and renders `LV(match.display)` (the display minus its `!`) as
//     the composer's value, which is why it computes the caret twice — once on the raw display and once on
//     the stripped one, preferring the stripped offset (`ae !== -1 ? ae : ee`, L489679). Our mode IS the
//     buffer's prefix (editor.ts's `inputMode`), so the buffer holds the display verbatim and the RAW offset
//     is the right one. `installMatch` keeps upstream's two-offset shape for a different reason — see there.
//
//  2. THE SOURCE IS SCOPED. Upstream's inline walk reads `kBs()` (L317456), which streams the whole prompt
//     log with no project, session or dedup filter — effectively scope "everywhere". Ours reads the SAME file
//     through `readHistory` (`UUd`), which takes a scope, so ctrl+s cycles it exactly as the picker's does.
//     Upstream registers `historySearch:cycleScope` only in the picker (L492190), which leaves the bound
//     ctrl+s of the `HistorySearch` context dead inside its own inline search; ours answers it. The INITIAL
//     scope is "everywhere", which is upstream's inline behaviour exactly.
//
//  3. ONE INPUT, NOT TWO. Upstream mounts a second focused text input for the query and unfocuses the
//     composer's (`focus: !we && !ae`, L496230). This port has a single key fallback, so while the search is
//     live that fallback feeds the QUERY and swallows everything else — which is the same observable
//     property (no keystroke edits the buffer directly while searching), reached from one input instead of two.
//
//  4. CHIPS ARE RE-MINTED ON THE WAY IN. `installMatch` runs the recalled entry through `rebuildChips`, the
//     same machinery the Up-arrow walk uses (editorHistory.ts, FRESH CHIP IDS) — a recalled `[Pasted text #1]`
//     must not collide with an id the live session has already handed out. Upstream re-installs the original
//     ids and has the collision.
import { bufferText, replaceBufferFromOutside, type Cursor, type EditorState, type PastedMap } from "./editor.js";
import { rebuildChips } from "./editorHistory.js";

/** `xWf`'s two labels (bundle L493445): `CWf = ndk ? "no matching prompt:" : "search prompts:"`. Exported
 *  because the pins assert the literals and a second copy in the test would drift. */
export const SEARCH_PROMPT = "search prompts:";
export const NO_MATCH_PROMPT = "no matching prompt:";

/** What the open parks and the cancel restores — upstream's `g`/`_`/`A`/`T` quadruple (L489683), minus the
 *  mode, which for us is a function of `display` and therefore not a separate thing to park. */
export interface SearchDraft { display: string; cursor: Cursor; pastedContents: PastedMap }

/** One searchable line. Deliberately structural rather than `HistoryEntry`: the walk needs the hydrated
 *  display and its resolved pastes, which is `hydrateEntry`'s output, not the persisted row's. */
export interface SearchEntry { display: string; pastedContents?: PastedMap }

export interface InlineMatch { index: number; entry: SearchEntry; offset: number }

/** `M`'s while-loop (L489660-L489681). `entries` is NEWEST-FIRST (`readHistory`'s own order), `from` is where
 *  the previous step stopped, and `seen` carries the displays this walk has already shown. Returns the first
 *  entry at or after `from` whose lowercased display contains `q` and which has not been shown yet. */
export function findInlineMatch(entries: readonly SearchEntry[], from: number, q: string, seen: ReadonlySet<string>): InlineMatch | null {
  const needle = q.toLowerCase();
  if (!needle) return null;
  for (let i = Math.max(0, from); i < entries.length; i++) {
    const display = entries[i].display;
    if (seen.has(display)) continue;
    const offset = display.toLowerCase().lastIndexOf(needle);
    if (offset === -1) continue;
    return { index: i, entry: entries[i], offset };
  }
  return null;
}

/** A flat character offset into `{row, col}` — the shape difference every cursor in this port carries against
 *  upstream's (editor.ts's `StashRecord` note). Past the end clamps to the end. */
export function offsetToCursor(text: string, offset: number): Cursor {
  const lines = text.split("\n");
  let left = Math.max(0, offset);
  for (let row = 0; row < lines.length; row++) {
    if (left <= lines[row].length || row === lines.length - 1) return { row, col: Math.min(left, lines[row].length) };
    left -= lines[row].length + 1;                       // the row's text plus the newline it ends with
  }
  return { row: 0, col: 0 };                             // unreachable: the loop always answers on its last row
}

/** Install a match into the buffer: the display verbatim (divergence 1), its pastes re-minted (divergence 4),
 *  and the caret on the match.
 *
 *  The offset is recomputed against the REBUILT text and only falls back to the one the walk measured — which
 *  is upstream's own `ae !== -1 ? ae : ee` shape (L489679), reached here for a different reason: re-minting a
 *  chip changes the label's length, so an offset measured on the stored display can point at the wrong
 *  character once the ids move. Recomputing is exact whenever the query still occurs; the fallback covers the
 *  one case where it cannot (a query that matched INSIDE the old chip label). */
export function installMatch(s: EditorState, entry: SearchEntry, offset: number, query: string): EditorState {
  const built = rebuildChips({ display: entry.display, pastedContents: entry.pastedContents }, s.pasteCounter);
  const at = query ? built.display.toLowerCase().lastIndexOf(query.toLowerCase()) : -1;
  const base = replaceBufferFromOutside(s, built.display);
  return { ...base, pastedContents: built.pastedContents, pasteCounter: built.pasteCounter, cursor: offsetToCursor(built.display, at !== -1 ? at : offset) };
}

/** `j` (L489704) and `M`'s empty-query arm (L489648): put the parked draft back, text, caret and pastes.
 *
 *  A no-op when the buffer already holds that text. Upstream's setters are idempotent; ours goes through
 *  `replaceBufferFromOutside`, which also drops the history walk, the undo stack and the popups — so
 *  restoring a draft that was never disturbed (opening the search and closing it again without typing) would
 *  silently cost the user their in-progress Up-arrow walk. */
export function restoreDraft(s: EditorState, draft: SearchDraft): EditorState {
  if (bufferText(s) === draft.display) return s;
  const base = replaceBufferFromOutside(s, draft.display);
  return { ...base, pastedContents: draft.pastedContents, cursor: offsetToCursor(draft.display, cursorToOffset(draft.display, draft.cursor)) };
}

/** The inverse of `offsetToCursor`, used only to re-clamp a parked caret against its own text. */
export function cursorToOffset(text: string, c: Cursor): number {
  const lines = text.split("\n");
  const row = Math.min(Math.max(0, c.row), lines.length - 1);
  let off = 0;
  for (let i = 0; i < row; i++) off += lines[i].length + 1;
  return off + Math.min(Math.max(0, c.col), lines[row].length);
}
