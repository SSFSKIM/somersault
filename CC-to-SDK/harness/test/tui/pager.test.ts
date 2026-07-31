import { describe, it, expect } from "vitest";
import { pagerAction, applyPager, clampOffset } from "../../src/tui/pager.js";

describe("pagerAction — the bundle Transcript context, key for key", () => {
  it.each([
    ["q", {}, { kind: "exit" }],
    ["", { escape: true }, { kind: "exit" }],
    ["c", { ctrl: true }, { kind: "exit" }],
    ["u", { ctrl: true }, { kind: "pages", n: -0.5 }],
    ["d", { ctrl: true }, { kind: "pages", n: 0.5 }],
    ["b", { ctrl: true }, { kind: "pages", n: -1 }],
    ["f", { ctrl: true }, { kind: "pages", n: 1 }],
    ["n", { ctrl: true }, { kind: "lines", n: 1 }],
    ["p", { ctrl: true }, { kind: "lines", n: -1 }],
    ["j", {}, { kind: "lines", n: 1 }],
    ["k", {}, { kind: "lines", n: -1 }],
    ["", { downArrow: true }, { kind: "lines", n: 1 }],
    ["", { upArrow: true }, { kind: "lines", n: -1 }],
    [" ", {}, { kind: "pages", n: 1 }],
    ["b", {}, { kind: "pages", n: -1 }],
    ["g", {}, { kind: "top" }],
    ["G", {}, { kind: "bottom" }],
    ["", { pageUp: true }, { kind: "pages", n: -1 }],
    ["", { pageDown: true }, { kind: "pages", n: 1 }],
  ] as const)("input=%j key=%j → %j", (input, key, want) => {
    expect(pagerAction(input as string, key as any)).toEqual(want);
  });
  it("unbound keys return null (never swallow)", () => {
    expect(pagerAction("z", {})).toBeNull();
    expect(pagerAction("e", { ctrl: true })).toBeNull();   // toggleShowAll deferred — must NOT act
  });
  it("g goes top and G goes bottom — Shift+G arrives as input 'G', never as key.shift (KB23)", () => {
    expect(pagerAction("g", {})).toEqual({ kind: "top" });
    expect(pagerAction("g", { shift: true } as any)).toEqual({ kind: "top" });   // the old dead branch returned bottom here
    expect(pagerAction("G", {})).toEqual({ kind: "bottom" });
  });
});

describe("applyPager / clampOffset", () => {
  it("clamps to [0, total-height]", () => {
    expect(clampOffset(-3, 100, 10)).toBe(0);
    expect(clampOffset(999, 100, 10)).toBe(90);
    expect(clampOffset(5, 8, 10)).toBe(0);                 // content shorter than the window
  });
  it("half page rounds against height", () => {
    expect(applyPager(50, { kind: "pages", n: -0.5 }, 100, 10)).toBe(45);
    expect(applyPager(50, { kind: "pages", n: 0.5 }, 100, 11)).toBe(56);   // round(5.5)=6
  });
  it("top/bottom/lines/pages", () => {
    expect(applyPager(50, { kind: "top" }, 100, 10)).toBe(0);
    expect(applyPager(0, { kind: "bottom" }, 100, 10)).toBe(90);
    expect(applyPager(0, { kind: "lines", n: -1 }, 100, 10)).toBe(0);
    expect(applyPager(89, { kind: "pages", n: 1 }, 100, 10)).toBe(90);
  });
});
