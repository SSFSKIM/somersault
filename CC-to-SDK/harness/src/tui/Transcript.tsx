// tui/src/Transcript.tsx — append-only scrollback (Static) + the transient live region. After F1 Task 4
// every row is a `RenderItem` produced by the ONE projection over the retained `TranscriptDocument`:
// `staticItems` are finalized and published exactly once, `windowItems` are finalized rows still awaiting
// publication (FSW Task 3's live window — see below), `pendingItems` are open tool calls (never in Static),
// and `streaming` is the in-flight partial text/thinking snapshot. Nothing here reconstructs a source row
// from display text, and the 600 ms running blink only ever touches the transient region.
import React from "react";
import { Box, Static } from "ink";
import type { RenderLine } from "./render.js";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { Line } from "./Line.js";

export { Line } from "./Line.js";

/** FSW Task 3 — `windowItems` is the LIVE WINDOW: finalized items that have not been committed to Static
 *  yet, re-selected by the caller on every render at the terminal's current geometry. They render in the
 *  ordinary (re-rendered) subtree, between the frozen scrollback and the transient region, which is exactly
 *  where they belong in reading order — and being re-rendered is the whole point: these are the rows that
 *  re-wrap when the terminal's width changes. Defaulted to empty so a surface that has no window (the
 *  projection-parity harnesses, and any caller that only wants Static) composes unchanged. */
const NO_WINDOW: readonly RenderItem[] = [];

/** The three re-rendered regions — everything above except `<Static>` — as a fragment (a fragment adds no Yoga
 *  node, so `Transcript` below composes exactly as it did). Extracted by FSW Task 9 for the fullscreen shell;
 *  Task 10 replaced that use with `FullscreenViewport`, because a renderer with no scrollback cannot show only
 *  the newest tier of a three-tier document. This is now the MAIN SCREEN's transient half and nothing else. */
export function LiveRegion({ windowItems = NO_WINDOW, pendingItems, streaming }: { windowItems?: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: readonly RenderLine[] }) {
  return (
    <>
      {windowItems.map((item) => <RenderItemView key={item.id} item={item} />)}
      {pendingItems.map((item) => <RenderItemView key={item.id} item={item} />)}
      {streaming.map((l, i) => <Line key={`s${i}`} l={l} />)}
    </>
  );
}

export function Transcript({ staticItems, windowItems = NO_WINDOW, pendingItems, streaming }: { staticItems: readonly RenderItem[]; windowItems?: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: readonly RenderLine[] }) {
  return (
    <Box flexDirection="column">
      <Static items={staticItems as RenderItem[]}>{(item) => <RenderItemView key={item.id} item={item} />}</Static>
      <LiveRegion windowItems={windowItems} pendingItems={pendingItems} streaming={streaming} />
    </Box>
  );
}
