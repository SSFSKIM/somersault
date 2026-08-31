// tui/src/liveWindow.ts — the live-window selector: the one decision the fullscreen renderer and the main
// screen share. Given the finalized transcript items that have NOT been committed yet, it answers "which
// tail of these must stay in the live (re-rendered) subtree, and which are now frozen?" — nothing else. No
// Ink, no React, no terminal: a pure suffix split, so both surfaces can be reasoned about (and tested)
// without a renderer.
//
// INPUT CONTRACT — `items` are the UNPUBLISHED finalized items only. The caller filters by its published-id
// set BEFORE calling, and that ordering is the whole trick: because an item never reappears in the input
// once it has been committed, the spec's one-way commit ratchet needs no state, no bookkeeping and no
// enforcement here. This module therefore does NOT validate published-ness and has no rejection path — it is
// TOTAL over whatever it is handed. Hardening it into a validator would move the ratchet's home and is the
// one change to resist.
//
// WHY THE CAP IS HARD, not advisory: stock Ink 5.2.1 (`build/ink.js:121`) checks `outputHeight >=
// stdout.rows` and, when it holds, writes `clearTerminal + fullStaticOutput + output` straight to stdout —
// the entire session reprinted, every frame. The live subtree must never come near that cliff, so `capRows`
// binds unconditionally: no input, however tall, may produce a window that sums past it.
import type { RenderItem } from "./toolRenderer.js";
import { renderItemHeight } from "./pager.js";

/** The split. `commit` then `window` is exactly the input, in the input's order — the cut is always between
 *  whole items, never inside a gutter block's body (half a block in Static and half in the live subtree would
 *  print one `⎿` and then reflow its two halves independently on resize). */
export interface LiveWindowResult { window: readonly RenderItem[]; commit: readonly RenderItem[] }

/** Two rows of cushion between the window and the cliff. AMENDED BY ITS FIRST CONSUMER (Task 3): Task 1
 *  shipped this as "overshoot a caller adds to `targetRows`", which was the wrong sign. `mainWindowCap`
 *  below returns `rows - dock`, and the dock figure it subtracts is the dock at its MAXIMUM — so a window
 *  filled to exactly that cap, sitting under a dock that is actually that tall, sums to `rows` and takes
 *  Ink's `outputHeight >= stdout.rows` branch (see the note above) on the very frame the cap was supposed
 *  to prevent. The caller therefore HOLDS THIS BACK from the cap it passes in
 *  (`max(0, mainWindowCap(rows) - WINDOW_SLACK)`, ChatApp/useChat), which is the spec's own arithmetic —
 *  `W = rows − dockRows − SLACK`, design §A1 — and leaves the live subtree at `rows − 2` in the worst case.
 *  Adding it to `targetRows` instead would have made the window bigger, not safer: past the cap the target
 *  has no say at all, so it would have been a no-op in every case except the one it endangered. */
export const WINDOW_SLACK = 2;

/** The measured steady-state main-screen dock: the rows that are never the transcript's. It is a measurement,
 *  not a guess (plan review C3) — change it only against a re-measured dock, which means re-checking these
 *  sixteen rows one at a time. T-SPACE Task 3 (spec §2.2/D16) added the two `+1`s marked below: the chrome
 *  margins `addMargin`'s invariant puts on the live-turn slot and the composer (canon `Gn` L77727 / L160599),
 *  which this constant had never charged for because `RenderItem` itself grew no margin concept before
 *  T-SPACE — see `toolRenderer.tsx`'s own separator device for why a `marginTop` is a painted row here, not
 *  a prop:
 *    · 5 — the todo panel's task rows at their maximum (`todoWindowSize` caps the window at 5, `taskPanelModel.ts:16-18`)
 *    · 1 — the todo panel's `marginTop={1}` (`TaskPanel.tsx:106`)
 *    · 1 — the todo panel's count header, "N tasks (…)" (`TaskPanel.tsx:107-111`)
 *    · 1 — the todo panel's "+N more" overflow line (`TaskPanel.tsx:116`)
 *    · 1 — the live-turn slot: spinner, retry row or compaction row, whichever holds it (`ChatApp.tsx:1984-1988`)
 *    · 1 — (T-SPACE +1) the live-turn slot's own `marginTop={1}` wrapper, canon `Gn` L77727, unconditional
 *      whenever the slot renders (`ChatApp.tsx:1984-1988`)
 *    · 1 — the queue band at its minimum: one echoed queued prompt (`ChatApp.tsx:1997-2001`)
 *    · 3 — the composer at its minimum (`ComposerFrame`'s two rules + one content row, `composerFrame.tsx:131`)
 *    · 1 — (T-SPACE +1) the composer's own `marginTop={1}` (canon L160599). This constant models the
 *      WORST case — the palette CLOSED, where the margin is 1 — because a palette open drops the margin to 0
 *      but simultaneously opens `popupHeight(rows)`, a strictly larger reservation subtracted separately at
 *      each call site (`mainWindowCap(rows) − WINDOW_SLACK − popupHeight(rows)`, see `live-window-popup.test.tsx`);
 *      charging the smaller, palette-open figure here would under-reserve the moment the palette closes.
 *    · 1 — the footer (`ChatApp.tsx:2100`) */
const MAIN_DOCK_ROWS = 16;

/** The main screen's hard cap: whatever the terminal has left once the dock is paid for, floored at zero (a
 *  terminal shorter than the dock simply has no live window — the window has no rows, so everything with any
 *  height commits). NB for downstream: `capRows === 0` does not imply `window.length === 0`. Zero-height items
 *  are admitted rows-free by the walk below, so a window can be non-empty while summing to zero rows; read
 *  `rows(window)`, never `window.length`, to decide whether anything is live. */
export function mainWindowCap(rows: number): number { return Math.max(0, rows - MAIN_DOCK_ROWS); }

/** The smallest SUFFIX of whole items whose summed height reaches `targetRows`, hard-bounded at `capRows`;
 *  everything above it is `commit`. Walking from the tail is what makes it minimal: the moment the
 *  accumulated height satisfies the target we stop, so the live subtree never carries rows nobody asked to
 *  reflow. The cap check that stops the walk covers two cases with one condition — an item that simply does
 *  not fit alongside what is already selected, and an item taller than `capRows` all by itself, which can
 *  never be in any window and so becomes a floor: it commits WHOLE (the recorded divergence — it is excluded
 *  from reflow, rather than being split), and the window is whatever sits below it. Past the cap the target
 *  has no say at all, so `targetRows ≥ capRows` degenerates to a purely cap-bounded selection.
 *
 *  THE UNIT IS WHATEVER `heightOf` REPORTS, and both halves of the arithmetic use it — the target walk and
 *  the cap. It defaults to `renderItemHeight`, i.e. LOGICAL lines, which is honest only over a projection
 *  that already fits the pane it will be painted in: `renderMarkdown` does not wrap prose, so a 200-column
 *  paragraph is one logical line Ink paints as three at 80 columns, and a cap enforced in that unit is not a
 *  cap at all — it is the tall-frame branch above, arrived at while believing the budget was kept. A caller
 *  that renders at a known width therefore passes a PAINTED measure (`wrapItems.paintedHeight`); the module
 *  stays Ink-free and pure by taking the measure rather than performing it. */
export function selectLiveWindow(items: readonly RenderItem[], targetRows: number, capRows: number, heightOf: (item: RenderItem) => number = renderItemHeight): LiveWindowResult {
  let cut = items.length, height = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (height >= targetRows) break;
    const next = height + heightOf(items[i]!);
    if (next > capRows) break;
    height = next; cut = i;
  }
  return { commit: items.slice(0, cut), window: items.slice(cut) };
}
