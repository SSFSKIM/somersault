// tui/test/compaction-bar.test.ts — Wave S Task 11 (EP-S7). Pins upstream's compaction bar geometry AND
// pins the curve as the theatre it is: the vectors below are `min(95, round((1-e^(-s/90))*100))` computed
// off wall-clock, which is what upstream does. Nothing here measures compaction progress, because nothing
// on the SDK wire reports it (see compactionBar.ts's header).
import { describe, it, expect } from "vitest";
import { COMPACTING_VERB, BAR_MAX_WIDTH, BAR_MIN_WIDTH, BAR_MARGIN_LEFT, compactionRatio, barWidth, barCells } from "../../src/tui/compactionBar.js";

describe("compactionBar", () => {
  it("is upstream's saturating curve, not a measurement (W-S4)", () => {
    expect(compactionRatio(30_000)).toBe(28);
    expect(compactionRatio(60_000)).toBe(49);
    expect(compactionRatio(90_000)).toBe(63);
    expect(compactionRatio(180_000)).toBe(86);
    expect(compactionRatio(600_000)).toBe(95);          // the cap
  });
  it("never goes backwards", () => {
    expect(compactionRatio(10_000, 40)).toBe(40);
  });
  it("is 40 cells at most and suppressed below 8", () => {
    expect(barWidth(200)).toBe(40);
    expect(barWidth(30)).toBe(22);
    expect(barWidth(14)).toBe(0);                       // 14-2-6 = 6 < 8 → suppressed
  });
  it("fills whole cells only, with the pill glyphs", () => {
    expect(barCells(50, 10)).toEqual({ fill: "▰".repeat(5), empty: "▱".repeat(5) });
    expect(barCells(50, 10, true)).toEqual({ fill: "█".repeat(5), empty: "░".repeat(5) });
  });
  // Guards added beyond the plan's vectors: a negative elapsed (a clock that went backwards between the
  // stamp and the read) must not produce a negative ratio, and the ratio is a PERCENTAGE — a 0..1 fraction
  // fed in by a later "fix" would fill nothing, not the whole bar.
  it("clamps the ends", () => {
    expect(compactionRatio(-5_000)).toBe(0);
    expect(barCells(0, 10)).toEqual({ fill: "", empty: "▱".repeat(10) });
    expect(barCells(95, 40).fill.length).toBe(38);
    expect(barCells(200, 10)).toEqual({ fill: "▰".repeat(10), empty: "" });
  });
  it("carries upstream's verb and geometry constants", () => {
    expect(COMPACTING_VERB).toBe("Compacting conversation");
    expect([BAR_MAX_WIDTH, BAR_MIN_WIDTH, BAR_MARGIN_LEFT]).toEqual([40, 8, 2]);
  });
});
