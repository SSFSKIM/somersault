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
// THE BUDGET IS RESPECTED IN ROWS, AND ONLY AFTER THE DRAG SETTLES IN COLUMNS. `pageItemSlices(items, offset,
// regionRows)` can never emit more than `regionRows` SLICE rows, so the frame's `overflow: hidden` never has to
// clip and `onOverflow` — canon's L180317 "something is rendering outside the frame's budget" diagnostic —
// stays silent in steady state. The clip remains, as the last line of defence; relying on it would make the
// frame's one invariant a coincidence.
//   A slice row is a PHYSICAL row only while the projection's width and the region's width agree, and during a
// resize they do not. `columns` here is the live terminal's, moving on the SIGWINCH render; the finalized
// projection is re-wrapped by `useChat` only once the drag has been stopped for `RESIZE_SETTLE_MS` (80 ms —
// `useChat.ts:960-969`, deliberately debounced because re-projecting can COMMIT). So for the whole of a
// narrowing drag the finalized `kind: "line"` items are wrapped for a terminal wider than the one the region
// now has, Ink re-wraps them at paint time, and the region emits more physical rows than it was granted.
// Measured through a real frame at 80x40: grant 37, claimed height 37, painted 39, and the diagnostic fires
// verbatim. THE ROWS THE FRAME CLIPS ARE THE TAIL — the two NEWEST transcript rows — which is exactly what
// bottom-anchoring exists to keep on screen, so the failure is at the worst end. Gutter blocks are not
// exposed: their bodies are wrapped at `columns - 10` (`species.ts:486`) into a box of `columns - 5`, so they
// tolerate five columns of drift. Only `kind: "line"` items are.
//   NO CLAMP HERE, AND NONE IN THE PAGER (T10 review ruling). Neither module owns the truth — the pager is
// width-unaware by design and clamping there would mean lying about heights or truncating content it cannot
// see — and the only honest code fix threads the projection's width down beside `columns` and falls back to
// `wrap="truncate-end"` on line items while the two disagree, trading inline emphasis for the budget. That
// does not earn its complexity against 80 ms. **T17 owes the measurement**: whether a clipped tail lasting as
// long as the user keeps dragging is visible on a real terminal is a question only its resize matrix can ask.
//
// THE CONTENT EVENT IS APPLIED DURING RENDER, not from an effect. Every append, every streamed delta, every
// re-wrap and every resize is a content event, and an effect would paint one frame at the old offset before
// correcting itself — visible as the tail lagging a row behind the stream. React's documented "adjust state
// while rendering" pattern re-runs this component before committing, so the first painted frame is already
// right; `applyAnchor` is idempotent on a repeated content event (sticky re-derives the same bottom, unsticky
// re-clamps to the same ceiling and returns the SAME object), which is what makes the loop terminate at one.
//
// THE KEYS AND THE PILL ARE BOTH HERE (T11), and both for the same reason the anchor is: `settled.sticky`,
// `total`, `height` and the scroll closures are all in scope on this component and nowhere else. Lifting
// either one into ChatApp would re-render the composer, the footer and the dialog chain on every streamed
// delta, and a getter on the imperative handle is not a render trigger — so the pill reads state, not a ref.
import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { applyAnchor, type AnchorState } from "./scrollAnchor.js";
import { PAGER_ACTIONS, pageItemSlices, renderItemHeight, type PagerAction } from "./pager.js";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { streamingItems } from "./streamingItems.js";
import { useRegionRows } from "./FullscreenFrame.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { JumpPill } from "./JumpPill.js";
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
  /** Canon's `isActive: t && !cbr()` (446211): the `Scroll` context is live for the whole of a fullscreen
   *  session EXCEPT while a history search owns the dock, where its own PgUp/PgDn are the ones that must
   *  fire. ChatApp passes the same disjunction it hands the frame (`/history`'s overlay OR the composer's
   *  inline ctrl+r search). The jump pill goes with it: a pill advertising a key nothing would deliver is
   *  the dishonest affordance the derived-hint discipline exists to prevent. */
  historySearchOpen?: boolean;
  scrollRef?: React.Ref<ViewportScroll>;
}

/** `Number.POSITIVE_INFINITY` is "the bottom, whatever the current total is" — the same idiom `TranscriptPager`
 *  opens with. Nothing depends on the value (the first content event re-derives it, since `sticky` is true) but
 *  a finite guess would render one wrong frame if that event were ever skipped; infinity clamps to the bottom
 *  under `pageItemSlices` no matter what the document turns out to be. `hwm` is absent, exactly as the reducer
 *  wants it while sticky. */
const START: AnchorState = { offset: Number.POSITIVE_INFINITY, sticky: true };

export function FullscreenViewport({ finalizedItems, pendingItems, streaming, columns, rows, historySearchOpen = false, scrollRef }: FullscreenViewportProps) {
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
  // Stable for the life of the component: both read the refs above rather than this render's values, so
  // nothing they close over can go stale, and the imperative handle and the key handlers share them.
  const scroll = useCallback((action: PagerAction) => setAnchor(anchorRef.current = applyAnchor(anchorRef.current, { kind: "scroll", action, ...geometry.current })), []);
  const stickBottom = useCallback(() => setAnchor(anchorRef.current = applyAnchor(anchorRef.current, { kind: "stickBottom", ...geometry.current })), []);
  useImperativeHandle(scrollRef, () => ({ scroll, stickBottom }), [scroll, stickBottom]);

  // ── THE `Scroll` CONTEXT (T11) ──────────────────────────────────────────────────────────────────────────
  // Pushed for as long as the viewport is mounted, which is exactly "fullscreen" — this component exists on no
  // other path — and deactivated under a history search, which is canon's other half of the same gate.
  //   ONLY the four actions the context binds are handled. `TranscriptPager` registers the whole
  // `PAGER_ACTIONS` map because the Transcript context binds the whole map; registering names nothing in
  // fullscreen can produce would be ten dead entries. Note the one crossing this does create deliberately: a
  // decision dialog's `SelectDecision` block binds ctrl+u/ctrl+d to the half-page pair for its own reading
  // path, and `handlerFor` looks handlers up by ACTION across the whole stack — so in fullscreen those two
  // keys now scroll the transcript BEHIND the dialog instead of falling through to nobody. That is the right
  // answer for a renderer whose transcript stays on screen under its dialogs, and it is why the dialog's own
  // pair is not re-pointed anywhere.
  //   `scroll:bottom` is `stickBottom`, not `applyPager({kind:"bottom"})`. The two land on the same offset,
  // but only the first is canon's `scrollToBottom()` — "follow the tail again" rather than "show it once".
  useKeyScope("Scroll", { active: !historySearchOpen });
  useKeyActions(useMemo(() => ({
    "scroll:halfPageUp": () => scroll(PAGER_ACTIONS["scroll:halfPageUp"]!),
    "scroll:halfPageDown": () => scroll(PAGER_ACTIONS["scroll:halfPageDown"]!),
    "scroll:top": () => scroll(PAGER_ACTIONS["scroll:top"]!),
    "scroll:bottom": () => stickBottom(),
  }), [scroll, stickBottom]));

  // ── THE JUMP PILL, AND THE ROW IT COSTS ─────────────────────────────────────────────────────────────────
  // `qqH` (455869-455878): shown only when the viewport is neither sticky nor at the end. The second half is
  // not redundant — a content SHRINK leaves the anchor unstuck with the tail nevertheless on screen (the
  // retained offset is held past the new bottom and `pageItemSlices` clamps the paint), and a pill offering to
  // take the reader somewhere they already are is noise.
  //   THE ANCHOR STILL MEASURES AGAINST THE FULL GRANT, and only the SLICE is shortened. Canon's pill is
  // `position:absolute` over the scroll box, so a half page is half of the REGION and `scroll:bottom` lands on
  // the region's own bottom; Ink cannot float a row, so the pill instead COVERS the window's last row — same
  // pixels, same arithmetic, one row of transcript hidden while it is up. Subtracting it from `height` as well
  // would make the scroll distance depend on whether the pill happens to be showing.
  //   AND IT MUST BE SUBTRACTED FROM THE SLICE, for a worse reason than the T10 review predicted. The review
  // expected an unpaid-for row to trip the frame's L180317 diagnostic on every scrolled-up frame. MEASURED, it
  // does not: the frame re-measures in an effect that runs when the FRAME re-renders, and a scroll is
  // viewport-local state, so the frame never re-renders and never looks. The unsubtracted row is therefore not
  // a loud overflow but a SILENT one — the region emits `grant + 1`, the frame's clip drops the last row, and
  // the row it drops is THE PILL. The affordance disappears at exactly the moment it exists for, with nothing
  // on the debug seam to say so. (Verified by mutating this line to `= height`: the pill is gone, the frame is
  // still 39 rows, `onOverflow` is never called. The blind spot is carried to T13, which owns the next change
  // to that measurement.)
  const atEnd = settled.offset >= total - height;
  const showPill = !settled.sticky && !atEnd && !historySearchOpen;
  const body = showPill ? Math.max(0, height - 1) : height;

  // "N new message(s)" — as ROWS, because that is what this document is made of (JumpPill's header records
  // the divergence). The baseline is the row total at the last render that was STICKY: stickiness is lost by
  // a scroll, which does not change `total`, so the frozen value is the total the reader had seen. Re-sticking
  // resumes the mirror and the count returns to zero.
  const stickyTotal = useRef(total);
  if (settled.sticky) stickyTotal.current = total;

  const { slices } = pageItemSlices(items, settled.offset, body);
  // Keyed by item id AND slice index: one item can contribute at most one slice to a window, but the index
  // keeps the key stable when the same block is re-sliced at a different offset.
  return <>
    {slices.map((s, i) => <RenderItemView key={`${s.item.id}:${i}`} item={s.item} start={s.start} end={s.end} showGutter={s.showGutter} />)}
    {showPill ? <JumpPill newRows={Math.max(0, total - stickyTotal.current)} columns={columns} /> : null}
  </>;
}
