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
//   ITS SCOPE IS THE REGION AND THE BOTTOM SLOT, BOTH NARROWER THAN CANON'S — say so rather than let a reader
// assume parity. L180318 measures the WHOLE tree against `terminalRows`; these measure each slot's content
// against that slot's own budget. Finer (they name which slot overspent, and they fire while the frame as a
// whole still fits) but narrower. T13 added the second measurement Task 9 named as owed ("a dock that overruns
// its cap — T13's tall dialog is the case that will arrive — is clipped by the frame with nothing said"), so
// both bands now report.
//   WHAT NEITHER MEASUREMENT CAN SEE, and this is load-bearing for anything mounted inside them (T11, measured):
// the effect below runs when THIS COMPONENT re-renders. A slot mounting or unmounting, a resize, a dock growing
// — all of those re-render the frame, and the diagnostic sees them. A re-render that happens ENTIRELY INSIDE a
// slot's children (the viewport's scroll state, a picker's own list window, a dialog's expand toggle) does not
// reach here at all, so content that grows on that path is clipped by Yoga with nothing said and nothing to
// say it. That is why every slot's occupant must respect its budget BY CONSTRUCTION — the viewport subtracts
// the pill's row before slicing, the seam's surfaces are handed the slot's cap as their row budget — and why
// the diagnostic is a debug seam rather than the enforcement.
//   THE CLIPS ARE NOT EQUALLY LOAD-BEARING. Only the region's is: it is what turns overlong content into
// a clip instead of a shove, and removing it reddens the I9a case. The root's and the bottom slot's are
// DEFENSIVE — measured on both instruments (`ink-testing-library` and real Ink through `helpers/fakeTty`),
// removing either leaves the painted bytes identical, because Ink allocates its `Output` buffer at the root's
// computed height and truncates anything past it before a byte is written. They are kept because that
// truncation is Ink's implementation detail and this frame's budget is a contract; they are deliberately left
// unpinned, since a test asserting them would be asserting the absence of a difference no instrument can see.
//
// THE CONTAINER SHAPE IS THE PRODUCT, not the children. T10 replaced `regionChildren` with the virtualized
// viewport, T13 added the seam slot below, and M4's `/resume` launcher mounts this same component with a
// different dock — so the props are a region and a bottom band from day one, and this file knows nothing about
// transcripts.
//
// ── THE TWO OVERLAY MECHANISMS (T13, grounding §L2.6 "Two overlay mechanisms, not one") ────────────────────
// Canon has two, and a port with one is wrong in both directions. Every user-opened surface (`/model`,
// `/help`, `/resume` and its preview, and their kin) plus the ONE decision whose layout is `"modal"` — exit
// plan mode — render in an absolutely-positioned bottom slot: bundle `xDa` L455951, `position:absolute
// bottom:0 left:0 right:0 maxHeight: rows − 2 … opaque`, fed by `cZo`'s `modal` prop at L549395, with an
// upper-half-block `▔▔▔▔` rule as its top edge and the transcript squeezed above it. The remaining decisions
// (permission, question) do something else: the composer disappears and they take the band where it was, under
// the ordinary `────` rule their own frame paints. This component owns the first; the second is ChatApp's
// routing plus `DialogFrame`'s existing rule, and needs nothing here beyond the dock it already has. Which
// surface is which is ChatApp's call and is argued there.
//   THE OCCLUSION IS REPRODUCED BY OMISSION, because stock Ink cannot paint over anything. Ink 5.2.1 has
// `position:absolute` (styles.d.ts:7) but not the fork's `opaque`: an absolute box writes its own cells and
// leaves every cell it does not write showing whatever was under it, so a picker floated over the dock would
// paint a composer's tail through its blank rows. So when the seam is up the dock is NOT RENDERED and the seam
// takes the band in flow. The two are visually identical whenever the slot is at least as tall as the dock,
// which for every surface canon puts here it always is (a picker is ten-plus rows, the dock is five).
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Box, measureElement, type DOMElement } from "ink";
import { resolveThemeColor, themeTokens } from "./theme.js";

/** THE ROWS THE REGION ACTUALLY GRANTED, published to whatever is mounted inside it (FSW Task 10).
 *
 *  A virtualized region has to know its budget BEFORE it renders — `pageItemSlices` needs a row count — and
 *  the budget is not derivable from `rows` alone: it is `frameHeight − min(dockHeight, dockCap)`, and the
 *  dock's height is its own content's. So the frame MEASURES it (the region box already has a ref for the
 *  overflow diagnostic, and its computed height is the grant: `flexGrow: 1` makes it absorb every row the
 *  dock does not take, and `minHeight` floors it when the dock overruns its cap — either way the value is
 *  independent of what the region's own children rendered, so there is no measure/render feedback loop).
 *  A context rather than a callback prop because the consumer is a grandchild: routing it up to ChatApp and
 *  back down would make the whole tree re-render for a number only the region uses.
 *
 *  DEFAULT 0, deliberately: outside a `FullscreenFrame` there is no grant, and a viewport with no budget
 *  paints nothing rather than guessing a screenful. Tests mount the viewport with an explicit row count. */
const RegionRowsContext = createContext(0);
export function useRegionRows(): number { return useContext(RegionRowsContext); }

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
 *  can grow, but never past the point where the transcript stops being the thing on screen. `wide` is the
 *  exception — `rows − 2`, canon's cap for a bottom-anchored surface that IS the content while it is up
 *  (grounding §4.3, bundle L455951), the same number `seamCap` takes. Three tenants earn it: history search,
 *  whose results are the content; (T13b) a parked DECISION, whose dialog is the only thing on screen the user
 *  can act on; and (T14) the suggestion palette, which is neither — see `paletteOpen` for what that one is
 *  actually protecting and at which pane heights.
 *    THE DECISION TENANT IS A TRADE, NOT A NECESSITY — correcting T13b's report, which called it "required".
 *  The narrow cap does reach the acceptance: at 24 rows a permission dialog's ten rows of chrome fit inside
 *  `floor(24/2) = 12` with room for the marker, so the question, the options and `esc cancel` all survive —
 *  what the narrow cap cannot show is a single row of the DIFF, only the `… +N more lines` that stands in for
 *  it. The wide cap buys about ten rows of that diff, and it is worth them (a consult the user cannot read is
 *  a consent they cannot give, and canon hands its own modal the same `rows − 2`). THE PRICE, recorded: while
 *  a long-bodied consult is up the region collapses to roughly one row at ANY pane height, so the transcript
 *  behind it is a sliver and the ctrl+u/ctrl+d crossing pinned in keys/bindings.ts — the scroll keys reaching
 *  the region past the dialog — has almost nothing left to scroll there.
 *  Clamped into `[1, frameHeight]` so a two-row pane still yields a dock. */
export function dockCap(rows: number, wide: boolean): number {
  const cap = wide ? rows - 2 : Math.floor(rows / 2);
  return Math.max(1, Math.min(cap, frameHeight(rows)));
}

/** The SEAM SLOT's cap — canon's `maxHeight: rows − 2` on the overlay box (bundle L455951), the same number
 *  the history-search dock is allowed and for the same reason: while one of these is up it IS the content.
 *  Clamped into `[1, frameHeight]` like `dockCap`. Inside a `rows − 1` frame the cap leaves the region exactly
 *  one row, which is canon's "transcript still visible above it" (grounding §L2.6) as arithmetic rather than
 *  as luck. */
export function seamCap(rows: number): number {
  return Math.max(1, Math.min(rows - 2, frameHeight(rows)));
}

/** The seam: a full-width run of U+2594 UPPER HALF BLOCK on the slot's top edge (grounding §L2.6, "one
 *  absolutely-positioned bottom slot with an upper-half-block rule as its top edge").
 *  A CUSTOM INK BORDER OBJECT rather than a hand-painted row, and that is what keeps the frame from needing a
 *  column count: `renderBorder` builds the top edge as `box.top.repeat(width)` with no corners once both
 *  verticals are off (ink/build/render-border.js:23-27, the same arithmetic `composerFrame.tsx` transcribes for
 *  the composer's `────`), and `styles.js:196` gives the box exactly one row of Yoga border for it.
 *    ITS COLOUR IS THE `permission` ROLE, UNDIMMED (T13b, correcting T13's "unknowable" residual — the frame
 *  captures are plain text, but the bundle is not). L455951 builds the edge as `Sg({ color: "permission",
 *  char: "▔" })`, and `Sg` (L183955) paints `<Text color={color} dimColor={!color}>` — so naming a colour
 *  is exactly what turns the dimming OFF. */
const SEAM_RULE = { top: "▔", bottom: "", left: "", right: "", topLeft: "", topRight: "", bottomLeft: "", bottomRight: "" } as const;
const seamRuleColor = (): string | undefined => resolveThemeColor(themeTokens().permission);

export interface FullscreenFrameProps {
  /** The terminal's row count — ChatApp's resize state, never `process.stdout.rows` read behind it. */
  rows: number;
  regionChildren: React.ReactNode;
  dock: React.ReactNode;
  /** T13 — the absolute-bottom overlay slot's occupant. Present means canon's `xDa` is up: this REPLACES the
   *  dock in the paint (see the header on why occlusion is omission here), takes the `rows − 2` cap instead of
   *  the dock's, and wears the `▔▔▔▔` seam on its top edge. */
  seam?: React.ReactNode;
  historySearchOpen?: boolean;
  /** T13b — a parked decision's dialog is in the dock. It takes `dockCap`'s wide arm for the reason history
   *  search does; see there. */
  dialogInDock?: boolean;
  /** T14 / D10 — the suggestion palette is in the band, above the dock. Third tenant of `dockCap`'s wide arm,
   *  and the only one that is a SAFETY VALVE rather than a claim on the screen.
   *    THE FIX ROUND MEASURED WHAT IT IS WORTH, correcting T14's report (which called it unavoidable and
   *  blamed it for a sliver of transcript). With canon's `overlay`/`noPad` arms now ported (suggestPopup.tsx)
   *  the palette is at most five rows, so at 24 rows the band wants nine and the cap — wide or narrow — does
   *  not bind at all: the region is 18 rows either way, because a cap is a ceiling and the dock takes its
   *  natural height under it. Where it still bites is the SHORT pane: at 16 rows a five-row palette plus the
   *  composer and the footer is nine rows against a narrow cap of eight, and the row the frame clips is the
   *  footer. So the arm stays — measured, on that case — and it costs the tall pane nothing. */
  paletteOpen?: boolean;
  /** The L180317 diagnostic. Default writes to stderr only under `CCX_DEBUG`, the same seam and the same reason
   *  `statusLine.ts` has one: an unguarded stderr write lands in the middle of a live frame. */
  onOverflow?: (msg: string) => void;
}

const defaultOverflow = (msg: string): void => { if (process.env.CCX_DEBUG) process.stderr.write(`${msg}\n`); };

export function FullscreenFrame({ rows, regionChildren, dock, seam, historySearchOpen = false, dialogInDock = false, paletteOpen = false, onOverflow }: FullscreenFrameProps) {
  const height = frameHeight(rows);
  // ONE BOTTOM BAND, TWO OCCUPANTS AND TWO CAPS. Everything below — the region's floor, the measured grant's
  // stamp, the clip and the diagnostic — is written against `cap` and `bottomSlot` rather than against the dock,
  // so the seam is not a second code path but the same one with a different tenant.
  const seamUp = seam !== undefined && seam !== null && seam !== false;
  const bottomSlot = seamUp ? "seam" : "dock";
  const cap = seamUp ? seamCap(rows) : dockCap(rows, historySearchOpen || dialogInDock || paletteOpen);
  // THE CAP IS EXPRESSED AS THE REGION'S FLOOR, because Yoga has a `maxHeight` and Ink 5.2.1 does not expose it
  // (build/styles.js applies `minHeight` and `height`, nothing else). The two are equivalent inside a
  // fixed-height container: a region that may not shrink below `height − cap` leaves at most `cap` rows for
  // everything under it, whichever way the dock's own content pushes. `flexShrink: 0` on the dock then means the
  // dock never gives rows BACK — it keeps its natural height while it fits and overflows the frame's bottom
  // edge (where the outer clip takes it) when it does not.
  const regionFloor = Math.max(0, height - cap);
  const regionRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const bottomRef = useRef<DOMElement>(null);
  const overflowing = useRef(false);
  const bottomOverflowing = useRef(false);
  // The measured grant, STAMPED WITH THE GEOMETRY IT WAS MEASURED AT. A resize changes `height`/`cap` a full
  // render before the effect below can re-measure, and a stale grant from a taller terminal would have the
  // viewport render more rows than the region now has — clipped, so nothing breaks, but the budget would be
  // a coincidence for that frame instead of a contract. Falling back to the FLOOR while the stamp is stale
  // under-grants for exactly one frame, which is the safe direction.
  //   THE SLOT IS PART OF THE STAMP (T13), not merely the cap it implies. The seam's cap and the dock's coincide
  // at some geometries — `floor(rows/2) === rows − 2` at four rows, and the history-search dock takes `rows − 2`
  // outright — so a stamp keyed on the cap alone would carry a grant measured against a five-row dock into the
  // frame where a twenty-row picker has just taken the band. The mount is a frame re-render, so the fallback
  // fires on exactly the frame it needs to and the re-measure lands on the next.
  const [measured, setMeasured] = useState({ height, cap, slot: bottomSlot, rows: regionFloor });
  const regionRows = measured.height === height && measured.cap === cap && measured.slot === bottomSlot ? measured.rows : regionFloor;
  // Measured, not predicted. `contentRef` is an unshrinkable box, so its computed height is what the children
  // WANTED; `regionRef` is what they were given. An effect is the only place both are true — Yoga has laid out
  // by then — and the latch keeps a standing overflow from repeating the diagnostic on every keystroke.
  useEffect(() => {
    const region = regionRef.current, content = contentRef.current, bottom = bottomRef.current;
    if (!region || !content) return;
    const report = (latch: React.MutableRefObject<boolean>, over: boolean, msg: () => string) => {
      if (!over) { latch.current = false; return; }
      if (latch.current) return;
      latch.current = true;
      (onOverflow ?? defaultOverflow)(msg());
    };
    const want = measureElement(content).height, got = measureElement(region).height;
    if (got !== regionRows || measured.height !== height || measured.cap !== cap || measured.slot !== bottomSlot) setMeasured({ height, cap, slot: bottomSlot, rows: got });
    report(overflowing, want > got, () => `fullscreen frame: region content ${want} rows > region ${got} rows — something is rendering outside the frame's budget. Overflow clipped.`);
    // …AND THE BAND UNDER IT (T13). `flexShrink: 0` means the slot keeps its natural height and hangs past the
    // frame's bottom edge when it overruns, where the root's clip silently takes it — measured against the CAP
    // rather than against a granted height for that reason: there is no shortened box to compare with, the box
    // is simply taller than the rows it will be allowed to keep.
    if (bottom) {
      const bottomGot = measureElement(bottom).height;
      report(bottomOverflowing, bottomGot > cap, () => `fullscreen frame: ${bottomSlot} content ${bottomGot} rows > its ${cap}-row cap — Overflow clipped.`);
    }
  });
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      <Box ref={regionRef} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={regionFloor} overflow="hidden">
        <Box ref={contentRef} flexDirection="column" flexShrink={0}>
          <RegionRowsContext.Provider value={regionRows}>{regionChildren}</RegionRowsContext.Provider>
        </Box>
      </Box>
      {/* ONE BOX, TWO TENANTS — same element position, so the swap is a prop change rather than an unmount, and
          `bottomRef` stays attached across it. The seam adds nothing but its border row: the cap, the clip and
          the diagnostic above are the dock's, unchanged. */}
      {seamUp
        ? <Box ref={bottomRef} flexDirection="column" flexShrink={0} overflow="hidden"
            borderStyle={SEAM_RULE} borderColor={seamRuleColor()} borderBottom={false} borderLeft={false} borderRight={false}>{seam}</Box>
        : <Box ref={bottomRef} flexDirection="column" flexShrink={0} overflow="hidden">{dock}</Box>}
    </Box>
  );
}
