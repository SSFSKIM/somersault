// F2 task 7: `pagerAction(input, key)` is gone. Which KEY scrolls the pager is the binding table's business
// now (keys/bindings.ts, the `Transcript` context); pager.ts keeps only what an ACTION means, as PAGER_ACTIONS.
// So the invariant worth pinning flipped: every scroll action the Transcript context binds must have an entry
// here, and nothing may be listed that the table never names — a one-sided map is how a live key goes dead.
import { describe, it, expect } from "vitest";
import { PAGER_ACTIONS, applyPager, clampOffset } from "../../src/tui/pager.js";
import { DEFAULT_BINDINGS } from "../../src/tui/keys/bindings.js";

const transcript = DEFAULT_BINDINGS.find((b) => b.context === "Transcript")!;
const boundScrolls = new Set(Object.values(transcript.bindings).filter((a): a is string => !!a && a.startsWith("scroll:")));

describe("PAGER_ACTIONS — the bundle Transcript context, action for action", () => {
  it("covers exactly the scroll actions the Transcript context binds", () =>
    expect(Object.keys(PAGER_ACTIONS).sort()).toEqual([...boundScrolls].sort()));
  it.each([
    ["scroll:halfPageUp", { kind: "pages", n: -0.5 }], ["scroll:halfPageDown", { kind: "pages", n: 0.5 }],
    ["scroll:fullPageUp", { kind: "pages", n: -1 }], ["scroll:fullPageDown", { kind: "pages", n: 1 }],
    ["scroll:pageUp", { kind: "pages", n: -1 }], ["scroll:pageDown", { kind: "pages", n: 1 }],
    ["scroll:lineUp", { kind: "lines", n: -1 }], ["scroll:lineDown", { kind: "lines", n: 1 }],
    ["scroll:top", { kind: "top" }], ["scroll:bottom", { kind: "bottom" }],
  ] as const)("preserves %s", (action, expected) => expect(PAGER_ACTIONS[action]).toEqual(expected));
  it("g/G and home/end are the same two operations, reached by four keys", () => {
    expect(transcript.bindings["g"]).toBe("scroll:top"); expect(transcript.bindings["home"]).toBe("scroll:top");
    expect(transcript.bindings["shift+g"]).toBe("scroll:bottom"); expect(transcript.bindings["end"]).toBe("scroll:bottom");
  });
});

describe("applyPager / clampOffset", () => {
  it("clamps to [0, total-height]", () => {
    expect(clampOffset(-3, 100, 10)).toBe(0);
    expect(clampOffset(999, 100, 10)).toBe(90);
    expect(clampOffset(5, 8, 10)).toBe(0);                 // content shorter than the window
  });
  // FSW TASK 11 — THE HALF-PAGE ARITHMETIC CHANGED, so this block's assertions change with it. It used to be
  // `Math.round(a.n * height)` and read "half page rounds against height"; `Math.round` is round-HALF-UP, which
  // is not symmetric about zero (`round(5.5)` is 6 but `round(-5.5)` is −5), so on every ODD height a half page
  // DOWN moved one row further than a half page UP and the pair did not return you to the row you started on.
  // At height 1 it was worse than asymmetric: `round(-0.5)` is `-0`, so the up key moved nothing at all.
  //   The replacement floors the MAGNITUDE and floors it at one row: `sign(n) * max(1, floor(|n| * height))`.
  // Integer pages are untouched (`floor(1 * h) === h`), so only the fractional arm moves — which is why the
  // Transcript context's ctrl+u/ctrl+d and `SelectDecision`'s borrowed pair shift by one row on odd heights
  // too, deliberately and in the direction that makes them reversible.
  it("half page floors the magnitude — symmetric in both directions on an odd height", () => {
    expect(applyPager(50, { kind: "pages", n: -0.5 }, 100, 10)).toBe(45);
    expect(applyPager(50, { kind: "pages", n: 0.5 }, 100, 11)).toBe(55);   // floor(5.5)=5; round(5.5) gave 56
    expect(applyPager(50, { kind: "pages", n: -0.5 }, 100, 11)).toBe(45);  // …and the SAME five rows upward
  });
  it("a half page is never zero rows — the up key is alive in a one-row window", () => {
    expect(applyPager(5, { kind: "pages", n: -0.5 }, 100, 1)).toBe(4);     // round(-0.5) was -0: dead key
    expect(applyPager(5, { kind: "pages", n: 0.5 }, 100, 1)).toBe(6);
  });
  it("down-then-up returns to the starting row at every height the region can have", () => {
    for (const h of [1, 2, 7, 10, 11, 17, 19, 37]) {
      const down = applyPager(200, { kind: "pages", n: 0.5 }, 1000, h);
      expect(applyPager(down, { kind: "pages", n: -0.5 }, 1000, h), `height ${h}`).toBe(200);
    }
  });
  it("top/bottom/lines/pages", () => {
    expect(applyPager(50, { kind: "top" }, 100, 10)).toBe(0);
    expect(applyPager(0, { kind: "bottom" }, 100, 10)).toBe(90);
    expect(applyPager(0, { kind: "lines", n: -1 }, 100, 10)).toBe(0);
    expect(applyPager(89, { kind: "pages", n: 1 }, 100, 10)).toBe(90);
  });
  it("leaves applyPager's existing line and fractional/full page semantics intact", () => {
    expect(applyPager(10, { kind: "lines", n: -1 }, 100, 20)).toBe(9); expect(applyPager(10, { kind: "pages", n: -0.5 }, 100, 20)).toBe(0); expect(applyPager(10, { kind: "pages", n: 1 }, 100, 20)).toBe(30);
  });
});
