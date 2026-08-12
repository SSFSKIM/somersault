// test/unit/scroll-anchor.test.ts — FSW task 2. The three canon rules of bottom-anchoring, plus the two
// edges the bundle states only implicitly (a scroll that lands ON the bottom, and a total/height that
// changes under a viewport that has been scrolled away from the tail — where canon keeps a RETAINED
// offset and a RENDERED one, and this module owns only the retained half).
//
// Every assertion here is against bundle 2.1.220 `cli.pretty.js` L179827-179836 and L179841-179843,
// transcribed in docs/superpowers/grounding/2026-08-12-fullscreen-ground.md §3.4, and against the live
// observation in §L2.3 (`scroll-snapback.txt`: after scrolling up and typing `x`, the transcript does not move).
import { describe, expect, it } from "vitest";
import { applyAnchor, type AnchorState } from "../../src/tui/scrollAnchor.js";
import { clampOffset, PAGER_ACTIONS } from "../../src/tui/pager.js";

const AT_BOTTOM: AnchorState = { offset: 0, sticky: true };
/** Scroll up one FULL viewport. Deliberately `scroll:fullPageUp`, not canon's `pageup` binding: canon binds
 *  `pageup → scroll:pageUp`, whose handler is `-Math.max(1, Math.floor(height / 2))` (L446159-446166) — a
 *  HALF viewport, which the live §L2.3 run confirms (PgUp moved 9 rows in a 19-row region), and which plan
 *  T11 binds as `scroll:halfPageUp`. A full page just makes the arithmetic below round numbers; what is
 *  under test is the anchor's verdict on a move, not which key produces it. */
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
    expect(s).toEqual({ offset: 80, sticky: false, hwm: 120 });
  });
  it("holds the offset across later content events, and the high-water mark follows the growth", () => {
    let s = applyAnchor({ offset: 100, sticky: true }, pageUp(120, 20));
    for (const total of [130, 160, 400]) s = applyAnchor(s, { kind: "content", total, height: 20 });
    expect(s).toEqual({ offset: 80, sticky: false, hwm: 400 });
  });
  it("typing while scrolled up does not snap back (§L2.3 scroll-snapback.txt)", () => {
    // The composer's keystrokes reach the anchor only as content events (the transcript re-measures), and
    // upstream's answer is to do nothing at all: the user left the tail, so do not drag them back.
    const scrolled = applyAnchor({ offset: 100, sticky: true }, pageUp(120, 20));
    const typed = applyAnchor(scrolled, { kind: "content", total: 121, height: 20 });
    expect(typed).toEqual({ offset: 80, sticky: false, hwm: 121 });
    // The new row raised the high-water mark, so this is a new object; a re-measure at the SAME total
    // changes nothing at all and returns the identical one.
    expect(applyAnchor(typed, { kind: "content", total: 121, height: 20 })).toBe(typed);
  });
  it("RETAINS the offset above the new bottom when content shrinks, and renders it clamped (L179841-179843)", () => {
    // Canon keeps two values out of one layout walk: `Te` (retained → `scrollTop`), clamped against the
    // HIGH-WATER content height `Y = max(scrollHeightHwm ?? 0, total)`, and `Se` (rendered →
    // `scrollTopRendered`), clamped against the current bottom. Clamping the retained value instead is
    // lossy: it paints the same frame but forgets where the user was.
    const scrolled = applyAnchor({ offset: 180, sticky: true }, pageUp(200, 20));
    expect(scrolled).toEqual({ offset: 160, sticky: false, hwm: 200 });
    const shrunk = applyAnchor(scrolled, { kind: "content", total: 100, height: 20 });
    expect(shrunk).toEqual({ offset: 160, sticky: false, hwm: 200 });      // retained: ceiling max(80, 200−20) = 180
    expect(clampOffset(shrunk.offset, 100, 20)).toBe(80);                  // rendered: the frame that gets painted
    // The restore canon guarantees: grow back and the user is on row 160 exactly, not 80 rows down the tail.
    const regrown = applyAnchor(shrunk, { kind: "content", total: 200, height: 20 });
    expect(regrown).toEqual({ offset: 160, sticky: false, hwm: 200 });
    expect(clampOffset(regrown.offset, 200, 20)).toBe(160);
  });
  it("still clamps the retained offset when the VIEWPORT grows — the ceiling uses the CURRENT height", () => {
    // `Te`'s ceiling is `max(G, Y − M)` with the current `M`: 200 − 60 = 140, so 160 does come down. This is
    // the one case where an unstuck offset moves without the user asking, and canon moves it.
    const scrolled = applyAnchor({ offset: 180, sticky: true }, pageUp(200, 20));
    expect(applyAnchor(scrolled, { kind: "content", total: 200, height: 60 })).toEqual({ offset: 140, sticky: false, hwm: 200 });
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
    expect(one).toEqual({ offset: 99, sticky: false, hwm: 120 });
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
