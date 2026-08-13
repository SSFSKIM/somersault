// tui/src/scrollAnchor.ts — the fullscreen viewport's scroll position, as a pure reducer.
//
// This is upstream's bottom-anchoring, and it is smaller than it looks. Bundle 2.1.220 `cli.pretty.js`
// L179827-179836 (transcribed in docs/superpowers/grounding/2026-08-12-fullscreen-ground.md §3.4) is the
// whole of it: a `stickyScroll` flag on the scroll box, a `followGrowth` re-stick rule, and one derivation,
// `scrollTop = max(0, contentHeight - viewportHeight)`. Three rules fall out:
//
//   1. While sticky, EVERY content event re-derives `offset = max(0, total - height)` (L179831 `scrollTop = G`,
//      with `G = Math.max(0, q - M)` at 179813). Note the clamp: content shorter than the viewport sits at
//      offset 0, i.e. at the TOP of the region with blank space below. "Bottom-anchored" means the transcript
//      follows its own TAIL, not that content is pushed down the screen.
//   2. An explicit scroll that leaves the bottom sets `sticky: false` (L434911/434916/434921), and content
//      events after it must NOT move the offset. Never yank the user down. The live layer's `scroll-snapback`
//      capture (§L2.3) is this rule's content arm: typing while scrolled up does not snap you back, because a
//      keystroke reaches the anchor only as another content event.
//   3. `stickBottom` re-sticks and re-derives — `scrollToBottom()` sets `stickyScroll = true` (L434930). It is
//      what the "N new lines" pill and `scroll:bottom` (ctrl+end) both call.
//
// TWO EDGES THE BUNDLE STATES ONLY IMPLICITLY, decided here:
//
//   · A scroll whose RESULT lands exactly on the bottom row re-sticks. L179830's `z >= re` arm re-sticks a
//     viewport that was already bottomed when content grows, so a bottomed viewport is a sticky viewport
//     regardless of how it got there; the alternative strands a viewport at the tail that then refuses to
//     follow it. As a corollary, while the content is shorter than the viewport the bottom is 0 and no scroll
//     can ever unstick — correct, since every row is the last row.
//   · `total` and `height` move between events (re-wrap on a resize, a tool result re-measuring). A sticky
//     anchor re-derives against the NEW numbers. An unstuck one keeps TWO values, as canon does in one
//     layout walk at L179841-179843: the RETAINED offset (`Te` → `scrollTop`) is clamped against a
//     HIGH-WATER content height — `Y = Math.max(scrollHeightHwm ?? 0, total)` at L179827, with the hwm
//     cleared by every explicit scroll (L434908/434914/434919) and unused while sticky — whereas the
//     RENDERED offset (`Se` → `scrollTopRendered`) is clamped against the CURRENT bottom. So a shrink
//     paints the clamped row but remembers the held one, and a regrow puts the user back on the exact row
//     they were reading; clamping the retained value instead paints the same frame while silently dropping
//     them toward the tail. This module owns the retained value only: `pageItemSlices` (pager.ts:49)
//     already clamps what it paints, which is `Se`, and canon's jump-pill predicate reads the retained
//     value too. Note the one move the user did not ask for that canon still makes: the ceiling
//     `max(G, Y − M)` uses the CURRENT height, so growing the viewport does pull the offset down.
//
// `applyPager` (pager.ts:33) already owns the move-and-clamp arithmetic for every `scroll:*` action, so a
// scroll event is that call plus the stickiness verdict; the clamp math lives in exactly one place.
import { applyPager, type PagerAction } from "./pager.js";

export interface AnchorState {
  offset: number; sticky: boolean;
  /** `scrollHeightHwm` (L179827-179828): the tallest `total` seen since the last explicit scroll, and the
   *  ceiling the RETAINED offset is clamped against. Cleared while sticky, exactly as canon clears it —
   *  a sticky anchor re-derives from the current numbers and has nothing to remember. */
  hwm?: number;
}
export type AnchorEvent =
  | { kind: "content"; total: number; height: number }
  /** FSW T17 fix round — THE DOCUMENT WAS RE-WRAPPED, so every row below the first line whose height changed
   *  has a new number and the retained offset is denominated in a projection that no longer exists. The
   *  caller has already translated the position (`wrapItems.remapRowOffset`); this is where the anchor
   *  accepts it. A width change is NOT content growth, so it also resets the high-water ceiling to the new
   *  total — exactly as an explicit scroll clears it, and for the same reason: the hwm remembers how tall
   *  the DOCUMENT got, and a narrower terminal saying the same document is taller is not that. Leaving it
   *  standing would let a narrow-then-widen sequence hold an offset past the real bottom. Sticky anchors
   *  ignore the event: they re-derive from the tail, which is width-independent by construction. */
  | { kind: "reproject"; offset: number; total: number; height: number }
  | { kind: "scroll"; action: PagerAction; total: number; height: number }
  | { kind: "stickBottom"; total: number; height: number };

/** The bottom-most offset — `G` at L179813. Zero when the content does not fill the viewport. */
export function bottomOffset(total: number, height: number): number { return Math.max(0, total - height); }

export function applyAnchor(s: AnchorState, e: AnchorEvent): AnchorState {
  const bottom = bottomOffset(e.total, e.height);
  let next: AnchorState;
  if (e.kind === "stickBottom") next = { offset: bottom, sticky: true };
  else if (e.kind === "reproject") next = s.sticky ? { offset: bottom, sticky: true } : { offset: Math.max(0, Math.min(e.offset, bottom)), sticky: false, hwm: e.total };
  else if (e.kind === "content") {
    if (s.sticky) next = { offset: bottom, sticky: true };
    else {
      // `Te` at L179841: hold the offset, clamped only to the high-water ceiling `max(G, Y − M)`.
      const hwm = Math.max(s.hwm ?? 0, e.total);
      next = { offset: Math.max(0, Math.min(s.offset, hwm - e.height)), sticky: false, hwm };
    }
  } else {
    // An explicit scroll clears the hwm; the new one starts from the total this scroll was measured against.
    const offset = applyPager(s.offset, e.action, e.total, e.height), sticky = offset === bottom;
    next = sticky ? { offset, sticky } : { offset, sticky, hwm: e.total };
  }
  // Same position, same flag, same memory ⇒ same object, so a React consumer can bail out of the render.
  return next.offset === s.offset && next.sticky === s.sticky && next.hwm === s.hwm ? s : next;
}
