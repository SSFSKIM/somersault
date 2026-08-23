// tui/test/composerRows.test.ts — S1: the composer's PAINTED buffer height, the one term the bottom-up
// caret origin cannot get from `wrapRows` alone. `wrapRows` counts the rows the TEXT needs; the buffer also
// paints an inverted blank cursor cell past the end of a line and, with a completion live, a dim ghost run —
// either of which can add a row at an exact inner-width boundary.
import { describe, it, expect } from "vitest";
import { bufferPhysicalRows, composerOriginRow } from "../../src/tui/composerRows.js";
import { footerRows } from "../../src/tui/Footer.js";

const paint = (over: Partial<Parameters<typeof bufferPhysicalRows>[0]> = {}) => ({
  lines: ["abc"], cursor: { row: 0, col: 3 }, ghost: null, placeholder: null, innerWidth: 10, ...over,
});

describe("bufferPhysicalRows — the plain cases", () => {
  it("one short line is one row", () => expect(bufferPhysicalRows(paint())).toBe(1));
  it("an empty buffer with no placeholder is still one row (the lone inverted space)", () =>
    expect(bufferPhysicalRows(paint({ lines: [""], cursor: { row: 0, col: 0 } }))).toBe(1));
  it("three logical lines are three rows — renderBuffer paints one <Text> per line", () =>
    expect(bufferPhysicalRows(paint({ lines: ["a", "b", "c"], cursor: { row: 2, col: 1 } }))).toBe(3));
  it("a long line wraps at innerWidth", () =>
    expect(bufferPhysicalRows(paint({ lines: ["x".repeat(25)], cursor: { row: 0, col: 25 }, innerWidth: 10 }))).toBe(3));
});

describe("bufferPhysicalRows — the EOL cursor cell at the inner-width boundary (cap−1 / cap / cap+1)", () => {
  const atEol = (n: number) => paint({ lines: ["x".repeat(n)], cursor: { row: 0, col: n }, innerWidth: 10 });
  it("innerWidth−1 characters with the cursor at EOL: one row", () => expect(bufferPhysicalRows(atEol(9))).toBe(1));
  it("innerWidth characters with the cursor at EOL: TWO rows — the blank cursor cell wraps", () =>
    expect(bufferPhysicalRows(atEol(10))).toBe(2));
  it("innerWidth+1 characters with the cursor at EOL: two rows", () => expect(bufferPhysicalRows(atEol(11))).toBe(2));
  it("the same line with the cursor INSIDE it does not gain the row", () =>
    expect(bufferPhysicalRows(paint({ lines: ["x".repeat(10)], cursor: { row: 0, col: 4 }, innerWidth: 10 }))).toBe(1));
});

describe("bufferPhysicalRows — the ghost suffix", () => {
  it("a ghost that fits adds no row", () =>
    expect(bufferPhysicalRows(paint({ lines: ["/mo"], cursor: { row: 0, col: 3 }, ghost: "del", innerWidth: 10 }))).toBe(1));
  it("a ghost that crosses the boundary adds one", () =>
    expect(bufferPhysicalRows(paint({ lines: ["/mo"], cursor: { row: 0, col: 3 }, ghost: "delpicker", innerWidth: 10 }))).toBe(2));
});

describe("bufferPhysicalRows — the placeholder replaces the buffer when it is empty", () => {
  it("a placeholder wider than the row counts its own wrapped height", () =>
    expect(bufferPhysicalRows(paint({ lines: [""], cursor: { row: 0, col: 0 }, placeholder: "y".repeat(25), innerWidth: 10 }))).toBe(3));
  it("a non-empty buffer ignores the placeholder entirely", () =>
    expect(bufferPhysicalRows(paint({ lines: ["ab"], cursor: { row: 0, col: 2 }, placeholder: "y".repeat(25) }))).toBe(1));
});

// ── 1.11a — THE PURE ARITHMETIC TABLE (pane heights × footer configs) ──────────────────────────────────────
// `composerOriginRow` computes the buffer's first painted row FROM BELOW: every term is either the frame's
// own (`dockTop`/`dockBottom`), the app's own (`footerRows`, read off the REAL `footerRows(footerStatusInput)`
// call so this table cannot drift from the paint the way `dockDialogRows` already has) or the composer's own.
// Each row of the table stands in for one `dockBottom` (a pane height, since `dockBottom` IS the frame's last
// row at that height) crossed with one footer shape, one buffer height, one inline-search state and one
// waiting-for-permission state.
describe("composerOriginRow — the pane-height × footer-config table", () => {
  // `dockTop` is fixed at 2 across the table: the sanity floor a refusal compares `composerTop` against,
  // chosen small enough that only the deliberate refusal rows below cross it.
  const DOCK_TOP = 2;
  const footerConfigs = {
    statusLineOff: footerRows({ statusLineConfigured: false, statusLineText: undefined, bashMode: false, pasting: false, exitArm: undefined, rows: 24, fullscreen: true }),
    oneLine: footerRows({ statusLineConfigured: true, statusLineText: "one", bashMode: false, pasting: false, exitArm: undefined, rows: 24, fullscreen: true }),
    threeLines: footerRows({ statusLineConfigured: true, statusLineText: "one\ntwo\nthree", bashMode: false, pasting: false, exitArm: undefined, rows: 24, fullscreen: true }),
    bashMode: footerRows({ statusLineConfigured: true, statusLineText: "one", bashMode: true, pasting: false, exitArm: undefined, rows: 24, fullscreen: true }),
    armedExit: footerRows({ statusLineConfigured: true, statusLineText: "one", bashMode: false, pasting: false, exitArm: { key: "Ctrl-C", verb: "exit" }, rows: 24, fullscreen: true }),
  };
  const dockBottoms = [24, 30, 40, 15];
  const bufferHeights = [1, 2, 5];

  for (const dockBottom of dockBottoms) {
    for (const [label, footerRowsN] of Object.entries(footerConfigs)) {
      for (const bufferPhysicalRowsN of bufferHeights) {
        for (const inlineSearchOpen of [false, true]) {
          for (const waitingForPermission of [false, true]) {
            it(`dockBottom=${dockBottom} footer=${label}(${footerRowsN}) buffer=${bufferPhysicalRowsN} search=${inlineSearchOpen} waiting=${waitingForPermission}`, () => {
              const input = { dockTop: DOCK_TOP, dockBottom, footerRows: footerRowsN, inlineSearchOpen, waitingForPermission, paletteHoisted: false, bufferPhysicalRows: bufferPhysicalRowsN };
              const bufferBottom = dockBottom - footerRowsN - (inlineSearchOpen ? 1 : 0) - 1;
              const bufferTop = bufferBottom - (Math.max(1, bufferPhysicalRowsN) - 1);
              const composerTop = bufferTop - 1 - (waitingForPermission ? 2 : 0);
              const expected = composerTop >= DOCK_TOP ? bufferTop : 0;
              expect(composerOriginRow(input)).toBe(expected);
            });
          }
        }
      }
    }
  }

  it("refuses when dockBottom is 0 (the frame's watchdog fired)", () =>
    expect(composerOriginRow({ dockTop: DOCK_TOP, dockBottom: 0, footerRows: 2, inlineSearchOpen: false, waitingForPermission: false, paletteHoisted: false, bufferPhysicalRows: 1 })).toBe(0));

  it("refuses when dockTop is 0 (classic / no frame)", () =>
    expect(composerOriginRow({ dockTop: 0, dockBottom: 23, footerRows: 2, inlineSearchOpen: false, waitingForPermission: false, paletteHoisted: false, bufferPhysicalRows: 1 })).toBe(0));

  it("refuses when footerRows is 0 (prop not supplied)", () =>
    expect(composerOriginRow({ dockTop: DOCK_TOP, dockBottom: 23, footerRows: 0, inlineSearchOpen: false, waitingForPermission: false, paletteHoisted: false, bufferPhysicalRows: 1 })).toBe(0));

  it("refuses when the palette is hoisted", () =>
    expect(composerOriginRow({ dockTop: DOCK_TOP, dockBottom: 23, footerRows: 2, inlineSearchOpen: false, waitingForPermission: false, paletteHoisted: true, bufferPhysicalRows: 1 })).toBe(0));
});
