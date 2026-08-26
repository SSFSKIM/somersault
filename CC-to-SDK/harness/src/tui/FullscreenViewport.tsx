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
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import stringWidth from "string-width";
import { applyAnchor, type AnchorState } from "./scrollAnchor.js";
import { PAGER_ACTIONS, pageItemSlices, renderItemHeight, type PagerAction, type RenderItemSlice } from "./pager.js";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { streamingItems } from "./streamingItems.js";
import { remapRowOffset, sourceId, wrapItemsToWidth } from "./wrapItems.js";
import { clickableOwnersOf, columnToChar, linkRangesOf, sourceEndpointAt, type HitRow } from "./mouse/hitmap.js";
import { remapSelection, type SelectionAddresses, type SelectionEndpoint } from "./mouse/address.js";
import { HoverContext } from "./mouse/hoverContext.js";
import { createSelectionState, dragTo, dragToSpanned, hasSelection as computeHasSelection, moveSelectionFocus, multiClick, selectedSpans, startSelection, type Cell, type ExtendDir, type RowSpan, type SelectionState } from "./mouse/selection.js";
import { charRangeOf } from "./mouse/extract.js";
import { documentSelectionText } from "./mouse/documentText.js";
import type { LineSelection } from "./Line.js";
import { stripSgr } from "./sgrFoldRow.js";
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
  /** T-CLICKGATE Task 3 — the click seam's OWN resolver, widened beyond `anchorAt`'s fold-only answer: a
   *  STABLE SCALAR, `"fold:" + anchor` or `"item:" + ownerKey`, never `undefined` except where neither
   *  applies. A scalar rather than an object because the tap machine (`ChatApp`) compares the press's and the
   *  release's answer with `===` — two separately-built objects at the same cell would never match, while two
   *  primitive strings built from the same characters always do (JS string equality is by value). `anchorAt`
   *  itself is UNCHANGED (`fold-hitmap.test.tsx` pins its bare-anchor return): this is a second, additive
   *  answer for the same painted row, not a replacement. A fold anchor wins at a cell that somehow wore both
   *  (today the two never coexist on one row — `RenderItem`'s own doc — so this is a stated priority, not an
   *  observed case). */
  clickTargetAt(col: number, row: number): string | undefined;
  /** F9 T-MOUSE Task 3 — resolve a motion report's cell to the row-cluster's `itemKey` (same bound `anchorAt`
   *  uses: past the window or past a row's own painted width answers "hover nothing") and set it HOVERED for
   *  the next repaint. Owned here rather than duplicated as ChatApp state: the row list this resolves against
   *  is the SAME one `anchorAt` reads, off the SAME frame just painted — a second copy one layer up would
   *  drift from what is actually on screen, exactly `anchorAt`'s own doc's reasoning. */
  hoverAt(col: number, row: number): void;
  /** Explicit clear — a wheel tick (the document moved under the pointer; ChatApp wires this to the same
   *  `onWheelTick` signal that already discards a pending tap for the identical reason). Idempotent. */
  clearHover(): void;
  /** F9 T-MOUSE Task 6 — canon's `Eka`: a fresh left press starts a sweep at this cell, discarding whatever
   *  selection (drag OR multi-click span) was live before it — a second press always RE-ARMS rather than
   *  extending, exactly `startSelection`'s (`mouse/selection.ts`) own contract. `(col, row)` are 1-based
   *  terminal coordinates, exactly as an SGR mouse report gives them, matching `anchorAt`/`hoverAt`. */
  startSelectionAt(col: number, row: number): void;
  /** Canon's `y0p`: extend the in-flight sweep to this cell. A drag landing back on the anchor's own cell
   *  UN-selects (`dragTo`'s own contract) — the mechanism that keeps a press-then-release-on-the-same-cell a
   *  plain click even though a drag event or two crossed the cell in between. Harmless (and a documented
   *  no-op, per `selectedSpans`' own priority order) once a multi-click span is already live. */
  dragSelectionTo(col: number, row: number): void;
  /** Canon's `b0p`: a double (`count: 2`, word) or triple (`count: 3`, line) click sets the span directly —
   *  no drag required for `hasSelection()` to answer `true`. Resolves its own `HitRow` off THIS frame's
   *  painted rows (the same array `anchorAt`/`hoverAt` read), so a stale row from a since-scrolled frame is
   *  never consulted. */
  multiClickSelectionAt(col: number, row: number, count: 2 | 3): void;
  /** Release: flips `isDragging` false. The paint and `hasSelection()` both read `anchor`/`focus`/
   *  `anchorSpan` regardless of this flag, so calling it has no visible effect on its own — it exists so the
   *  NEXT gesture (a stray drag event arriving after the button already lifted, Task 7's copy-latch reset)
   *  sees an honest "not dragging" state, matching canon's own release-always-stops-the-drag branch. */
  endSelectionDrag(): void;
  /** `true` once a real sweep (a drag whose focus differs from its anchor) or a multi-click span exists —
   *  the release branch's click/sweep discriminant (canon's `!yze(r) && r.anchor`, negated): ChatApp reads
   *  this on every release to decide whether the gesture was a selection (swallow — no fold toggle, no
   *  caret move) or a plain click (fall through to the existing targets, unchanged). */
  hasSelection(): boolean;
  /** The document moved under a live sweep (a wheel tick) — clears the whole selection state and repaints so
   *  the highlight disappears on the SAME frame, not the next content event. Idempotent on an already-empty
   *  selection. */
  discardSelection(): void;
  /** F9 T-MOUSE Task 7 — the current selection's plain text, painted-extent to painted-extent (the SAME
   *  `selectedSpans`/`extractText` geometry that lights up on screen), for the auto-copy latch and the
   *  Ctrl+C key-lifetime arm. `""` for no selection — never `undefined`, so a caller can hand it straight to
   *  `copyText` without a branch. */
  selectedText(): string;
  /** F10 S5 — canon's `moveSelectionFocus`/`E0p` (`mouse/selection.ts`), wired through the wrapper that
   *  also re-records the durable addresses (Task 6) so the very next repaint does not remap them back to
   *  the pre-extend position. Returns `false` when no selection is live (the caller then leaves the key to
   *  the composer). */
  moveSelectionFocus(dir: ExtendDir): boolean;
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
  /** F10 T-HOVER — the streaming tier's hover unit for THIS `streaming` snapshot (`LiveTurn.messageKey()`,
   *  read once per snapshot by `useChat`). Defaulted so every existing mount is unaffected; `ChatApp` passes
   *  the live value on the one mount whose output is hovered. */
  streamOwnerKey?: string;
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

/** ONE HIT ROW, FULLY POPULATED (F9 T-MOUSE Task 1; `HitRow` is `mouse/hitmap.ts`'s own widened type). Every
 *  painted row gets a real object now — `anchor` absent is "not a cluster", never a hole in the array — which
 *  is what lets a later task's `columnToChar`/`linkRangesOf` query an ORDINARY line exactly the way they
 *  query a fold row; `anchorAt` below still reads only `.anchor`/`.width` and cannot tell the difference from
 *  before this task.
 *
 *  THE COLUMN BOUND (spec §3.3, unchanged). A click past the end of a row's text is not a click on that row —
 *  canon drops blank-cell clicks (549361) — so `width` is the row's PAINTED extent: its plain text, plus the
 *  gutter columns ahead of it, measured in terminal cells rather than characters (a fold row's leader is
 *  `⏺`, two columns and one character). Clamped to the region's width, which is where a `truncate-end`
 *  header — the one row that can be wider than the pane — actually stops.
 *    IT IS `stringWidth` AND NOT `.length`, AND THAT IS A FIX-ROUND FINDING RATHER THAN A PREFERENCE. Swap
 *  either measure back and an all-ASCII fixture stays green while the last cell of every ACTIVE cluster row
 *  goes inert — the blinking-leader row, the one most likely to be clicked mid-turn. `fold-hitmap.test.tsx`
 *  therefore carries a document whose painted extent DIFFERS from its character count (a `⏺` leader, a CJK
 *  hint body, a gutter-bearing line); those cells are the defence, and both call sites below are covered.
 *  The line arm's gutter term has no tagged producer today — a cluster row is never an assistant bullet —
 *  and is the `RenderLine` contract rather than dead weight; the fixture pins it as such.
 *
 *  `itemKey` is `wrapItems.ts`'s `sourceId(item.id)` — the source item's own durable id with any wrap-row
 *  suffix stripped — never this loop's position, so it survives a re-wrap or an item streaming in above it
 *  unchanged (`hitmap.ts`'s own doc states why a slice INDEX cannot be used here). `softWrap` reads
 *  `RenderLine.continuation` (`wrapItems.ts`'s `wrapLine`, set on every row a wrap produced past the first) —
 *  present on `item.line` for a wrapped LINE item and on `item.body[row]` for a gutter block's wrapped body,
 *  which is why this one helper covers both arms despite their very different shapes below. `text` is
 *  defensively `stripSgr`'d again even though every producer already hands `RenderLine.text` plain
 *  (`toolRenderer.tsx` strips a `preStyled` run at publish) — cheap, idempotent, and the honest reading of
 *  "plain text via the existing stripSgr" rather than a second contract nothing enforces. */
// F10 S4 — `fallback` is the `{start, end}` this row's source range takes when `l.source` is absent: the
// identity arm of `wrapLine`/`wrapOne` mints no `source` at all for a row it never wrapped, so the caller
// (which knows the row's position — a single `HitRow` does not) supplies the whole-item range instead.
const hitRowOfLine = (l: RenderLine, anchor: string | undefined, itemKey: string, ownerKey: string, columns: number, fallback: { start: number; end: number }): HitRow => {
  const gutterWidth = l.gutter ? stringWidth(l.gutter.text) : 0;
  const linkRanges = linkRangesOf(l);
  const text = stripSgr(l.text);
  const source = l.source ?? { ...fallback, pad: 0 };
  // `clickable` is always overridden by each of the two call sites below (off the ITEM's own bit, which
  // this line-level helper has no access to) — `false` here is a placeholder, never the final answer.
  return { itemKey, ownerKey, anchor, kind: "line", gutterWidth, text, softWrap: l.continuation === true ? "continuation" : "hard",
    charStart: source.start, charEnd: source.end, textStart: source.pad, clickable: false,
    width: Math.min(gutterWidth + stringWidth(l.text), columns), ...(linkRanges ? { linkRanges } : {}) };
};
/** The window's painted rows, one entry each, in paint order — derived from the slices being rendered, so
 *  the map cannot describe a frame other than the one on screen. A gutter block contributes one entry per
 *  BODY row it paints (its five-column connector column is a sibling Box, blank on continuations but still
 *  occupying the cells), a line item exactly one — the body arm builds off `hitRowOfLine` too (each body row
 *  is its own `RenderLine`) and only overrides `kind`/`gutterWidth`/`width` for the block's fixed connector. */
// Exported for `test/tui/hitmap.test.ts` (F9 T-MOUSE Task 1): that file pins the widened `HitRow` shape
// against the REAL publish path (`wrapItemsToWidth` → `pageItemSlices` → this function) without mounting a
// React tree — the component-level cases (`fold-hitmap.test.tsx`) keep proving the `anchorAt`/frame-origin
// wiring this function's caller owns.
export function hitRowsOf(slices: readonly RenderItemSlice[], columns: number): readonly HitRow[] {
  const out: HitRow[] = [];
  for (const { item, start, end } of slices) {
    const itemKey = sourceId(item.id);
    // The spec's `ownerKey ?? sourceId(id)`, resolved once here rather than by every consumer a second time —
    // `item.ownerKey` is absent only for a non-transcript caller (this array is always a transcript tier), so
    // in practice this is always the producer's own key, never the fallback.
    const ownerKey = item.ownerKey ?? itemKey;
    if (item.kind === "line") {
      // T-CLICKGATE Task 2 — the row-level projection of `RenderItem.clickable` (`item.clickable === true`,
      // never a bare `item.clickable`: `HitRow.clickable` is required, and an absent source bit must read
      // `false`, not `undefined`).
      out.push({ ...hitRowOfLine(item.line, item.foldAnchor, itemKey, ownerKey, columns, { start: 0, end: stripSgr(item.line.text).length }), clickable: item.clickable === true });
      continue;
    }
    // F10 S4 — the cumulative fallback base walks the block's ORIGINAL body order from row 0 regardless of
    // where the slice starts: a body row cut away by the window still contributes its length plus one `\n`
    // separator to every surviving row's base, which is what keeps a partially-visible block's rows naming
    // their TRUE source positions unchanged by the slice. This IS the block's only source of truth when
    // nothing wrapped it (`wrapOne`'s identity return carries no `source` at all).
    let base = 0;
    for (let row = 0; row < end; row++) {
      const body = item.body[row]!;
      if (row >= start)
        // T-CLICKGATE Task 2 — same row-level projection as the `line` arm above, off the BLOCK's own bit
        // (every body row of one result shares the one `clickable` its producer stamped on the item).
        out.push({ ...hitRowOfLine(body, item.foldAnchor, itemKey, ownerKey, columns, { start: base, end: base + body.text.length }), kind: "gutter-block",
          gutterWidth: item.gutter.length, width: Math.min(item.gutter.length + stringWidth(body.text), columns), clickable: item.clickable === true });
      base += item.body[row]!.text.length + 1;
    }
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
/** T-CLICKGATE Task 2 — `NO_HIT_ROWS`'s own sibling default: no painted rows means no clickable owners
 *  either, and `clickableOwnersOf(NO_HIT_ROWS)` would just allocate a fresh empty `Set` to say so. */
const NO_CLICKABLE_OWNERS: ReadonlySet<string> = new Set();
/** A stable empty lookup for "no selection this frame" — F9 T-MOUSE Task 6, the same "derive what is
 *  consumed" discipline `NO_HIT_ROWS` states: a `new Map()` per idle render would be free but pointless. */
const EMPTY_SPAN_MAP: ReadonlyMap<number, RowSpan> = new Map();
/** F10 T-HOVER — the jump pill's hover key. Not an item id: the pill is not in the document, and by
 *  construction (`body = height - 1`, the pill painted after the slices) it has no `HitRow` either. */
export const PILL_HOVER_KEY = "#jump-pill";

// F10 S6 — canon's constants, verbatim (L551562): two rows a tick, a tick every 50 ms, 200 ticks maximum.
// The cap is the second belt — the first is that every path out of a drag clears the timer — because a
// timer that outlives the gesture re-scrolls the transcript under an idle reader. Exported so the driver
// test can index its own boundary assertions off these names rather than a hand-typed 200/2/50, which is
// the drift a cap without an accounting point always suffers.
export const AUTOSCROLL_ROWS = 2;        // canon `Yjh`
export const AUTOSCROLL_MS = 50;         // canon `Jjh`
export const AUTOSCROLL_MAX_TICKS = 200; // canon `iNw`

export function FullscreenViewport({ finalizedItems, pendingItems, streaming, streamOwnerKey, queuedItems = EMPTY_ITEMS, columns, rows, historySearchOpen = false, onDumpTranscript, onWheelTick, scrollRef, hitmapRef }: FullscreenViewportProps) {
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
  const streamRows = useMemo(() => (streamOwnerKey === undefined ? streamingItems(streaming, columns) : streamingItems(streaming, columns, streamOwnerKey)), [streaming, columns, streamOwnerKey]);
  const queuedRows = useMemo(() => wrapItemsToWidth(queuedItems, columns), [queuedItems, columns]);
  const items = useMemo(() => [...finalRows, ...pendingRows, ...streamRows, ...queuedRows], [finalRows, pendingRows, streamRows, queuedRows]);
  const total = useMemo(() => items.reduce((sum, item) => sum + renderItemHeight(item), 0), [items]);
  // F10 S4c — which source item is where in the DOCUMENT: the fact that tells "scrolled out of the window"
  // (keep the address, paint at the edge, mark virtual) apart from "gone from the document" (clear). Memoised
  // on the projection, so a publish costs a map lookup rather than a walk. Mirrored into a ref for the same
  // reason `hit` is one: the imperative reads (`selectedText`, Task 8's timer) run outside React and must see
  // the latest frame's map, not whichever render's closure the handle happens to hold.
  const ordinals = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((item, i) => { const k = sourceId(item.id); if (!m.has(k)) m.set(k, i); });
    return m;
  }, [items]);
  const ordinalsRef = useRef(ordinals); ordinalsRef.current = ordinals;
  // F10 S6 — the WHOLE document's own projection, for `selectedText`'s document walk (below): a copy costs
  // one document wrap per COPY (release, Ctrl+C), never per frame, so this is written every render but read
  // only on demand. Mirrored into a ref for the same reason `ordinalsRef`/`hit` are: `selectedText` is an
  // imperative read from outside React and must see the LATEST render's document, not a stale closure's.
  const docRef = useRef({ items, columns, total }); docRef.current = { items, columns, total };

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
  const hit = useRef<{ top: number; rows: readonly HitRow[]; pillRow: number; clickableOwners: ReadonlySet<string> }>(
    { top: 0, rows: [], pillRow: 0, clickableOwners: NO_CLICKABLE_OWNERS });
  const anchorAt = useCallback((col: number, row: number): string | undefined => {
    const { top, rows: painted } = hit.current;
    if (top <= 0) return undefined;
    const at = painted[row - top];
    return at !== undefined && col >= 1 && col <= at.width ? at.anchor : undefined;
  }, []);
  // T-CLICKGATE Task 3 — the click seam's own resolver (interface doc above). Reads the SAME `hit.current`
  // row `anchorAt` does, off the same column bound, so the two never disagree about WHICH cell has anything
  // at all — only about what to call it.
  //   T-LINKOPEN Task 1 (F2) — THE LINK CHECK RUNS FIRST, ahead of both the fold answer and the item answer,
  // and it is NOT gated on `clickableOwners`. Canon's own row `onClick` handler (research-links.md §3e) reads
  // as `if (event.hyperlinkUrl) return event.allowDefault(); …toggle…` — the hyperlink check is the FIRST
  // statement, before the toggle is even considered, and it runs whether or not the row is one canon's own
  // `isItemClickable` would ever mark clickable. A prose row is never a "clickable owner" (only a fold
  // cluster or a clickable tool result is), yet its markdown link cells still have to resolve to no target —
  // an un-owned row's `clickableOwners.has(...)` check below would otherwise never even get asked. The
  // 2.1.237-era premise this order used to encode — "canon defers URL-opening entirely" — no longer holds
  // (2.1.246 self-opens a gated release; T-LINKOPEN Task 3 wires ccx's own opener behind this same
  // no-target answer). This task only clears the path: an `undefined` here is what lets a later gated
  // release recognize "the tap machine found nothing" and try the opener instead, and it is what stops a
  // fold row's own link cell from silently toggling the fold underneath a click aimed at the link.
  const clickTargetAt = useCallback((col: number, row: number): string | undefined => {
    const { top, rows: painted, clickableOwners } = hit.current;
    if (top <= 0) return undefined;
    const at = painted[row - top];
    if (at === undefined || col < 1 || col > at.width) return undefined;
    // `columnToChar` already answers `undefined` for a gutter column and for a column past the row's own
    // text (the blank tail), so a click there simply finds no span here and falls through to the fold/item
    // answers below unchanged — this check only ever NARROWS what those answer, never widens past the width
    // bound already enforced above.
    const hitChar = at.linkRanges?.length ? columnToChar(at, col) : undefined;
    if (hitChar !== undefined && at.linkRanges!.some((r) => hitChar.charStart < r.end && hitChar.charEnd > r.start)) return undefined;
    if (at.anchor !== undefined) return "fold:" + at.anchor;
    // bl4 fix-wave finding 1 (P2): resolved through the OWNER-level set, exactly as `hoverAt` resolves its
    // brightening below — a clickable result's HEADER row shares the owner's key but never carries
    // `HitRow.clickable` itself (only the gutter-block body does), so the per-row bit alone silently refused
    // the tap on a row hover had already brightened. `clickableOwnersOf` is `hit.current`'s own field, read
    // off the SAME frame `at` came from, so this can never disagree with what is actually painted.
    if (!clickableOwners.has(at.ownerKey)) return undefined;
    return "item:" + at.ownerKey;
  }, []);
  // F9 T-MOUSE Task 3 — HOVER STATE. Plain `useState`, not a ref: unlike the tap anchor (which rides the NEXT
  // click's own comparison, nothing else painting differently for it meanwhile) a hovered row IS the paint —
  // nothing else in this render would otherwise change to reflect the pointer having moved, so this state
  // update IS the "targeted invalidation" the brief asks for: it re-renders this ONE component (a normal frame
  // paint this file already does on every content event), not the document, not `useChat`, not ChatApp's tree.
  //   F10 T-HOVER: the key compared is the ROW's OWNER now (`item.ownerKey ?? sourceId(item.id)`, resolved
  // once in `hitRowsOf`), not its `itemKey` — canon's hover unit is one whole SDK message, coarser than the
  // per-line/per-call `itemKey` a later track addresses character offsets on.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const hoverAt = useCallback((col: number, row: number): void => {
    const { top, rows: painted, pillRow, clickableOwners } = hit.current;
    if (top <= 0) { setHoveredKey(null); return; }
    if (pillRow > 0 && row === pillRow) { setHoveredKey(PILL_HOVER_KEY); return; }
    const at = painted[row - top];
    // T-CLICKGATE Task 2 — the F10-era gate brightened whatever was under the pointer, full stop; canon
    // brightens only a row whose OWNER is click-to-expand. The owner-level set was resolved once, alongside
    // `painted`, rather than re-derived here on every mouse-move tick.
    setHoveredKey(at !== undefined && col >= 1 && col <= at.width && clickableOwners.has(at.ownerKey) ? at.ownerKey : null);
  }, []);
  const clearHover = useCallback(() => setHoveredKey(null), []);

  // F9 T-MOUSE Task 6 — THE SELECTION STATE. A mutable ref, not React state: `mouse/selection.ts`'s own
  // functions (`startSelection`/`dragTo`/`multiClick`) MUTATE their `SelectionState` argument in place and
  // return void, so there is no new object for a `useState` setter to receive — exactly the shape
  // `tapAnchorRef` (ChatApp) already uses for the identical reason. `selectedSpans` re-reads this ref EVERY
  // render against THAT render's own `hit.current.rows` (below), never a stale copy — a window that
  // scrolled or re-wrapped between two mouse events must not paint a span against rows no longer on screen.
  //   `paintTick` is the one thing that turns a ref mutation — made from a stdin listener, outside React —
  // into a repaint: the state itself lives in the ref, so React has no other way to learn it changed. This is
  // the same problem `hoveredKey`'s `useState` solves for hover; selection needs its own trigger because the
  // VALUE React would otherwise track is sitting outside React entirely.
  const selectionStateRef = useRef<SelectionState>(createSelectionState());
  // F10 S4c — REMAP, NOT CLEAR. F9 addressed a selection by NUMERIC INDEX into `hit.current.rows` and
  // cleared it whenever the itemKey at that index changed on a later publish (final-review finding 7: "never
  // wrong, sometimes just gone"). Canon does the opposite trade: it translates the screen coordinates by the
  // renderer's own scroll delta and never clears (`C0p`/`k0p`), which survives a scroll but MISPOINTS the
  // instant content changes without one — an insert above a non-sticky viewport, a fold toggling, a re-wrap.
  // ccx has what canon does not: the whole document in memory with durable per-item ids, so an endpoint can
  // name CHARACTER IDENTITY (an item and a source-text offset, `mouse/address.ts`'s `SelectionEndpoint`)
  // instead of screen geometry — a re-wrap, an insert above, or a fold toggle all become non-events by
  // construction, and only an item actually LEAVING the document is still a clear. This ref holds the
  // addresses recorded at the moment the selection was last set or extended (mouse gesture here; Task 7 adds
  // keyboard extends) — `null` when there is no live selection at all.
  //   THE REMAP RUNS DURING RENDER, immediately below where `hit.current.rows` is (re)built each publish, for
  // the same reason the hover-staleness check beside it does: an effect would paint one wrong frame at the
  // old (or cleared) position before correcting itself on the next tick, which is visible as a highlight
  // flash or a mis-copy race. `remapSelection` (`mouse/address.ts`) is idempotent against an unchanged
  // window — the same rows and the same addresses always relocate to the same cells — so re-running it every
  // render, gesture or not, costs a lookup and never drifts the paint from the record.
  const selectionAddrRef = useRef<SelectionAddresses | null>(null);
  // `"offscreen"`'s own half of the contract (`mouse/address.ts`'s `remapSelection` doc): both ends off the
  // SAME edge retains the address but must paint and copy NOTHING — `remapSelection` deliberately leaves
  // `SelectionState` untouched in that case (there is nothing sane to write: the item is not in the window
  // at all), so this ref is what stops the STALE cell coordinates left over from the last "ok" resolution
  // from being read as if they still named something on the current screen. Set during the remap below (a
  // ref, not a render-local, because `selectedText` is an imperative read from outside React and needs the
  // LATEST render's verdict, matching every other ref this file threads through a stable callback).
  const selectionOffscreenRef = useRef(false);
  const [, setPaintTick] = useState(0);
  const repaint = useCallback(() => setPaintTick((n) => n + 1), []);
  // `hit.current.top` is read at CALL TIME, not at the time this closure was created — `hit` is a stable ref
  // across the component's whole life, so every one of the callbacks below sees the LATEST frame's origin
  // regardless of which render's closure ends up being the one `useImperativeHandle` still holds.
  const cellAt = (col: number, row: number): Cell | undefined => {
    const { top } = hit.current;
    return top <= 0 ? undefined : { row: row - top + 1, col };
  };
  /** Gesture-time write (S4). One `sourceEndpointAt` per live cell: the grapheme's absolute source start
   *  AND its real exclusive end, so the read side can choose per document order which of the two a given
   *  endpoint contributes. Recorded for `anchor`, `focus` and `anchorSpan.lo` — every one of those is a RAW,
   *  INCLUSIVE column (a real click, or `wordSpan`/`lineSpan`'s own leading edge), so the grapheme AT `col`
   *  really is the one the gesture named. */
  const endpointAt = (cell: Cell | null): SelectionEndpoint | null => {
    if (!cell) return null;
    const row = hit.current.rows[cell.row - 1];
    if (!row) return null;
    const { charOffset, charEnd } = sourceEndpointAt(row, cell.col);
    return { itemKey: row.itemKey, charOffset, charEnd };
  };
  /** `anchorSpan.hi` ALONE needs the other reading. `wordSpan`/`lineSpan` (`mouse/selection.ts`) hand back an
   *  EXCLUSIVE column — one PAST the last included grapheme, e.g. the space right after a selected word —
   *  matching `selectedSpans`' pivoted branch, which consumes it directly with no re-snap. `sourceEndpointAt`
   *  is built for a RAW click and answers "what grapheme is AT this column": fed that excluded space, it
   *  hands back the SPACE's own bounds, and recording its `charEnd` (one past the space) rather than its
   *  `charOffset` (the space's own start — exactly the boundary `wordSpan` meant) bakes the extra grapheme
   *  into the address permanently. Caught by `selectionPaint.test.tsx`'s T6(f)/(j): a double-click's word
   *  span, once it rode through one repaint of this remap, painted `"select "` — the trailing space too. */
  const endpointAtExclusive = (cell: Cell | null): SelectionEndpoint | null => {
    if (!cell) return null;
    const row = hit.current.rows[cell.row - 1];
    if (!row) return null;
    const { charOffset } = sourceEndpointAt(row, cell.col);
    return { itemKey: row.itemKey, charOffset, charEnd: charOffset };
  };
  // EVERY mutation of `SelectionState` calls this, not just the mouse ones — Task 7's keyboard extends
  // included. An address left over from the last mouse event is a stale address, and the very next repaint
  // remaps from it and undoes the move. `anchor` failing to resolve — `cellAt` only bounds-checks the
  // frame's `top`, not the row against `hit.current.rows.length` (review finding P2), so a press below the
  // painted transcript (a composer/dock row) reaches here with an out-of-range `Cell` — must therefore
  // CLEAR the record rather than leave it: leaving the previous address on record is exactly what let the
  // next render's remap (below) restore the OLD selection over the fresh, unresolvable press, which
  // `hasSelection()` then reads as "still sweeping" and a real caller (ChatApp's mouse-up) swallows the
  // composer click that should have gone through.
  const recordSelectionAddresses = (): void => {
    const s = selectionStateRef.current;
    const anchor = endpointAt(s.anchor);
    if (!anchor) { selectionAddrRef.current = null; return; }
    const focus = endpointAt(s.focus);
    const spanLo = s.anchorSpan ? endpointAt(s.anchorSpan.lo) : null;
    const spanHi = s.anchorSpan ? endpointAtExclusive(s.anchorSpan.hi) : null;
    const span = spanLo && spanHi ? { lo: spanLo, hi: spanHi, kind: s.anchorSpan!.kind } : null;
    selectionAddrRef.current = { anchor, focus, span };
  };
  /** F10 S6 — the auto-scroll tick's OWN, narrower address update: only `focus` moved. The general
   *  `recordSelectionAddresses` above re-derives EVERY endpoint from its numeric `SelectionState` cell — the
   *  right thing for a real mouse event, where the anchor's cell still names whatever row the gesture
   *  actually started on. Mid-auto-scroll that is no longer true: the render-time remap (below) has already
   *  rewritten `state.anchor` to a VIRTUAL, clamped cell (row 1 or the window's last row) the moment the
   *  anchor's own item scrolls off the window, and `endpointAt` has no notion of "virtual" — it would read
   *  whatever REAL row now happens to sit at that clamped position and silently rebind the anchor's address
   *  to it, dragging the recorded start of the sweep forward with the window instead of leaving it exactly
   *  where the press landed (measured: without this, a hold long enough to scroll the anchor's own row off
   *  screen loses everything before the CURRENT window from the copy, the opposite of what auto-scroll
   *  capture exists for). `anchor`/`span` are carried over UNCHANGED from the address already on record. */
  const recordAutoScrollFocus = (): void => {
    const prev = selectionAddrRef.current;
    if (!prev) return;
    const focus = endpointAt(selectionStateRef.current.focus);
    if (focus) selectionAddrRef.current = { ...prev, focus };
  };
  // ── F10 S6 — AUTO-SCROLL ON DRAG (canon's `Epo`/`sNw`, L551475-551561) ──────────────────────────────
  // Canon's constants, verbatim (L551562): two rows a tick, a tick every 50 ms, 200 ticks maximum. The cap
  // is the second belt — the first is that every path out of a drag clears the timer — because a timer that
  // outlives the gesture re-scrolls the transcript under an idle reader.
  const autoScrollRef = useRef<{ timer: ReturnType<typeof setInterval>; dir: -1 | 1; ticks: number; col: number } | null>(null);
  const stopAutoScroll = useCallback(() => {
    const live = autoScrollRef.current;
    if (live) { clearInterval(live.timer); autoScrollRef.current = null; }
  }, []);
  useEffect(() => stopAutoScroll, [stopAutoScroll]);
  const startAutoScroll = useCallback((dir: -1 | 1, col: number) => {
    const live = autoScrollRef.current;
    if (live?.dir === dir) { live.col = col; return; }          // canon's latch: same direction keeps going
    stopAutoScroll();
    const entry = { dir, ticks: 0, col, timer: setInterval(() => {
      const before = anchorRef.current.offset;
      for (let i = 0; i < AUTOSCROLL_ROWS; i++) scroll(PAGER_ACTIONS[dir < 0 ? "scroll:lineUp" : "scroll:lineDown"]!);
      entry.ticks += 1;
      // Re-apply the drag at the CLAMPED edge so the focus keeps tracking the pointer that is no longer
      // over a row. The row count is this frame's; it does not change under a scroll.
      const edgeRow = dir < 0 ? 1 : Math.max(1, hit.current.rows.length);
      dragTo(selectionStateRef.current, { row: edgeRow, col: entry.col });
      recordAutoScrollFocus();
      repaint();
      if (entry.ticks >= AUTOSCROLL_MAX_TICKS || anchorRef.current.offset === before) stopAutoScroll();
    }, AUTOSCROLL_MS) };
    autoScrollRef.current = entry;
  }, [scroll, repaint, stopAutoScroll]);
  const startSelectionAt = useCallback((col: number, row: number) => {
    const cell = cellAt(col, row);
    if (!cell) return;
    startSelection(selectionStateRef.current, cell);
    recordSelectionAddresses();
    repaint();
  }, [repaint]);
  const dragSelectionTo = useCallback((col: number, row: number) => {
    const cell = cellAt(col, row);
    if (!cell) return;
    // F10 S2 — canon's own dispatch (L203468-203475): a drag while a multi-click span is live extends by
    // WORDS (or whole rows), pivoting on that span; anything else is the plain two-endpoint drag.
    if (selectionStateRef.current.anchorSpan) dragToSpanned(selectionStateRef.current, cell, hit.current.rows);
    else dragTo(selectionStateRef.current, cell);
    recordSelectionAddresses();
    repaint();
    // F10 S6 — canon's `sNw` (L551551-551561): a direction only while the ANCHOR is inside the window and
    // the focus is outside it. `cellAt` happily answers for a row past either end — that out-of-window
    // signal has reached this function since F9 and nothing acted on it.
    const anchor = selectionStateRef.current.anchor;
    const inside = anchor !== null && anchor.row >= 1 && anchor.row <= hit.current.rows.length;
    const dir = cell.row < 1 ? -1 : cell.row > hit.current.rows.length ? 1 : 0;
    if (inside && dir !== 0) startAutoScroll(dir, cell.col); else stopAutoScroll();
  }, [repaint, startAutoScroll, stopAutoScroll]);
  const multiClickSelectionAt = useCallback((col: number, row: number, count: 2 | 3) => {
    const { top, rows: painted } = hit.current;
    if (top <= 0) return;
    const rowIndex = row - top;
    const hitRow = painted[rowIndex];
    if (!hitRow) return;
    multiClick(selectionStateRef.current, { row: rowIndex + 1, col }, count, hitRow);
    recordSelectionAddresses();
    repaint();
  }, [repaint]);
  const endSelectionDrag = useCallback(() => { selectionStateRef.current.isDragging = false; stopAutoScroll(); }, [stopAutoScroll]);
  const hasSelectionHandle = useCallback(() => computeHasSelection(selectionStateRef.current), []);
  const discardSelection = useCallback(() => {
    const s = selectionStateRef.current;
    s.anchor = null; s.focus = null; s.isDragging = false; s.anchorSpan = null;
    selectionAddrRef.current = null;
    stopAutoScroll();
    repaint();
  }, [repaint, stopAutoScroll]);
  // F10 S6 — the copy latch's read now walks the DOCUMENT, not the painted window: an auto-scrolled sweep
  // (above) can carry the focus past rows this frame no longer paints, and S4's durable addresses are
  // exactly what makes their content still reachable. `selectionOffscreenRef`'s window-clamped "paint
  // nothing" verdict is deliberately NOT consulted here — it answers "is this on screen", which is no
  // longer the question copy asks. Called on demand (release, Ctrl+C) rather than cached: one document wrap
  // per copy, never per frame, matching `docRef`'s own header. */
  const selectedText = useCallback(() => {
    const addrs = selectionAddrRef.current;
    if (!addrs) return "";
    const { items: docItems, columns: docCols, total: docTotal } = docRef.current;
    const { slices } = pageItemSlices(docItems, 0, docTotal);
    return documentSelectionText(hitRowsOf(slices, docCols), addrs, (k) => ordinalsRef.current.get(k));
  }, []);
  /** F10 S5 — the wrapper every extend chord goes through. Three things, in this order, and the middle one
   *  is the one the first draft of this plan omitted: move the focus, RE-RECORD the durable addresses, then
   *  repaint. `recordSelectionAddresses` (Task 6) is not a mouse-path detail — it is how `SelectionState`
   *  and the address ref stay the same selection. Skip it and the remap that runs during the very next
   *  render restores the pre-extend endpoints from the stale mouse-era address, so the chord looks
   *  ineffective, or works until the first rewrap/scroll and then snaps back.
   *    Returns the mover's own `false` unchanged, so a caller that wants to fall through still can.
   *
   *  F10 S6 (Task 7 step 7.9, shipped once S4 AND S6 both landed) — canon's `S()` wrapper
   *  (L551745-551761): an up/down extend that would leave the WINDOW (not the document) scrolls by ONE row
   *  first and keeps the focus at that same clamped row, letting S4's remap — which `scroll()` below
   *  already triggers, being a synchronous render (S6's own auto-scroll driver relies on the identical
   *  fact) — carry the endpoint onto whatever now paints there. `from` mirrors `moveSelectionFocus`'s own
   *  "where a span downgrades to" (`E0p`): a live span's `hi` end, otherwise the plain focus-or-anchor. */
  const moveFocus = useCallback((dir: ExtendDir): boolean => {
    const s = selectionStateRef.current;
    const rows = hit.current.rows;
    const from = s.anchorSpan ? s.anchorSpan.hi : (s.focus ?? s.anchor);
    const atWindowEdge = from !== null && rows.length > 0 &&
      ((dir === "up" && from.row <= 1) || (dir === "down" && from.row >= rows.length));
    if (atWindowEdge) {
      const before = anchorRef.current.offset;
      scroll(PAGER_ACTIONS[dir === "up" ? "scroll:lineUp" : "scroll:lineDown"]!);
      if (anchorRef.current.offset !== before) {
        // The window shifted by exactly one row. The downgrade `moveSelectionFocus` itself performs
        // (`E0p`) is transcribed here so this arm leaves the SAME two-endpoint shape an ordinary
        // (non-edge) extend would, then the focus is re-applied at the SAME clamped row/col `from` already
        // named (S4's remap, already run by `scroll()` above, is what makes that row now the newly
        // revealed content rather than whatever `from` used to point at).
        const prevAddr = selectionAddrRef.current;
        if (s.anchorSpan) { const span = s.anchorSpan; s.anchor = span.lo; s.anchorSpan = null; }
        s.focus = { row: from.row, col: from.col };
        // `recordAutoScrollFocus`'s own reasoning applies here verbatim: only FOCUS is freshly re-derived
        // from the (now post-scroll) row content — the anchor's address is carried over UNCHANGED, reusing
        // the span's own STORED `lo` address directly when downgrading rather than re-deriving it from a
        // numeric cell the remap may already have clamped to a virtual position (`endpointAt` has no
        // notion of "virtual" and would misread whatever real row now sits there).
        const focusAddr = endpointAt(s.focus);
        if (prevAddr && focusAddr)
          selectionAddrRef.current = { anchor: prevAddr.span ? prevAddr.span.lo : prevAddr.anchor, focus: focusAddr, span: null };
        repaint();
        return true;
      }
      // Already at the document's own edge — nothing to scroll into. Fall through to `moveSelectionFocus`,
      // which returns `false` for the identical "nowhere to go" reason.
    }
    if (!moveSelectionFocus(s, dir, rows)) return false;
    recordSelectionAddresses();
    repaint();
    return true;
  }, [repaint, scroll]);

  useImperativeHandle(hitmapRef, () => ({
    anchorAt, clickTargetAt, hoverAt, clearHover,
    startSelectionAt, dragSelectionTo, multiClickSelectionAt, endSelectionDrag, hasSelection: hasSelectionHandle, discardSelection, selectedText,
    moveSelectionFocus: moveFocus,
  }), [anchorAt, clickTargetAt, hoverAt, clearHover, startSelectionAt, dragSelectionTo, multiClickSelectionAt, endSelectionDrag, hasSelectionHandle, discardSelection, selectedText, moveFocus]);

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
  // F10 S5 — computed DURING render, off the same ref the paint already derives its own answer from
  // (`paintSpans` below): "will this render show a highlight" and "should the six extend chords be live"
  // are the same question. Every selection mutation calls `repaint()`, so this render (and therefore this
  // memo) is re-run whenever the answer changes.
  const selectionLive = computeHasSelection(selectionStateRef.current);
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
    // F10 S5 — registered only while a selection is live, which IS the fall-through: `KeymapProvider`
    // (:177-180) hands a matched action with no handler to the composer, exactly as `scroll:dumpTranscript`
    // relies on while the jump pill is down. Canon reaches the same place from the other side — its
    // handlers return false with no selection (L551746).
    ...(selectionLive ? {
      "selection:extendLeft": () => { moveFocus("left"); },
      "selection:extendRight": () => { moveFocus("right"); },
      "selection:extendUp": () => { moveFocus("up"); },
      "selection:extendDown": () => { moveFocus("down"); },
      "selection:extendLineStart": () => { moveFocus("lineStart"); },
      "selection:extendLineEnd": () => { moveFocus("lineEnd"); },
    } : {}),
  }), [scroll, stickBottom, showPill, onDumpTranscript, onWheelTick, selectionLive, moveFocus]));

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
  //   PILL ROW, DETERMINISTIC RATHER THAN MEASURED (F10 T-HOVER): `showPill` is only true while the window is
  // FULL (not sticky and not at the end, so there is content below), `body` is `height - 1` in exactly that
  // case, and the pill paints directly after the slices — so its row is `regionTop + body` whenever it is up.
  // T-CLICKGATE Task 2 — `clickableOwners` built ALONGSIDE `rows` here, once per paint (never inside
  // `hoverAt`, which runs on every mouse-move tick): off the very array just published, so it can never
  // describe a frame other than the one on screen, exactly as `rows` itself cannot.
  const paintedRows = hitmapRef ? hitRowsOf(slices, columns) : NO_HIT_ROWS;
  hit.current = { top: regionTop, rows: paintedRows, pillRow: showPill && regionTop > 0 ? regionTop + body : 0,
    clickableOwners: hitmapRef ? clickableOwnersOf(paintedRows) : NO_CLICKABLE_OWNERS };
  // F9 T-MOUSE Task 3 — a repaint that no longer paints the hovered cluster (it scrolled off, its fold state
  // flipped, the document swapped under a session resume) must not leave a stale key haunting a cell that now
  // belongs to something else, or nothing. Checked against THIS render's own rows, never a stale copy, and
  // applied DURING render for the same reason `settled`/`anchor` above are (:274) — an effect would paint one
  // frame with a hover nothing on screen answers to before correcting itself.
  //   F10 T-HOVER: compared against OWNERS now, and the pill's own key is never cleared by "not a painted
  // row" (it never is one) — only by the pill itself going away.
  if (hoveredKey !== null && hoveredKey !== PILL_HOVER_KEY && !hit.current.rows.some((row) => row.ownerKey === hoveredKey)) setHoveredKey(null);
  if (hoveredKey === PILL_HOVER_KEY && hit.current.pillRow === 0) setHoveredKey(null);

  // F10 S4c — REMAP, NOT CLEAR (see `selectionAddrRef`'s own header). Ordered by document position first
  // (never by the anchor/focus role), the lower endpoint contributing its grapheme's start and the upper its
  // grapheme's end, so a backward drag and a forward one over the same characters produce the identical
  // half-open range. Applied DURING render for the reason the hover check above is: an effect would paint
  // one wrong frame.
  if (selectionAddrRef.current) {
    const addrs = selectionAddrRef.current;
    const first = ordinals.get(hit.current.rows[0]?.itemKey ?? "") ?? 0;
    const last = ordinals.get(hit.current.rows[hit.current.rows.length - 1]?.itemKey ?? "") ?? first;
    const remapped = remapSelection(selectionStateRef.current, addrs, hit.current.rows,
      (k) => ordinals.get(k), { first, last });
    // `"gone"` — the itemKey left the DOCUMENT entirely (a fold collapse, a session swap): `remapSelection`
    // already nulled `state.anchor`/`focus`/`anchorSpan`, matching exactly what F9's clear did; only the
    // address record itself is this component's own to drop.
    if (remapped === "gone") selectionAddrRef.current = null;
    // `"offscreen"` — both ends off the SAME edge (canon's `ELt`, L198855-198860): retain, paint nothing,
    // copy nothing. `remapSelection` leaves `state` untouched here, so the flag below is what keeps
    // `paintSpans`/`selectedText` from reading those stale cell coordinates as if they still named a row in
    // THIS render's window.
    selectionOffscreenRef.current = remapped === "offscreen";
  } else {
    selectionOffscreenRef.current = false;
  }

  // F9 T-MOUSE Task 6 — SELECTION PAINT. `selectedSpans` reads exactly the rows array just published above —
  // the region-bounds scope `selection.ts` documents ("every row this module ever sees IS the region") — so
  // a span can never describe a row this frame did not paint, even mid-drag while the window is scrolling.
  // Off `hitmapRef` (classic, or any test that does not care) `hit.current.rows` is `NO_HIT_ROWS` and
  // `selectedSpans` answers `[]` against it, same as an idle selection would.
  const paintSpans: readonly RowSpan[] = selectionOffscreenRef.current ? [] : selectedSpans(selectionStateRef.current, hit.current.rows);
  const spanByRow = paintSpans.length ? new Map(paintSpans.map((s) => [s.row - 1, s] as const)) : EMPTY_SPAN_MAP;
  // One entry per SLICE, parallel to `slices` below — the per-ROW selection (if any) for the physical rows
  // that one slice paints, in the SAME order `hitRowsOf` flattened them: a `"line"` slice contributes one
  // row, a `"gutter-block"` slice contributes `end - start` (its own body-row count) — exactly the counts
  // `hitRowsOf`'s own loop pushes, so `rowCursor` walks the flattened array in lock-step with `slices`. This
  // is what lets a drag that only touches SOME of a multi-row tool result's body highlight exactly those
  // rows, and none of the ones above or below it in the same block.
  let rowCursor = 0;
  const sliceSelections: readonly (readonly (LineSelection | undefined)[] | undefined)[] = spanByRow.size === 0
    ? slices.map(() => undefined)
    : slices.map((s) => {
        const rowCount = s.item.kind === "line" ? 1 : s.end - s.start;
        const entries: (LineSelection | undefined)[] = [];
        for (let k = 0; k < rowCount; k++) {
          const row = hit.current.rows[rowCursor + k];
          const span = spanByRow.get(rowCursor + k);
          entries.push(row && span ? charRangeOf(row, span) ?? undefined : undefined);
        }
        rowCursor += rowCount;
        return entries.some((e) => e !== undefined) ? entries : undefined;
      });
  // Keyed by item id AND slice index: one item can contribute at most one slice to a window, but the index
  // keeps the key stable when the same block is re-sliced at a different offset.
  return <>
    {slices.map((s, i) => (
      // F9 T-MOUSE Task 3 — every slice gets a Provider (even `false` ones): the row list `hit.current` was
      // just built from is per-SLICE (one `itemKey` per item, `hitRowsOf`), so the hovered flag is exactly as
      // granular as a slice already is — no finer test is possible without the layout tree canon has and ccx
      // does not (R1's structural premise).
      //   `!s.item.expanded` (review Critical fix): canon's own provider is `hovered && !expanded` (bundle
      // L562783), not `hovered` alone — an already-expanded cluster member (`toolRenderer.tsx`'s
      // `expandedMemberItems`, which tags every item it produces `expanded: true`) must do nothing on hover,
      // dim included, whether or not THIS particular member happens to carry dim/banded content.
      //   F10 T-HOVER: compared against the slice's OWN owner (`item.ownerKey ?? sourceId(item.id)`) rather
      // than `sourceId(item.id)` alone — the hover unit is the whole message/call `ownerKey` names, not this
      // one item, so every slice sharing that owner lights up together.
      <HoverContext.Provider key={`${s.item.id}:${i}`} value={hoveredKey !== null && (s.item.ownerKey ?? sourceId(s.item.id)) === hoveredKey && s.item.expanded !== true}>
        <RenderItemView item={s.item} start={s.start} end={s.end} showGutter={s.showGutter} rowSelections={sliceSelections[i]} />
      </HoverContext.Provider>
    ))}
    {/* AMENDMENT 2: the pill names `v` exactly when `v` is registered above — one derivation, `showPill &&
        onDumpTranscript`, read twice, so the affordance and the key cannot drift apart. `editorDisplayName`
        answers null with neither `$VISUAL` nor `$EDITOR` set, where canon prints its bare `open in editor`.
        F10 T-HOVER: the pill owns its own hover band now (`JumpPill.tsx`) — this Provider is its only wiring. */}
    {showPill ? <HoverContext.Provider value={hoveredKey === PILL_HOVER_KEY}>
      <JumpPill newRows={Math.max(0, total - stickyTotal.current)} columns={columns}
        {...(onDumpTranscript ? { dumpEditor: editorDisplayName() ?? "editor" } : {})} />
    </HoverContext.Provider> : null}
  </>;
}
