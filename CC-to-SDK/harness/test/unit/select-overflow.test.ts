// test/unit/select-overflow.test.ts — Wave S t5: the counted overflow indicators, now shared. They used to be
// two consts inside `rewindModel.ts`, which made every other windowed list either import the rewind picker's
// model or spell the strings a second time; `src/tui/select/overflow.ts` is the one spelling, and this pins
// both the COPY (upstream's counted form, L441977/L441980) and the arithmetic that feeds it.
import { describe, expect, it } from "vitest";
import { moreAbove, moreBelow, overflowRows } from "../../src/tui/select/overflow.js";
import { moreAbove as rewindMoreAbove, moreBelow as rewindMoreBelow } from "../../src/tui/rewindModel.js";

describe("overflow indicators", () => {
  it("uses upstream's counted form (L441977/L441980)", () => {
    expect(moreAbove(3)).toBe("↑ 3 more above");
    expect(moreBelow(7)).toBe("↓ 7 more below");
  });
  // The re-export is the point of the move: one spelling, and the rewind picker's existing import keeps
  // resolving to it rather than to a second copy that could drift.
  it("is the same function the rewind picker still imports from `rewindModel`", () => {
    expect(rewindMoreAbove).toBe(moreAbove);
    expect(rewindMoreBelow).toBe(moreBelow);
  });
  it("derives both counts from the reported window", () => {
    expect(overflowRows({ start: 4, end: 9 }, 20)).toEqual({ above: 4, below: 11 });
    expect(overflowRows({ start: 0, end: 20 }, 20)).toEqual({ above: 0, below: 0 });
  });
});
