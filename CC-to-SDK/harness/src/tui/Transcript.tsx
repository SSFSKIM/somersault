// tui/src/Transcript.tsx — append-only scrollback (Static) + the transient live region. After F1 Task 4
// every row is a `RenderItem` produced by the ONE projection over the retained `TranscriptDocument`:
// `staticItems` are finalized and published exactly once, `pendingItems` are open tool calls (never in
// Static), and `streaming` is the in-flight partial text/thinking snapshot. Nothing here reconstructs a
// source row from display text, and the 600 ms running blink only ever touches the transient region.
import React from "react";
import { Box, Static } from "ink";
import type { RenderLine } from "./render.js";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { Line } from "./Line.js";

export { Line } from "./Line.js";

export function Transcript({ staticItems, pendingItems, streaming }: { staticItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: readonly RenderLine[] }) {
  return (
    <Box flexDirection="column">
      <Static items={staticItems as RenderItem[]}>{(item) => <RenderItemView key={item.id} item={item} />}</Static>
      {pendingItems.map((item) => <RenderItemView key={item.id} item={item} />)}
      {streaming.map((l, i) => <Line key={`s${i}`} l={l} />)}
    </Box>
  );
}
