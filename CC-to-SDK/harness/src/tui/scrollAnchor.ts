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
//     anchor re-derives against the NEW numbers; an unstuck one CLAMPS the offset it is holding so it cannot
//     point past the new bottom, but is never re-anchored — clamping preserves the user's position where it
//     still exists, which re-anchoring would silently discard.
//
// `applyPager` (pager.ts:33) already owns the move-and-clamp arithmetic for every `scroll:*` action, so a
// scroll event is that call plus the stickiness verdict; the clamp math lives in exactly one place.
import { applyPager, clampOffset, type PagerAction } from "./pager.js";

export interface AnchorState { offset: number; sticky: boolean }
export type AnchorEvent =
  | { kind: "content"; total: number; height: number }
  | { kind: "scroll"; action: PagerAction; total: number; height: number }
  | { kind: "stickBottom"; total: number; height: number };

/** The bottom-most offset — `G` at L179813. Zero when the content does not fill the viewport. */
export function bottomOffset(total: number, height: number): number { return Math.max(0, total - height); }

export function applyAnchor(s: AnchorState, e: AnchorEvent): AnchorState {
  const bottom = bottomOffset(e.total, e.height);
  let next: AnchorState;
  if (e.kind === "stickBottom") next = { offset: bottom, sticky: true };
  else if (e.kind === "content") next = s.sticky ? { offset: bottom, sticky: true } : { offset: clampOffset(s.offset, e.total, e.height), sticky: false };
  else { const offset = applyPager(s.offset, e.action, e.total, e.height); next = { offset, sticky: offset === bottom }; }
  // Same position, same flag ⇒ same object, so a React consumer can bail out of the render entirely.
  return next.offset === s.offset && next.sticky === s.sticky ? s : next;
}
