// tui/test/select-model.test.ts — the pure half of the `Select` primitive (F6 T1). Every expectation here is
// a transcription of 2.1.220's own select internals, NOT a design choice:
//   · `nHp`/`nz_`  (L396851-396957) — the window reducer: bottom-anchored on the way down, one-row-early on
//     the way up, wrap at both ends.
//   · `Nbr`        (L397256-397259) + `MHp = 8` (L397288) — the visible-count clamp.
//   · `DJs`        (L396765-396786) — the digit table: 1-based ABSOLUTE, "0" never matches, disabled = dead key.
//   · L397171-397191 + `DHp = 0.6` (L397288) — the compact two-column label measurements.
import { describe, it, expect } from "vitest";
import {
  clampVisible, digitTarget, isTwoColumn, labelColumnWidth, perOptionRows, truncateLabel, viewAfterFocus, windowBounds,
} from "../../src/tui/select/selectModel.js";

describe("clampVisible (Nbr, L397256-259)", () => {
  it("returns the asked-for count when the terminal is tall enough", () => {
    expect(clampVisible(5, 20, 1)).toBe(5);          // max(1, floor((20-8)/1)) = 12 → min(5,12)
  });
  it("clamps to the row budget on a short terminal", () => {
    expect(clampVisible(5, 10, 1)).toBe(2);          // max(1, floor((10-8)/1)) = 2
  });
  it("never returns less than one row, however short the terminal", () => {
    expect(clampVisible(5, 8, 1)).toBe(1);
    expect(clampVisible(5, 2, 1)).toBe(1);
    expect(clampVisible(5, 0, 3)).toBe(1);
  });
  it("divides the budget by the per-option height", () => {
    expect(clampVisible(9, 26, 2)).toBe(9);          // floor(18/2) = 9
    expect(clampVisible(9, 20, 2)).toBe(6);          // floor(12/2) = 6
    expect(clampVisible(9, 20, 3)).toBe(4);          // floor(12/3) = 4
  });
});

describe("windowBounds (nHp, L396939-396957)", () => {
  it("opens at the top when the focus already fits", () => {
    expect(windowBounds(10, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(windowBounds(10, 4, 5)).toEqual({ start: 0, end: 5 });
  });
  it("bottom-anchors the window on a focus past the first page", () => {
    expect(windowBounds(10, 5, 5)).toEqual({ start: 1, end: 6 });
    expect(windowBounds(10, 9, 5)).toEqual({ start: 5, end: 10 });
  });
  it("shrinks the window to the option count", () => {
    expect(windowBounds(3, 0, 5)).toEqual({ start: 0, end: 3 });
    expect(windowBounds(0, 0, 5)).toEqual({ start: 0, end: 0 });
  });
  it("keeps a previous window that already shows the focus (set-focus, L396929)", () => {
    expect(windowBounds(10, 4, 5, { start: 3, end: 8 })).toEqual({ start: 3, end: 8 });
  });
  it("top-anchors when the focus is above the previous window and bottom-anchors when below", () => {
    expect(windowBounds(10, 1, 5, { start: 4, end: 9 })).toEqual({ start: 1, end: 6 });
    expect(windowBounds(10, 9, 5, { start: 0, end: 5 })).toEqual({ start: 5, end: 10 });
  });
  it("clamps an out-of-range focus rather than producing a negative window", () => {
    expect(windowBounds(4, 99, 5)).toEqual({ start: 0, end: 4 });
    expect(windowBounds(4, -3, 5)).toEqual({ start: 0, end: 4 });
  });
});

describe("viewAfterFocus (nz_ focus-next/previous-option, L396853-396886)", () => {
  const view = (focus: number, start: number, end: number) => ({ focus, start, end });

  it("holds the window while the next row is still inside it", () => {
    expect(viewAfterFocus(view(0, 0, 5), 10, 5, 1)).toEqual(view(1, 0, 5));
  });
  it("scrolls by exactly one when the next row falls off the bottom", () => {
    expect(viewAfterFocus(view(4, 0, 5), 10, 5, 5)).toEqual(view(5, 1, 6));
  });
  it("scrolls one row EARLY going up — a step onto the first visible row still scrolls (L396882)", () => {
    expect(viewAfterFocus(view(2, 1, 6), 10, 5, 1)).toEqual(view(1, 0, 5));
  });
  it("holds the window on a step up that lands strictly inside it", () => {
    expect(viewAfterFocus(view(3, 1, 6), 10, 5, 2)).toEqual(view(2, 1, 6));
  });
  it("jumps to the bottom window on a wrap from the first row to the last", () => {
    expect(viewAfterFocus(view(0, 0, 5), 10, 5, 9)).toEqual(view(9, 5, 10));
  });
  it("jumps to the top window on a wrap from the last row to the first", () => {
    expect(viewAfterFocus(view(9, 5, 10), 10, 5, 0)).toEqual(view(0, 0, 5));
  });
  it("bottom-anchors a page down and top-anchors a page up", () => {
    expect(viewAfterFocus(view(0, 0, 5), 20, 5, 5)).toEqual(view(5, 1, 6));    // one step past the window
    expect(viewAfterFocus(view(10, 6, 11), 20, 5, 5)).toEqual(view(5, 5, 10)); // page up: top-anchored
  });
});

describe("digitTarget (DJs, L396765-396786)", () => {
  const opts = [{}, { disabled: true }, {}, {}];

  it("reads the digit as a 1-based ABSOLUTE position and returns its 0-based index", () => {
    expect(digitTarget(opts, "1")).toBe(0);
    expect(digitTarget(opts, "3")).toBe(2);
    expect(digitTarget(opts, "4")).toBe(3);
  });
  it("is a DEAD KEY on a disabled row — it does not advance to the next enabled one", () => {
    expect(digitTarget(opts, "2")).toBe(-1);
  });
  it("never matches on \"0\"", () => {
    expect(digitTarget(opts, "0")).toBe(-1);
  });
  it("misses past the end of the list and on anything that is not a single digit", () => {
    expect(digitTarget(opts, "5")).toBe(-1);
    expect(digitTarget(opts, "a")).toBe(-1);
    expect(digitTarget(opts, "12")).toBe(-1);
    expect(digitTarget(opts, "")).toBe(-1);
  });
});

describe("compact two-column measurements (L397053, L397171-397191)", () => {
  const withDesc = [{ value: "a", label: "alpha", description: "first" }, { value: "b", label: "b" }];

  it("turns the two-column layout on only for a compact list with descriptions and no input row", () => {
    expect(isTwoColumn(withDesc, false)).toBe(true);
    expect(isTwoColumn(withDesc, true)).toBe(false);                                          // inlineDescriptions wins
    expect(isTwoColumn([...withDesc, { value: "i", label: "i", type: "input" as const }], false)).toBe(false);
    expect(isTwoColumn([{ value: "a", label: "alpha" }], false)).toBe(false);                 // nobody has a description
  });
  it("counts a two-column row as two terminal rows for the clamp (L397053-397054)", () => {
    expect(perOptionRows(true)).toBe(2);
    expect(perOptionRows(false)).toBe(1);
  });
  it("measures the label column as 2 + indexPad + label width, +2 for the current value", () => {
    // widest is "alpha" (5): 2 + 3 + 5 = 10; "b": 2 + 3 + 1 = 6.
    expect(labelColumnWidth(withDesc, { columns: 100, indexPad: 3 })).toBe(10);
    expect(labelColumnWidth(withDesc, { columns: 100, indexPad: 3, currentValue: "a" })).toBe(12);
    expect(labelColumnWidth(withDesc, { columns: 100, indexPad: 0 })).toBe(7);
  });
  it("caps the label column at 60% of the terminal width (DHp)", () => {
    expect(labelColumnWidth([{ value: "a", label: "x".repeat(80) }], { columns: 40, indexPad: 3 })).toBe(24);
  });
  it("gives an input row a zero label measurement (L397180-397181)", () => {
    expect(labelColumnWidth([{ value: "i", label: "wide-input-label", type: "input" as const }], { columns: 100, indexPad: 3 })).toBe(0);
  });
});

describe("truncateLabel (gi, L106951-106963)", () => {
  it("leaves a label that fits untouched", () => { expect(truncateLabel("alpha", 10)).toBe("alpha"); });
  it("reserves one column for the ellipsis", () => { expect(truncateLabel("abcdefgh", 5)).toBe("abcd…"); });
  it("degenerates to a bare ellipsis at width one or less", () => {
    expect(truncateLabel("abcdefgh", 1)).toBe("…");
    expect(truncateLabel("abcdefgh", 0)).toBe("…");
  });
});
