// tui/FullscreenViewport.tsx — THE WHOLE DOCUMENT, VIRTUALIZED, ANCHORED TO ITS TAIL (FSW Task 10, spec §A5).
//
// WHAT THIS REPLACES, and why the replacement is not a refinement but a different shape. Task 9's fullscreen
// region rendered the main screen's live subtree: `windowItems ⧺ pendingItems ⧺ streaming`, i.e. the rows that
// have NOT yet been committed to `<Static>`. On the main screen that is complete, because the committed rows
// are in the terminal's scrollback above the frame. On the alternate screen there is no scrollback and there is
// no `<Static>` (mounting one would put the transcript in Ink's `fullStaticOutput`, which is reset only in its
// constructor and replayed by every later tall write — the T12 hazard), so those rows were on NO surface at
// all. The fix is not to publish them somewhere; it is to stop having two tiers. Here the document is one list
// — `finalizedItems ⧺ pendingItems ⧺ streamingItems(...)` — and the screen is a WINDOW over it.
//
// THREE PIECES, each already built and each owning exactly one decision:
//   · `streamingItems` (T3) pre-wraps the in-flight turn to the region's width, one item per PHYSICAL row, so
//     `renderItemHeight` can be trusted before Ink lays anything out. A line three times the width is three
//     rows here; letting Ink discover that at paint time would put the anchor's arithmetic two rows out and
//     the region two rows over its budget.
//   · `applyAnchor` (T2) owns WHERE the window sits: sticky follows the tail, an explicit scroll off the bottom
//     unsticks and content never yanks it back, `stickBottom` re-sticks. It holds the RETAINED offset (canon's
//     `Te`, clamped to a high-water ceiling so a shrink-then-regrow returns the user to the row they were on).
//   · `pageItemSlices` (pager) owns WHAT is painted: it clamps the retained offset against the CURRENT bottom
//     (canon's `Se`) and cuts the window at item boundaries, so a gutter block is sliced by body row and prints
//     its `⎿` exactly once. The dual-value split is deliberate and is T2's review finding, not an accident.
//
// THE BUDGET IS RESPECTED, NOT SURVIVED. `pageItemSlices(items, offset, regionRows)` can never emit more than
// `regionRows` physical rows, so the frame's `overflow: hidden` never has to clip and `onOverflow` — canon's
// L180317 "something is rendering outside the frame's budget" diagnostic — stays silent in steady state. The
// clip remains, as the last line of defence; relying on it would make the frame's one invariant a coincidence.
//
// THE CONTENT EVENT IS APPLIED DURING RENDER, not from an effect. Every append, every streamed delta, every
// re-wrap and every resize is a content event, and an effect would paint one frame at the old offset before
// correcting itself — visible as the tail lagging a row behind the stream. React's documented "adjust state
// while rendering" pattern re-runs this component before committing, so the first painted frame is already
// right; `applyAnchor` is idempotent on a repeated content event (sticky re-derives the same bottom, unsticky
// re-clamps to the same ceiling and returns the SAME object), which is what makes the loop terminate at one.
import React, { useImperativeHandle, useMemo, useRef, useState } from "react";
import { applyAnchor, type AnchorState } from "./scrollAnchor.js";
import { pageItemSlices, renderItemHeight, type PagerAction } from "./pager.js";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { streamingItems } from "./streamingItems.js";
import { useRegionRows } from "./FullscreenFrame.js";
import type { RenderLine } from "./render.js";

/** The scroll seam, exposed imperatively so a key binding can drive the viewport without the anchor having to
 *  live in ChatApp. T11 owns the `Scroll` key context and the jump pill; both read this. Imperative rather
 *  than a lifted `[anchor, setAnchor]` pair because the anchor is a VIEW property — nothing above the region
 *  renders differently for it — and lifting it would re-render the composer and the footer on every streamed
 *  delta. */
export interface ViewportScroll {
  /** Any `PAGER_ACTIONS` entry: line/page moves, top, bottom. Unsticks unless the result lands on the bottom. */
  scroll(action: PagerAction): void;
  /** Canon's `scrollToBottom()` — re-stick AND re-derive in one step. The pill's action, and `scroll:bottom`'s. */
  stickBottom(): void;
}

export interface FullscreenViewportProps {
  /** The WHOLE finalized projection, not the unpublished tail: on the alternate screen this surface is the
   *  only one there is. */
  finalizedItems: readonly RenderItem[];
  pendingItems: readonly RenderItem[];
  streaming: readonly RenderLine[];
  /** The region's width — `streamingItems` pre-wraps to it. The region is full-bleed, so this is the terminal's. */
  columns: number;
  /** The row budget. Omitted in production: the frame publishes the rows it granted through its own context. */
  rows?: number;
  scrollRef?: React.Ref<ViewportScroll>;
}

/** `Number.POSITIVE_INFINITY` is "the bottom, whatever the current total is" — the same idiom `TranscriptPager`
 *  opens with. Nothing depends on the value (the first content event re-derives it, since `sticky` is true) but
 *  a finite guess would render one wrong frame if that event were ever skipped; infinity clamps to the bottom
 *  under `pageItemSlices` no matter what the document turns out to be. `hwm` is absent, exactly as the reducer
 *  wants it while sticky. */
const START: AnchorState = { offset: Number.POSITIVE_INFINITY, sticky: true };

export function FullscreenViewport({ finalizedItems, pendingItems, streaming, columns, rows, scrollRef }: FullscreenViewportProps) {
  const granted = useRegionRows();
  const height = Math.max(0, rows ?? granted);
  const items = useMemo(
    () => [...finalizedItems, ...pendingItems, ...streamingItems(streaming, columns)],
    [finalizedItems, pendingItems, streaming, columns],
  );
  const total = useMemo(() => items.reduce((sum, item) => sum + renderItemHeight(item), 0), [items]);

  const [anchor, setAnchor] = useState<AnchorState>(START);
  const settled = applyAnchor(anchor, { kind: "content", total, height });
  if (settled !== anchor) setAnchor(settled);

  // The scroll handlers run from a stdin listener, outside React's render — so they read the anchor and the
  // geometry from refs written on every render rather than closing over a stale render's values (the same
  // discipline `TranscriptPager` applies for its same-tick Ctrl-E-then-G case). `settled`, not `anchor`: a
  // scroll must start from the position on screen, not from the one before this render's content event.
  const anchorRef = useRef(settled); anchorRef.current = settled;
  const geometry = useRef({ total, height }); geometry.current = { total, height };
  useImperativeHandle(scrollRef, () => ({
    scroll: (action: PagerAction) => setAnchor(anchorRef.current = applyAnchor(anchorRef.current, { kind: "scroll", action, ...geometry.current })),
    stickBottom: () => setAnchor(anchorRef.current = applyAnchor(anchorRef.current, { kind: "stickBottom", ...geometry.current })),
  }), []);

  const { slices } = pageItemSlices(items, settled.offset, height);
  // Keyed by item id AND slice index: one item can contribute at most one slice to a window, but the index
  // keeps the key stable when the same block is re-sliced at a different offset.
  return <>{slices.map((s, i) => <RenderItemView key={`${s.item.id}:${i}`} item={s.item} start={s.start} end={s.end} showGutter={s.showGutter} />)}</>;
}
