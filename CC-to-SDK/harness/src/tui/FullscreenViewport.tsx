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
//   · `wrapItems` (T17, generalising `streamingItems`' T3 pre-wrap to every tier) turns the projection into
//     the rows it will PAINT at the region's width, one item per physical row, so `renderItemHeight` can be
//     trusted before Ink lays anything out. A line three times the width is three rows here; letting Ink
//     discover that at paint time puts the anchor's arithmetic two rows out and hides the two newest rows.
//   · `applyAnchor` (T2) owns WHERE the window sits: sticky follows the tail, an explicit scroll off the bottom
//     unsticks and content never yanks it back, `stickBottom` re-sticks. It holds the RETAINED offset (canon's
//     `Te`, clamped to a high-water ceiling so a shrink-then-regrow returns the user to the row they were on).
//   · `pageItemSlices` (pager) owns WHAT is painted: it clamps the retained offset against the CURRENT bottom
//     (canon's `Se`) and cuts the window at item boundaries, so a gutter block is sliced by body row and prints
//     its `⎿` exactly once. The dual-value split is deliberate and is T2's review finding, not an accident.
//
// THE BUDGET IS RESPECTED IN ROWS, AND THE ROWS ARE THE ONES THE TERMINAL PAINTS (T17 fix round).
// `pageItemSlices(items, offset, regionRows)` can never emit more than `regionRows` SLICE rows, so the frame's
// `overflow: hidden` never has to clip and `onOverflow` — canon's L180317 "something is rendering outside the
// frame's budget" diagnostic — stays silent in steady state. The clip remains, as the last line of defence;
// relying on it would make the frame's one invariant a coincidence.
//   THAT SENTENCE WAS ONLY TRUE OF THE STREAMING TIER UNTIL T17. `renderItemHeight` answers 1 for a
// `kind: "line"` item, and the FINALIZED projection was handed to the pager unwrapped — so any transcript row
// wider than the pane painted two rows and was counted as one, and the sticky window stopped short by exactly
// the wrap overflow. T10 scoped that to the 80 ms of a narrowing drag (the projection is re-wrapped by
// `useChat` only once the drag has stopped for `RESIZE_SETTLE_MS`) and ruled the honest fix not worth its
// complexity. T17's acceptance run measured the real scope and the ruling does not survive it: the deficit is
// present with NO resize at all (a bullet's three-column gutter on a full-width markdown line is already
// over-wide — ordinary prose at 100 columns showed two paragraphs of eight), it never heals after a drag
// (measured: six markers still missing two seconds later), and because the anchor believes it is at the end
// there is no jump pill and no gesture that reaches the missing tail. Rows the reader cannot see and cannot
// ask for are worse than a wrong number.
//   SO THE DOCUMENT IS WRAPPED BEFORE IT IS WINDOWED (`wrapItems`, the module that now owns the discipline
// T13b and T14 each learned separately). Every tier goes through it at the CURRENT `columns`, one item per
// physical row, and `renderItemHeight` becomes true rather than approximate — which makes the grant, the
// anchor's arithmetic, `atEnd` and the pill's visibility all agree about what is on screen. The projection
// behind it is still re-made on the settle timer, and that is still worth waiting for (re-projecting can
// COMMIT); the difference is that a stale-width projection is now merely wrapped for the wrong width, not
// counted for one. The cost is one `wrapAnsi` per row per width, memoised per (item, width) — an append pays
// for its own rows, a resize pays for the document once.
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
//
// ── THE HITMAP: WHICH CLUSTER IS PAINTED AT A CELL (tool-stream T9) ──────────────────────────────────────
// A click arrives as a terminal cell and has to become a fold anchor. Only this component can answer, and
// only for the frame it just painted: the document rows in the window are `pageItemSlices`' output, which
// exists nowhere else and is different on the next render. So the map is built in the SAME pass that slices
// — no second layout walk, and nothing to keep in step with the paint — and published on its own imperative
// handle beside the scroll one, read through a ref for the reason the scroll closures are (it is called from
// a stdin listener, outside React).
//   THE COLUMN ORIGIN IS THE ONE HALF STILL ASSUMED, and it is assumed HERE: column 1 is taken to be the
// region's first column. True today — nothing on the path from `ChatApp`'s mount through the frame's three
// Boxes sets a `padding` or a `margin`, so the region is full-bleed — and unlike the row origin there is no
// channel publishing it, because there is nothing yet to publish. It is the same class of assumption the
// vertical one was: a `paddingX` on the region someday shifts every column bound by that many cells with
// nothing to say so, and the fix is the same shape (publish the inset, subtract it here).
//   THE ROW ORIGIN COMES FROM THE FRAME (`useRegionTop`) rather than from an assumption here, and it is also
// the RENDERER GATE: `groupItems` tags fold rows unconditionally, including under the classic renderer where
// the field never paints, so a map keyed on "does this row carry a tag" would hand a classic surface
// clickable rows. Keyed on a published origin, only a bounded frame has any — the classic arm publishes 0
// and every cell answers `undefined`.
//   WHAT IT DOES NOT NEED IS AN OCCLUSION TEST. ccx has no overdraw: the layout is flow-based and a surface
// that takes the seam is rendered INSTEAD of the dock, never over it (spec, and `FullscreenFrame`'s header).
// A published row map is therefore always current, and the question "is something drawn over this cell" has
// no meaning here. Which surface owns the input while a dialog is up is ChatApp's gate, one layer up.
import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import stringWidth from "string-width";
import { applyAnchor, type AnchorState } from "./scrollAnchor.js";
import { PAGER_ACTIONS, pageItemSlices, renderItemHeight, type PagerAction, type RenderItemSlice } from "./pager.js";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { streamingItems } from "./streamingItems.js";
import { remapRowOffset, wrapItemsToWidth } from "./wrapItems.js";
import { useRegionRows, useRegionTop } from "./FullscreenFrame.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { JumpPill } from "./JumpPill.js";
import { editorDisplayName } from "./externalEditor.js";
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

/** The click seam (T9), on the same ref-channel family and for the same reason — the frame it describes is
 *  this component's alone, and it changes on every render. */
export interface ViewportHitmap {
  /** The fold cluster painted at a TERMINAL cell — 1-based `(col, row)`, exactly as an SGR mouse report
   *  gives them (`keys/types.ts`) — or `undefined` where nothing clickable is. Task 10 turns a press and a
   *  release on the same answer into a tap. */
  anchorAt(col: number, row: number): string | undefined;
}

export interface FullscreenViewportProps {
  /** The WHOLE finalized projection, not the unpublished tail: on the alternate screen this surface is the
   *  only one there is. */
  finalizedItems: readonly RenderItem[];
  pendingItems: readonly RenderItem[];
  streaming: readonly RenderLine[];
  /** FSW T14 / D14 (grounding §4, bundle L549395: `ds() && jsx(lui, {})`) — the prompts typed during a running
   *  turn, at the TAIL of the scrollable. Canon's classic renderer puts them elsewhere; ccx's puts them in the
   *  dock, which in a fixed frame is a band that cannot scroll and whose budget they eat. Here they are simply
   *  the document's last items, so they follow the tail while the reader is stuck to it and scroll away with
   *  everything else when they are not — and they cost the grant nothing, because `pageItemSlices` is already
   *  the only thing that decides what fits. Pre-built by ChatApp (it owns `userEchoLines`' width and the
   *  queued rule's inset); empty in classic and in every test that does not care. */
  queuedItems?: readonly RenderItem[];
  /** The region's width — every tier is wrapped to it before the window is cut (T17), so a slice row is a
   *  painted row. The region is full-bleed, so this is the terminal's. */
  columns: number;
  /** The row budget. Omitted in production: the frame publishes the rows it granted through its own context. */
  rows?: number;
  /** Canon's `isActive: t && !cbr()` (446211): the `Scroll` context is live for the whole of a fullscreen
   *  session EXCEPT while a history search owns the dock, where its own PgUp/PgDn are the ones that must
   *  fire. ChatApp passes the same disjunction it hands the frame (`/history`'s overlay OR the composer's
   *  inline ctrl+r search). The jump pill goes with it: a pill advertising a key nothing would deliver is
   *  the dishonest affordance the derived-hint discipline exists to prevent. */
  historySearchOpen?: boolean;
  /** FSW T12 — `v`: dump the whole transcript to a file and open it in `$VISUAL`/`$EDITOR`. The viewport owns
   *  WHEN the key is live (see the registration below) and knows nothing about what the dump is: the document,
   *  the alt-screen guard and the status message all live in ChatApp, which is the only place they meet.
   *  Absent — every component test that does not care — and the key stays the composer's. */
  onDumpTranscript?: () => void;
  /** tool-stream T10 — "a wheel tick happened", for the tap state machine one layer up. A pending tap anchor
   *  names a CELL, and a tick moves the document under it, so the gesture has to be abandoned (spec §3.2).
   *  ChatApp cannot observe that itself: a tick is a KEY (`wheelup`/`wheeldown` → `scroll:lineUp`/`lineDown`,
   *  bindings.ts) and `handlerFor` gives a matched action to the INNERMOST handler, which is this component —
   *  a second registration in ChatApp would simply never fire. So the notification comes from the two
   *  handlers below, which in the `Scroll` context are the wheel's own pair and reachable by no other key
   *  (bindings.ts's `Scroll` block binds line moves to `wheelup`/`wheeldown` alone). Absent everywhere except
   *  ChatApp's mount. */
  onWheelTick?: () => void;
  scrollRef?: React.Ref<ViewportScroll>;
  /** tool-stream T9 — the frame's row map, for the click path. A second handle rather than a field on
   *  `ViewportScroll`: the two answer different questions for different callers (a key binding drives the
   *  scroll, a mouse sink reads the map), and every existing `scrollRef` holder would otherwise widen. */
  hitmapRef?: React.Ref<ViewportHitmap>;
}

/** One PAINTED row's clickable identity: the cluster it belongs to, and how far its text reaches. Absent is
 *  a row that is not part of a cluster — kept in the array rather than skipped, because the index IS the
 *  row number and a compacted list would resolve every row below the first cluster to the wrong one. */
type HitRow = { anchor: string; width: number } | undefined;
/** THE COLUMN BOUND (spec §3.3). A click past the end of a row's text is not a click on that row — canon
 *  drops blank-cell clicks (549361) — so the width is the row's PAINTED extent: its plain text, plus the
 *  gutter columns ahead of it, measured in terminal cells rather than characters (a fold row's leader is
 *  `⏺`, two columns and one character). Clamped to the region's width, which is where a `truncate-end`
 *  header — the one row that can be wider than the pane — actually stops.
 *    IT IS `stringWidth` AND NOT `.length`, AND THAT IS A FIX-ROUND FINDING RATHER THAN A PREFERENCE. Swap
 *  either measure back and an all-ASCII fixture stays green while the last cell of every ACTIVE cluster row
 *  goes inert — the blinking-leader row, the one most likely to be clicked mid-turn. `fold-hitmap.test.tsx`
 *  therefore carries a document whose painted extent DIFFERS from its character count (a `⏺` leader, a CJK
 *  hint body, a gutter-bearing line); those cells are the defence, and both call sites here are covered.
 *  The line arm's gutter term has no tagged producer today — a cluster row is never an assistant bullet —
 *  and is the `RenderLine` contract rather than dead weight; the fixture pins it as such. */
const hitRow = (anchor: string | undefined, width: number, columns: number): HitRow =>
  anchor === undefined ? undefined : { anchor, width: Math.min(width, columns) };
/** The window's painted rows, one entry each, in paint order — derived from the slices being rendered, so
 *  the map cannot describe a frame other than the one on screen. A gutter block contributes one entry per
 *  BODY row it paints (its five-column connector column is a sibling Box, blank on continuations but still
 *  occupying the cells), a line item exactly one. */
function hitRowsOf(slices: readonly RenderItemSlice[], columns: number): readonly HitRow[] {
  const out: HitRow[] = [];
  for (const { item, start, end } of slices) {
    if (item.kind === "line") { out.push(hitRow(item.foldAnchor, (item.line.gutter ? stringWidth(item.line.gutter.text) : 0) + stringWidth(item.line.text), columns)); continue; }
    for (let row = start; row < end; row++) out.push(hitRow(item.foldAnchor, item.gutter.length + stringWidth(item.body[row]!.text), columns));
  }
  return out;
}

/** `Number.POSITIVE_INFINITY` is "the bottom, whatever the current total is" — the same idiom `TranscriptPager`
 *  opens with. Nothing depends on the value (the first content event re-derives it, since `sticky` is true) but
 *  a finite guess would render one wrong frame if that event were ever skipped; infinity clamps to the bottom
 *  under `pageItemSlices` no matter what the document turns out to be. `hwm` is absent, exactly as the reducer
 *  wants it while sticky. */
const START: AnchorState = { offset: Number.POSITIVE_INFINITY, sticky: true };
/** A stable empty default, so an absent `queuedItems` cannot invalidate the document memo every render. */
const EMPTY_ITEMS: readonly RenderItem[] = [];
/** The map of a frame nobody can ask about. Every mount outside the click path — every component test, and
 *  ChatApp itself until T10 wires the ref — takes this instead of walking the slices for an answer that has
 *  no reader. The walk is one `stringWidth` per painted row and costs nothing; the guard is here for the
 *  file's own memoisation discipline, which is "derive what is consumed". */
const NO_HIT_ROWS: readonly HitRow[] = [];

export function FullscreenViewport({ finalizedItems, pendingItems, streaming, queuedItems = EMPTY_ITEMS, columns, rows, historySearchOpen = false, onDumpTranscript, onWheelTick, scrollRef, hitmapRef }: FullscreenViewportProps) {
  const granted = useRegionRows();
  const regionTop = useRegionTop();
  const height = Math.max(0, rows ?? granted);
  // Queued prompts go LAST, below even the in-flight turn — canon's own order (`fNn`'s scrollable at L549395
  // ends `… spinner, ds() && <lui/>`).
  // WRAPPED PER TIER, not once over the concatenation, and that is the whole of the performance answer: the
  // finalized document is re-wrapped only when the projection or the width moves, so a streamed delta pays
  // for the streaming tier alone. `wrapItemsToWidth` returns the array it was given when nothing wrapped, so
  // a settled frame allocates nothing here either.
  const finalRows = useMemo(() => wrapItemsToWidth(finalizedItems, columns), [finalizedItems, columns]);
  const pendingRows = useMemo(() => wrapItemsToWidth(pendingItems, columns), [pendingItems, columns]);
  const streamRows = useMemo(() => streamingItems(streaming, columns), [streaming, columns]);
  const queuedRows = useMemo(() => wrapItemsToWidth(queuedItems, columns), [queuedItems, columns]);
  const items = useMemo(() => [...finalRows, ...pendingRows, ...streamRows, ...queuedRows], [finalRows, pendingRows, streamRows, queuedRows]);
  const total = useMemo(() => items.reduce((sum, item) => sum + renderItemHeight(item), 0), [items]);

  const [anchor, setAnchor] = useState<AnchorState>(START);
  // A WIDTH CHANGE RE-NUMBERS THE ROWS, so the retained offset is translated by the document position it
  // names before anything is measured against it (`remapRowOffset`; sticky anchors ignore it and re-derive
  // from the tail). Kept in a ref rather than state because it is a comparison against the LAST RENDER, not
  // a fact about this one — and applied during render for the reason the content event is: an effect would
  // paint one frame at the old numbering before correcting itself.
  const projected = useRef({ columns, items });
  const reprojected = projected.current.columns === columns ? anchor
    : applyAnchor(anchor, { kind: "reproject", offset: remapRowOffset(projected.current.items, items, anchor.offset), total, height });
  projected.current = { columns, items };
  const settled = applyAnchor(reprojected, { kind: "content", total, height });
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
  // The map of the frame BEING PAINTED, written at the bottom of this render (where the slices exist) and
  // read here at call time — the same ref discipline the scroll closures use, and for the same reason: this
  // is called from the mouse sink, outside React, where a captured render's value would be a frame stale.
  //   `top <= 0` IS THE RENDERER GATE (see the header): no frame, or the classic one, publishes no origin,
  // and then no cell on the screen belongs to anything. A row above or below the window indexes past the
  // array — the dock band, the park row, the blank tail and the jump pill's stolen row all land there.
  const hit = useRef<{ top: number; rows: readonly HitRow[] }>({ top: 0, rows: [] });
  const anchorAt = useCallback((col: number, row: number): string | undefined => {
    const { top, rows: painted } = hit.current;
    if (top <= 0) return undefined;
    const at = painted[row - top];
    return at !== undefined && col >= 1 && col <= at.width ? at.anchor : undefined;
  }, []);
  useImperativeHandle(hitmapRef, () => ({ anchorAt }), [anchorAt]);

  // ── THE `Scroll` CONTEXT (T11) ──────────────────────────────────────────────────────────────────────────
  // Pushed for as long as the viewport is mounted, which is exactly "fullscreen" — this component exists on no
  // other path — and deactivated under a history search, which is canon's other half of the same gate.
  //   ONLY the actions the context binds are handled — the four keyboard moves, the wheel's line pair (FSW
  // backlog 5) and the conditional dump. `TranscriptPager` registers the whole `PAGER_ACTIONS` map because the
  // Transcript context binds the whole map; registering names nothing in fullscreen can produce would be dead
  // entries. Note the one crossing this does create deliberately: a
  // decision dialog's `SelectDecision` block binds ctrl+u/ctrl+d to the half-page pair for its own reading
  // path, and `handlerFor` looks handlers up by ACTION across the whole stack — so in fullscreen those two
  // keys now scroll the transcript BEHIND the dialog instead of falling through to nobody. That is the right
  // answer for a renderer whose transcript stays on screen under its dialogs, and it is why the dialog's own
  // pair is not re-pointed anywhere.
  //   `scroll:bottom` is `stickBottom`, not `applyPager({kind:"bottom"})`. The two land on the same offset,
  // but only the first is canon's `scrollToBottom()` — "follow the tail again" rather than "show it once".
  //   `scroll:dumpTranscript` (T12) is the fifth action and the only CONDITIONAL one, because `v` is a
  // printable key on a context whose composer is live. Registration is the gate: `KeymapProvider` falls a
  // matched action with no handler through to the fallback (`:177-180`), so an unregistered `v` reaches the
  // composer as the letter it is. It is registered exactly while the JUMP PILL is up — the moment the screen
  // is telling the reader they are scrolled off the tail, which is canon's reading surface reached by another
  // route (canon's `v` lives on a transcript screen with no composer at all). Sticky, or unstuck-but-at-the-
  // end, and the key is the composer's again. The cost is stated plainly: while the pill is up, `v` does not
  // type. That is the trade the escape hatch is worth, and ctrl+end takes it back in one keystroke.
  const atEnd = settled.offset >= total - height;
  const showPill = !settled.sticky && !atEnd && !historySearchOpen;
  useKeyScope("Scroll", { active: !historySearchOpen });
  useKeyActions(useMemo(() => ({
    "scroll:halfPageUp": () => scroll(PAGER_ACTIONS["scroll:halfPageUp"]!),
    "scroll:halfPageDown": () => scroll(PAGER_ACTIONS["scroll:halfPageDown"]!),
    // FSW BACKLOG 5 — the wheel's pair, and the only two the `Scroll` context now names that no KEY reaches.
    // Same map, same operation j/k perform in the ctrl+O pager: one physical row per tick (canon L181212).
    //   …WHICH IS ALSO WHY THE TAP'S DISCARD SIGNAL HANGS HERE (T10, `onWheelTick` above): being the wheel's
    // own pair in this context is exactly what makes these two handlers a truthful "the wheel turned".
    "scroll:lineUp": () => { onWheelTick?.(); scroll(PAGER_ACTIONS["scroll:lineUp"]!); },
    "scroll:lineDown": () => { onWheelTick?.(); scroll(PAGER_ACTIONS["scroll:lineDown"]!); },
    "scroll:top": () => scroll(PAGER_ACTIONS["scroll:top"]!),
    "scroll:bottom": () => stickBottom(),
    ...(showPill && onDumpTranscript ? { "scroll:dumpTranscript": () => onDumpTranscript() } : {}),
  }), [scroll, stickBottom, showPill, onDumpTranscript, onWheelTick]));

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
  //   `atEnd`/`showPill` are computed ABOVE, beside the key registration that shares them (T12): the pill's
  // visibility is now also what decides whether `v` is ours, and one derivation cannot be allowed to drift
  // from the other.
  const body = showPill ? Math.max(0, height - 1) : height;

  // "N new message(s)" — as ROWS, because that is what this document is made of (JumpPill's header records
  // the divergence). The baseline is the row total at the last render that was STICKY: stickiness is lost by
  // a scroll, which does not change `total`, so the frozen value is the total the reader had seen. Re-sticking
  // resumes the mirror and the count returns to zero.
  const stickyTotal = useRef(total);
  if (settled.sticky) stickyTotal.current = total;

  const { slices } = pageItemSlices(items, settled.offset, body);
  // ONE PASS, TWO PRODUCTS: the rows below and the map of them. Derived from `slices` rather than re-sliced,
  // so the map is the paint by construction — including the row the pill takes, which `body` has already
  // removed from the window and which therefore has no entry to be clicked.
  hit.current = { top: regionTop, rows: hitmapRef ? hitRowsOf(slices, columns) : NO_HIT_ROWS };
  // Keyed by item id AND slice index: one item can contribute at most one slice to a window, but the index
  // keeps the key stable when the same block is re-sliced at a different offset.
  return <>
    {slices.map((s, i) => <RenderItemView key={`${s.item.id}:${i}`} item={s.item} start={s.start} end={s.end} showGutter={s.showGutter} />)}
    {/* AMENDMENT 2: the pill names `v` exactly when `v` is registered above — one derivation, `showPill &&
        onDumpTranscript`, read twice, so the affordance and the key cannot drift apart. `editorDisplayName`
        answers null with neither `$VISUAL` nor `$EDITOR` set, where canon prints its bare `open in editor`. */}
    {showPill ? <JumpPill newRows={Math.max(0, total - stickyTotal.current)} columns={columns}
      {...(onDumpTranscript ? { dumpEditor: editorDisplayName() ?? "editor" } : {})} /> : null}
  </>;
}
