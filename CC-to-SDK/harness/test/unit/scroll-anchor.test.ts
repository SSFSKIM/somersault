// test/unit/scroll-anchor.test.ts — FSW task 2. The three canon rules of bottom-anchoring, plus the two
// edges the bundle states only implicitly (a scroll that lands ON the bottom, and a height that changes
// under a viewport that has been scrolled away from the tail).
//
// Every assertion here is against bundle 2.1.220 `cli.pretty.js` L179827-179836, transcribed in
// docs/superpowers/grounding/2026-08-12-fullscreen-ground.md §3.4, and against the live observation in
// §L2.3 (`scroll-snapback.txt`: after scrolling up and typing `x`, the transcript does not move).
import { describe, expect, it } from "vitest";
import { applyAnchor, type AnchorState } from "../../src/tui/scrollAnchor.js";
import { PAGER_ACTIONS } from "../../src/tui/pager.js";

const AT_BOTTOM: AnchorState = { offset: 0, sticky: true };
/** Scroll up one full viewport — the `pageup` binding of the fullscreen `Scroll` context (§3.5). */
const pageUp = (total: number, height: number) => ({ kind: "scroll", action: PAGER_ACTIONS["scroll:fullPageUp"]!, total, height }) as const;

describe("rule 1 — while sticky, every content event re-derives offset = max(0, total - height)", () => {
  it("follows the tail as the transcript grows", () => {
    let s = AT_BOTTOM;
    for (const total of [10, 40, 41, 120]) s = applyAnchor(s, { kind: "content", total, height: 20 });
    expect(s).toEqual({ offset: 100, sticky: true });
  });
  it("clamps at 0 while the content is shorter than the viewport — a short transcript sits at the TOP", () => {
    // §3.4: `G = Math.max(0, q - M)`. Bottom-anchored means the transcript follows its own tail, NOT that
    // content is pushed down the screen; getting this backwards builds the wrong thing.
    expect(applyAnchor(AT_BOTTOM, { kind: "content", total: 3, height: 20 })).toEqual({ offset: 0, sticky: true });
  });
  it("re-derives with the NEW height when a re-wrap changes the viewport under a sticky anchor", () => {
    const s = applyAnchor({ offset: 100, sticky: true }, { kind: "content", total: 120, height: 8 });
    expect(s).toEqual({ offset: 112, sticky: true });
  });
});

describe("rule 2 — an explicit scroll off the bottom unsticks, and content never yanks you back", () => {
  it("sets sticky false and moves by applyPager's clamped delta", () => {
    const s = applyAnchor({ offset: 100, sticky: true }, pageUp(120, 20));
    expect(s).toEqual({ offset: 80, sticky: false });
  });
  it("holds the offset across later content events", () => {
    let s = applyAnchor({ offset: 100, sticky: true }, pageUp(120, 20));
    for (const total of [130, 160, 400]) s = applyAnchor(s, { kind: "content", total, height: 20 });
    expect(s).toEqual({ offset: 80, sticky: false });
  });
  it("typing while scrolled up does not snap back (§L2.3 scroll-snapback.txt)", () => {
    // The composer's keystrokes reach the anchor only as content events (the transcript re-measures), and
    // upstream's answer is to do nothing at all: the user left the tail, so do not drag them back.
    const scrolled = applyAnchor({ offset: 100, sticky: true }, pageUp(120, 20));
    const typed = applyAnchor(scrolled, { kind: "content", total: 121, height: 20 });
    expect(typed).toEqual({ offset: 80, sticky: false });
    expect(typed).toBe(scrolled);
  });
  it("CLAMPS but does not re-anchor when a resize shrinks the content under an unstuck viewport", () => {
    // Height/total move between events (re-wrap, resize). An unstuck offset must stay where it is unless
    // that row no longer exists, in which case it lands on the new bottom — never on the new tail by fiat.
    const scrolled = applyAnchor({ offset: 180, sticky: true }, pageUp(200, 20));
    expect(scrolled).toEqual({ offset: 160, sticky: false });
    expect(applyAnchor(scrolled, { kind: "content", total: 100, height: 20 })).toEqual({ offset: 80, sticky: false });
    expect(applyAnchor(scrolled, { kind: "content", total: 200, height: 60 })).toEqual({ offset: 140, sticky: false });
  });
});

describe("rule 3 — stickBottom re-sticks and re-derives", () => {
  it("returns an unstuck viewport to the tail (`scrollToBottom()` sets stickyScroll back to true, L434930)", () => {
    const scrolled = applyAnchor({ offset: 100, sticky: true }, pageUp(120, 20));
    expect(applyAnchor(scrolled, { kind: "stickBottom", total: 160, height: 20 })).toEqual({ offset: 140, sticky: true });
  });
});

describe("the bottom edge — a scroll that LANDS on the bottom re-sticks", () => {
  // L179830's `z >= re` arm re-sticks a viewport that is already bottomed when content grows, and
  // `scrollToBottom()` sticks explicitly. A scroll that arrives at the same row is the same viewport, so
  // it gets the same answer: sticky. Anything else strands a bottomed viewport that then refuses to follow.
  it("re-sticks on scroll:bottom", () => {
    const scrolled = applyAnchor({ offset: 100, sticky: true }, pageUp(120, 20));
    expect(applyAnchor(scrolled, { kind: "scroll", action: PAGER_ACTIONS["scroll:bottom"]!, total: 120, height: 20 })).toEqual({ offset: 100, sticky: true });
  });
  it("re-sticks when a plain line-down happens to arrive at the last row, and then follows growth again", () => {
    const one = applyAnchor({ offset: 100, sticky: true }, { kind: "scroll", action: { kind: "lines", n: -1 }, total: 120, height: 20 });
    expect(one).toEqual({ offset: 99, sticky: false });
    const back = applyAnchor(one, { kind: "scroll", action: { kind: "lines", n: 1 }, total: 120, height: 20 });
    expect(back).toEqual({ offset: 100, sticky: true });
    expect(applyAnchor(back, { kind: "content", total: 130, height: 20 })).toEqual({ offset: 110, sticky: true });
  });
  it("never unsticks while the content is shorter than the viewport — every row is the bottom row", () => {
    expect(applyAnchor({ offset: 0, sticky: true }, pageUp(5, 20))).toEqual({ offset: 0, sticky: true });
  });
});

describe("identity", () => {
  it("returns the same state object when nothing changed, so a React consumer can bail out of the render", () => {
    const s: AnchorState = { offset: 100, sticky: true };
    expect(applyAnchor(s, { kind: "content", total: 120, height: 20 })).toBe(s);
    expect(applyAnchor(s, { kind: "stickBottom", total: 120, height: 20 })).toBe(s);
    expect(applyAnchor(s, { kind: "scroll", action: { kind: "bottom" }, total: 120, height: 20 })).toBe(s);
  });
});
