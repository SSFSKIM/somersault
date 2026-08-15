// tui/src/TranscriptPager.tsx — the Ctrl-O transcript pager (bundle Transcript context). A bordered
// window over the committed scrollback rendered in the composer slot — NOT an alternate screen:
// unmounting the append-only <Static> would replay the whole scrollback on remount (the Wave-1 Static
// lesson), so the transcript stays mounted above and this is an overlay view (recorded divergence).
// Long lines wrap inside the window, so the box can occasionally run taller than `height` rows —
// height budgets conservatively (rows-10) instead of chasing exact terminal geometry.
//
// F1 Task 5: the pager no longer receives a frozen list. `makeItems` re-derives the view from the ONE
// retained document at the projection it asks for, so Ctrl-E ("transcript:toggleShowAll") is a purely
// LOCAL state flip here — `detail-all` ⇄ `detail-collapsed` — and never a second mutable history mode in
// ChatApp. Scrolling is by physical row (pageItemSlices), so a long result pages through its own body.
//
// F2 Task 7: the pager stopped calling `useInput`. It pushes the `Transcript` context for as long as it is
// mounted — it IS the innermost surface then, so mount-order precedence puts it above everything beneath —
// and registers that context's actions. Two consequences worth stating: `home`/`end` finally work (Ink's
// `useInput` could not tell them from insert or F1–F12, P86 §1.1), and Ctrl-O closing the pager is the
// Transcript context's `transcript:exit`, not a special case in ChatApp's owner gate any more.
// Known window (t7 review): scope registrations unregister in a passive cleanup, so a key arriving in the
// SAME stdin chunk as the close key still resolves to `scroll:*` on the unmounting pager and is dropped —
// the safe direction (dropped, not misrouted), same blind spot Ink's own passive `useInput` always had.
//
// FSW T17 fix round: THE PAGER WINDOWS PAINTED ROWS, NOT LOGICAL ONES. `renderItemHeight` answers 1 for every
// `kind: "line"` item and `renderMarkdown` never wraps prose, so a 207-column paragraph is one line the box
// paints as three. Counted logically, every arithmetic this component does is short by the wrap overflow: the
// clamp stops the reader before the tail, `G` lands above the last rows, the header names rows the box cannot
// reach, and the box itself runs taller than the height it was budgeted (inside `RegionPager` the frame's clip
// then eats the difference, which is how the tail became unreachable rather than merely mispositioned). So the
// projection is put through `wrapItemsToWidth` at this box's INNER width before anything counts it — WRAP
// FIRST, WINDOW SECOND, the same order `FullscreenViewport` and `streamingItems` already keep.
import React, { useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { PAGER_ACTIONS, applyPager, pageItemSlices, type PagerAction } from "./pager.js";
import { remapRowOffset, wrapItemsToWidth } from "./wrapItems.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { ACCENT } from "./theme.js";

/** Border (2) + horizontal padding (2) — what this component's box takes off its column count before Ink lays
 *  a single row of text out inside it. Lives here rather than with `RegionPager`'s other chrome arithmetic
 *  because it is the WRAP width now as well as a budgeting term, and the two must not be allowed to drift. */
export const PAGER_INSET = 4;

export interface TranscriptPagerProps {
  makeItems(projection: "detail-all" | "detail-collapsed"): readonly RenderItem[];
  onClose(): void;
  height?: number;
  /** The width of the slot this pager fills, borders included. Absent — a bare component test — the terminal's
   *  own, which is what the main-screen pager fills anyway; `RegionPager` passes the region's. */
  columns?: number;
}

/** The key-hint row, hoisted out of the JSX so a caller that has to BUDGET for this component can measure it
 *  (FSW T11: `RegionPager` subtracts the pager's chrome from the frame's region grant, and this row is the one
 *  part of that chrome whose height depends on the terminal's width). The two projections produce the same
 *  display width — `collapse` and `show all` are both eight columns — so a measurement taken from either is
 *  valid for both, which is what lets the budget be a function of `columns` alone. */
export const pagerHint = (projection: "detail-all" | "detail-collapsed"): string =>
  `j/k ↑↓ line · Ctrl-U/D ½page · Ctrl-B/F b/space page · g/G top/bottom · Ctrl-E ${projection === "detail-all" ? "collapse" : "show all"} · q/Esc close`;

export function TranscriptPager({ makeItems, onClose, height, columns }: TranscriptPagerProps) {
  const { stdout } = useStdout();
  const h = height ?? Math.max(8, (stdout?.rows ?? 24) - 10);
  const inner = Math.max(1, (columns ?? stdout?.columns ?? 80) - PAGER_INSET);
  // Ctrl-O always opens fully expanded (upstream's transcript starts show-all); Ctrl-E collapses back to the
  // detail view's OWN folded form, whose marker offers "ctrl+e to show all" rather than "ctrl+o to expand".
  const [projection, setProjection] = useState<"detail-all" | "detail-collapsed">("detail-all");
  // Infinity means "the bottom, whatever the current total is" — a toggle changes the physical-row count
  // under us, and clamping (not a stored row number) is what keeps both projections anchored sanely.
  const [offset, setOffset] = useState<number>(() => Number.POSITIVE_INFINITY);
  // The keymap dispatches from a stdin listener the provider attached in a passive effect, so two keys can
  // land in one tick with no render between them — a Ctrl-E followed immediately by G is exactly that. Both
  // scroll inputs therefore read the projection and offset from refs the handler itself updates
  // synchronously, and re-derive the row count from them, rather than closing over the last render's
  // `total`: a G after a same-tick toggle otherwise scrolls to the bottom of the projection it just left.
  const projectionRef = useRef(projection);
  const offsetRef = useRef(offset);
  // State is the single writer: mirroring on every render (not only inside the handler) means a future
  // second setter call site cannot silently desynchronize the same-tick shadow from the rendered state.
  projectionRef.current = projection; offsetRef.current = offset;
  // The ONE route from a projection to rows, so the render and the same-tick scroll handler below can never
  // measure the document at two different widths.
  const rowsOf = (p: "detail-all" | "detail-collapsed") => wrapItemsToWidth(makeItems(p), inner);
  const rows = rowsOf(projection);
  // A WIDTH CHANGE RE-NUMBERS THE ROWS. `offset` is a painted-row index AT THE WIDTH IT WAS MEASURED AT, so a
  // resize renumbers everything below the first item whose wrapped height moved and the same number now names
  // a different document position — the reader is silently carried off the paragraph they were reading. So the
  // held offset is translated by the position it NAMES (`remapRowOffset`, the remedy `FullscreenViewport`
  // already applies on its own width axis) BEFORE anything windows the document, in render rather than an
  // effect: an effect would paint one frame at the old numbering before correcting itself.
  //   Only the WIDTH axis. A projection toggle changes the row count too, but its answer is the clamp (that is
  // what the Infinity sentinel above is for), and the bottom sentinel needs no translation on either axis.
  const measured = useRef({ inner, projection, rows });
  const held = measured.current.inner !== inner && measured.current.projection === projection
    ? remapRowOffset(measured.current.rows, rows, offset) : offset;
  measured.current = { inner, projection, rows };
  // State stays the single writer: the ref mirror is corrected in the same breath as the setter, so the
  // same-tick scroll handler below reads the translated number rather than the one it replaced.
  if (held !== offset) { offsetRef.current = held; setOffset(held); }
  const { slices, offset: off, total } = pageItemSlices(rows, held, h);
  const scroll = (a: PagerAction) => {
    const view = pageItemSlices(rowsOf(projectionRef.current), offsetRef.current, h);
    offsetRef.current = applyPager(view.offset, a, view.total, h);
    setOffset(offsetRef.current);
  };
  useKeyScope("Transcript");
  useKeyActions({
    "transcript:exit": () => onClose(),
    "transcript:toggleShowAll": () => {
      projectionRef.current = projectionRef.current === "detail-all" ? "detail-collapsed" : "detail-all";
      setProjection(projectionRef.current);
    },
    ...Object.fromEntries(Object.entries(PAGER_ACTIONS).map(([action, a]) => [action, () => scroll(a)])),
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Transcript <Text dimColor>{total === 0 ? "(empty)" : `lines ${off + 1}–${Math.min(off + h, total)} of ${total}`}</Text></Text>
      {slices.map((s, i) => <RenderItemView key={`${s.item.id}:${i}`} item={s.item} start={s.start} end={s.end} showGutter={s.showGutter} />)}
      <Text dimColor>{pagerHint(projection)}</Text>
    </Box>
  );
}
