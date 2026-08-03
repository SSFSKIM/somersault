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
import React, { useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { PAGER_ACTIONS, applyPager, pageItemSlices, type PagerAction } from "./pager.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { ACCENT } from "./theme.js";

export interface TranscriptPagerProps { makeItems(projection: "detail-all" | "detail-collapsed"): readonly RenderItem[]; onClose(): void; height?: number }

export function TranscriptPager({ makeItems, onClose, height }: TranscriptPagerProps) {
  const { stdout } = useStdout();
  const h = height ?? Math.max(8, (stdout?.rows ?? 24) - 10);
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
  const items = makeItems(projection);
  const { slices, offset: off, total } = pageItemSlices(items, offset, h);
  const scroll = (a: PagerAction) => {
    const view = pageItemSlices(makeItems(projectionRef.current), offsetRef.current, h);
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
      <Text dimColor>j/k ↑↓ line · Ctrl-U/D ½page · Ctrl-B/F b/space page · g/G top/bottom · Ctrl-E {projection === "detail-all" ? "collapse" : "show all"} · q/Esc close</Text>
    </Box>
  );
}
