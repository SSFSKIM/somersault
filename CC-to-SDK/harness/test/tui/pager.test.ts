import { describe, it, expect } from "vitest";
import { pagerAction, applyPager, clampOffset, type PagerKey } from "../../src/tui/pager.js";

describe("pagerAction — the bundle Transcript context, key for key", () => {
  it.each([
    ["ctrl-u", "u", { ctrl: true }, { kind: "pages", n: -0.5 }], ["ctrl-d", "d", { ctrl: true }, { kind: "pages", n: 0.5 }],
    ["ctrl-b", "b", { ctrl: true }, { kind: "pages", n: -1 }], ["ctrl-f", "f", { ctrl: true }, { kind: "pages", n: 1 }],
    ["ctrl-n", "n", { ctrl: true }, { kind: "lines", n: 1 }], ["ctrl-p", "p", { ctrl: true }, { kind: "lines", n: -1 }],
    ["arrow-up", "", { upArrow: true }, { kind: "lines", n: -1 }], ["arrow-down", "", { downArrow: true }, { kind: "lines", n: 1 }],
    ["page-up", "", { pageUp: true }, { kind: "pages", n: -1 }], ["page-down", "", { pageDown: true }, { kind: "pages", n: 1 }],
    ["j", "j", {}, { kind: "lines", n: 1 }], ["k", "k", {}, { kind: "lines", n: -1 }], ["space", " ", {}, { kind: "pages", n: 1 }], ["b", "b", {}, { kind: "pages", n: -1 }],
    ["g", "g", {}, { kind: "top" }], ["G", "G", {}, { kind: "bottom" }],
    // The three exits are part of the contract this table claims to preserve; the previous table had 19 rows
    // including them, so omitting them here would silently drop coverage rather than preserve it.
    ["q", "q", {}, { kind: "exit" }], ["escape", "", { escape: true }, { kind: "exit" }], ["ctrl-c", "c", { ctrl: true }, { kind: "exit" }],
    ["ctrl-e", "e", { ctrl: true }, { kind: "toggleShowAll" }],
  ] as const)("preserves %s binding", (_name, input, key, expected) => expect(pagerAction(input as string, key as PagerKey)).toEqual(expected));
  it("unbound keys return null (never swallow)", () => {
    expect(pagerAction("z", {})).toBeNull();
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
  it("leaves applyPager's existing line and fractional/full page semantics intact", () => {
    expect(applyPager(10, { kind: "lines", n: -1 }, 100, 20)).toBe(9); expect(applyPager(10, { kind: "pages", n: -0.5 }, 100, 20)).toBe(0); expect(applyPager(10, { kind: "pages", n: 1 }, 100, 20)).toBe(30);
  });
});
