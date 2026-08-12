// tui/FullscreenFrame.tsx — THE FIXED-HEIGHT SHELL of the alternate-screen renderer (FSW Task 9, spec §A4/§A4a).
//
// The main screen and this one disagree about what a frame IS. There, the tree is as tall as its content and the
// damage is repaired afterwards — the park, the frame corrector, the resize repaint, the reflow oracle, the
// tall-branch resync. Here the tree gets a BUDGET and whatever does not fit is clipped, which is what makes the
// whole Wave-R correction stack unnecessary rather than merely disabled (spec §A2a): a frame that is always
// `rows − 1` rows can never take Ink's `outputHeight >= stdout.rows` branch, so there is no residue to correct
// — for `rows ≥ 2`, which is the bound `frameHeight`'s floor puts on the claim (see there; measured).
//
// WHY `rows − 1` AND NOT `rows` — the recorded divergence. Ink paints through log-update, which terminates every
// frame with a trailing `'\n'` (log-update.js:12). Writing into the last cell of the last row and then a newline
// SCROLLS the alternate screen, which moves every row the next erase is measured against; the frame stops being
// fixed and the renderer's one invariant is gone. Canon buys the same slack from the other end —
// `viewport.height = altScreen ? rows + 1 : rows` (bundle L180330), and `resetFramesForAltScreen` (L181086) uses
// the same `+ 1` — so that nothing ever believes the frame exactly fills the viewport. Ours is one row shorter
// instead: the dock's last row is `rows − 1` and the park row lives beneath it.
//
// THE OVERFLOW RULE IS CANON'S, INCLUDING ITS OPINION. At L180316-180318 a Yoga height greater than the terminal
// is not clamped-and-forgotten but named as a bug in the CALLER — "something is rendering outside
// <AlternateScreen>. Overflow clipped." — and then clipped. `onOverflow` is that diagnostic. It reports rather
// than repairs on purpose: growing the frame is the one response that breaks the invariant above, and silently
// clipping is how a region that has quietly stopped showing its last rows goes unnoticed for a release.
//   ITS SCOPE IS THE REGION, WHICH IS NARROWER THAN CANON'S — say so rather than let a reader assume parity.
// L180318 measures the WHOLE tree against `terminalRows`; this measures the region's content against the
// region's own budget. Finer (it names which slot overspent, and it fires while the frame as a whole still
// fits) but narrower: a dock that overruns its cap — T13's tall dialog is the case that will arrive — is
// clipped by the frame with nothing said. A second measurement on the dock box is the fix when that lands;
// until then the dock's clip is silent on the debug seam by construction, not by oversight.
//   THE THREE CLIPS ARE NOT EQUALLY LOAD-BEARING. Only the region's is: it is what turns overlong content into
// a clip instead of a shove, and removing it reddens the I9a case. The root's and the dock's are DEFENSIVE —
// measured on both instruments (`ink-testing-library` and real Ink through `helpers/fakeTty`), removing either
// leaves the painted bytes identical, because Ink allocates its `Output` buffer at the root's computed height
// and truncates anything past it before a byte is written. They are kept because that truncation is Ink's
// implementation detail and this frame's budget is a contract; they are deliberately left unpinned, since a
// test asserting them would be asserting the absence of a difference no instrument can see.
//
// THE CONTAINER SHAPE IS THE PRODUCT, not the children. T10 replaces `regionChildren` with the virtualized
// viewport, T13 adds the two overlay slots (the absolute-bottom seam and the dock replacement), and M4's
// `/resume` launcher mounts this same component with a different dock — so the props are a region and a dock
// from day one, and this file knows nothing about transcripts.
import React, { useEffect, useRef } from "react";
import { Box, measureElement, type DOMElement } from "ink";

/** The park row: the one physical row of the terminal the frame deliberately does not own. */
export const PARK_ROW = 1;

/** Total frame height. Floored at 1 — a one-row terminal is a degenerate pane, not a reason to hand Yoga a
 *  height of 0 (which is "auto" to nobody and a crash to some layouts).
 *    THE FLOOR IS WHERE THE HEADER'S "no tall write, ever" CLAIM STOPS. At `rows = 1` the floor wins, the frame
 *  is 1 row, and `1 >= stdout.rows` is exactly the condition of Ink's tall branch — measured: one tall write at
 *  `rows = 1`, none at 2 or 3. The consequence today is nil, and only for the reason the whole shell exists:
 *  with no `<Static>` in the fullscreen tree `fullStaticOutput` is empty, so the tall chunk carries a clear and
 *  nothing to replay. A one-row terminal is therefore harmless rather than handled — and it is one more thing
 *  resting on the no-`<Static>` invariant, which is pinned in `test/tui/fullscreen-frame.test.tsx`. */
export function frameHeight(rows: number): number { return Math.max(1, rows - PARK_ROW); }

/** How many of the frame's rows the dock may take. `floor(rows/2)` is spec §A4's steady-state cap: the composer
 *  can grow, but never past the point where the transcript stops being the thing on screen. History search is
 *  the one surface allowed to own nearly the whole frame (`rows − 2`, canon's cap for the same class of
 *  bottom-anchored picker — grounding §4.3, bundle L455951), because its results ARE the content while it is up.
 *  Clamped into `[1, frameHeight]` so a two-row pane still yields a dock. */
export function dockCap(rows: number, historySearchOpen: boolean): number {
  const cap = historySearchOpen ? rows - 2 : Math.floor(rows / 2);
  return Math.max(1, Math.min(cap, frameHeight(rows)));
}

export interface FullscreenFrameProps {
  /** The terminal's row count — ChatApp's resize state, never `process.stdout.rows` read behind it. */
  rows: number;
  regionChildren: React.ReactNode;
  dock: React.ReactNode;
  historySearchOpen?: boolean;
  /** The L180317 diagnostic. Default writes to stderr only under `CCX_DEBUG`, the same seam and the same reason
   *  `statusLine.ts` has one: an unguarded stderr write lands in the middle of a live frame. */
  onOverflow?: (msg: string) => void;
}

const defaultOverflow = (msg: string): void => { if (process.env.CCX_DEBUG) process.stderr.write(`${msg}\n`); };

export function FullscreenFrame({ rows, regionChildren, dock, historySearchOpen = false, onOverflow }: FullscreenFrameProps) {
  const height = frameHeight(rows);
  const cap = dockCap(rows, historySearchOpen);
  // THE CAP IS EXPRESSED AS THE REGION'S FLOOR, because Yoga has a `maxHeight` and Ink 5.2.1 does not expose it
  // (build/styles.js applies `minHeight` and `height`, nothing else). The two are equivalent inside a
  // fixed-height container: a region that may not shrink below `height − cap` leaves at most `cap` rows for
  // everything under it, whichever way the dock's own content pushes. `flexShrink: 0` on the dock then means the
  // dock never gives rows BACK — it keeps its natural height while it fits and overflows the frame's bottom
  // edge (where the outer clip takes it) when it does not.
  const regionFloor = Math.max(0, height - cap);
  const regionRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const overflowing = useRef(false);
  // Measured, not predicted. `contentRef` is an unshrinkable box, so its computed height is what the children
  // WANTED; `regionRef` is what they were given. An effect is the only place both are true — Yoga has laid out
  // by then — and the latch keeps a standing overflow from repeating the diagnostic on every keystroke.
  useEffect(() => {
    const region = regionRef.current, content = contentRef.current;
    if (!region || !content) return;
    const want = measureElement(content).height, got = measureElement(region).height;
    if (want <= got) { overflowing.current = false; return; }
    if (overflowing.current) return;
    overflowing.current = true;
    (onOverflow ?? defaultOverflow)(`fullscreen frame: region content ${want} rows > region ${got} rows — something is rendering outside the frame's budget. Overflow clipped.`);
  });
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      <Box ref={regionRef} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={regionFloor} overflow="hidden">
        <Box ref={contentRef} flexDirection="column" flexShrink={0}>{regionChildren}</Box>
      </Box>
      <Box flexDirection="column" flexShrink={0} overflow="hidden">{dock}</Box>
    </Box>
  );
}
