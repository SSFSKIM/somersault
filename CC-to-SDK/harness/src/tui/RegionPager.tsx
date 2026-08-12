// tui/RegionPager.tsx — the Ctrl-O transcript pager, sized to the fullscreen frame's REGION (FSW Task 11).
//
// THE PAGER DOES NOT MOVE, ITS SLOT DOES. On the main screen `TranscriptPager` renders in the composer's slot
// at the bottom of the tree, because the transcript above it is in the terminal's scrollback and the pager is
// an overlay over the live rows only. On the alternate screen there is no scrollback: the REGION is the
// transcript, so the pager replaces it there and the dock (footer, panels) stays where it is.
//
// THE BUDGET IS THE GRANT, NOT THE TERMINAL. `TranscriptPager`'s default is `max(8, stdout.rows − 10)` — a
// guess at the terminal made before the frame existed. Inside the frame the terminal's rows are not the
// pager's to spend: the dock has already taken its share and the region was GRANTED what is left
// (`useRegionRows`, measured by the frame). So the body budget is `grant − chrome`, and computing that chrome
// honestly is the whole of what this component adds.
//
// CHROME IS A FUNCTION OF WIDTH, which is why this takes `columns`. Two rows of rounded border and the title
// row are fixed; the KEY-HINT row is not — it is about a hundred columns wide and wraps to two rows on an
// 80- or 100-column terminal, i.e. on every terminal anyone actually uses. A flat guess of four cost exactly
// one row, and the failure was not a blank line: Yoga shrank the bordered box by one, Ink composited the
// title and the first body row onto the same output line, and the pager's header read `T167script`.
//
// TWO GUARDS, because a width-derived estimate is an estimate. `flexShrink={0}` on the pager keeps Yoga from
// ever squeezing it into that overlap again — if the estimate is short the box stays its natural height and
// OVERFLOWS — and the fixed-height clip box then takes the overflow the way the frame takes its own, so the
// worst case is a clipped hint row rather than a garbled one and the region still emits exactly `grant` rows
// (the frame's L180317 diagnostic stays silent, which it would not if the region grew).
import React from "react";
import { Box } from "ink";
import stringWidth from "string-width";
import { TranscriptPager, pagerHint, type TranscriptPagerProps } from "./TranscriptPager.js";
import { useRegionRows } from "./FullscreenFrame.js";

/** The pager's own frame: two border rows plus the title row. */
export const PAGER_FIXED_CHROME = 3;
/** Border (2) + horizontal padding (2) — what the border box takes off `columns` before its text is laid out. */
const PAGER_INSET = 4;

/** How many rows the pager spends on itself before a single transcript row, at this width. Word wrapping can
 *  need one more row than the division says on an unlucky break; that lands on the clip above rather than on
 *  the transcript, which is the direction that keeps the region inside its grant. */
export function pagerChromeRows(columns: number): number {
  const inner = Math.max(1, columns - PAGER_INSET);
  return PAGER_FIXED_CHROME + Math.max(1, Math.ceil(stringWidth(pagerHint("detail-all")) / inner));
}

export interface RegionPagerProps extends Omit<TranscriptPagerProps, "height"> {
  /** The region's width — the frame is full-bleed, so this is the terminal's. */
  columns: number;
}

export function RegionPager({ columns, ...props }: RegionPagerProps): React.ReactElement {
  const rows = useRegionRows();
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      <Box flexDirection="column" flexShrink={0}>
        <TranscriptPager {...props} height={Math.max(1, rows - pagerChromeRows(columns))} />
      </Box>
    </Box>
  );
}
