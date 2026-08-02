// tui/src/TranscriptPager.tsx — the Ctrl-O transcript pager (bundle Transcript context). A bordered
// window over the committed scrollback rendered in the composer slot — NOT an alternate screen:
// unmounting the append-only <Static> would replay the whole scrollback on remount (the Wave-1 Static
// lesson), so the transcript stays mounted above and this is an overlay view (recorded divergence).
// Long lines wrap inside the window, so the box can occasionally run taller than `height` rows —
// height budgets conservatively (rows-10) instead of chasing exact terminal geometry.
import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { RenderItemView, type RenderItem } from "./toolRenderer.js";
import { pagerAction, applyPager, clampOffset } from "./pager.js";
import { ACCENT } from "./theme.js";

export function TranscriptPager({ items, onClose, height }: { items: readonly RenderItem[]; onClose: () => void; height?: number }) {
  const { stdout } = useStdout();
  const h = height ?? Math.max(8, (stdout?.rows ?? 24) - 10);
  const total = items.length;
  const [offset, setOffset] = useState(() => Math.max(0, total - h));   // open at the bottom (most recent)
  const off = clampOffset(offset, total, h);
  useInput((input, key) => {
    const a = pagerAction(input, key);
    if (!a) return;
    if (a.kind === "exit") { onClose(); return; }
    setOffset((o) => applyPager(clampOffset(o, total, h), a, total, h));
  });
  const visible = items.slice(off, off + h);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Transcript <Text dimColor>{total === 0 ? "(empty)" : `lines ${off + 1}–${Math.min(off + h, total)} of ${total}`}</Text></Text>
      {visible.map((item, i) => <RenderItemView key={off + i} item={item} />)}
      <Text dimColor>j/k ↑↓ line · Ctrl-U/D ½page · Ctrl-B/F b/space page · g/G top/bottom · q/Esc close</Text>
    </Box>
  );
}
