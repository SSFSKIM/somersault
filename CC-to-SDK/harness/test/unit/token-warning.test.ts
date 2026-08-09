// test/unit/token-warning.test.ts — Wave C Task 14: the token-warning LADDER, pure.
//
// The three fixtures the plan names (ceiling−21k · ceiling−19k · past ceiling) plus the two boundaries
// they straddle, because a ladder is exactly the kind of thing that ships off-by-one at its own edges.
// Window 200 000 throughout, so the ceiling is a round 160 000 and every expected percentage can be
// worked out by hand in the assertion itself.
import { describe, it, expect } from "vitest";
import {
  TOKEN_WARNING_KEY, TOKEN_WARNING_TIMEOUT_MS, TOKEN_WARN_LEAD_TOKENS, AUTO_COMPACT_BUFFER_FRACTION,
  autoCompactCeiling, tokenWarning,
} from "../../src/tui/tokenWarning.js";

const WINDOW = 200_000;
const CEILING = 160_000;                                   // 200 000 × (1 − 0.2)

describe("the pinned constants", () => {
  it("carries the spec's own key, priority timeout and buffers", () => {
    expect(TOKEN_WARNING_KEY).toBe("token-warning");
    expect(TOKEN_WARNING_TIMEOUT_MS).toBe(18_000_000);
    expect(TOKEN_WARN_LEAD_TOKENS).toBe(20_000);
    expect(AUTO_COMPACT_BUFFER_FRACTION).toBe(0.2);
  });
  it("the ceiling is the window minus the 0.2 buffer fraction", () => {
    expect(autoCompactCeiling(WINDOW)).toBe(CEILING);
    expect(autoCompactCeiling(100_000)).toBe(80_000);
  });
});

describe("tokenWarning ladder", () => {
  it("ceiling − 21k: below the warn threshold, nothing to post", () => {
    expect(tokenWarning(CEILING - 21_000, WINDOW)).toBeNull();
  });

  it("ceiling − 19k: the warn text, N = percent of the CEILING remaining", () => {
    // (160 000 − 141 000) / 160 000 = 11.875% → 12
    expect(tokenWarning(CEILING - 19_000, WINDOW)).toEqual({ text: "12% until auto-compact", error: false });
  });

  it("past the ceiling: the error escalation, percentLeft clamped at 0", () => {
    expect(tokenWarning(CEILING + 5_000, WINDOW)).toEqual({
      text: "Context low (0% remaining) · Run /compact to compact & continue", error: true,
    });
  });

  it("the two boundaries are inclusive on the way up", () => {
    expect(tokenWarning(CEILING - TOKEN_WARN_LEAD_TOKENS - 1, WINDOW)).toBeNull();
    expect(tokenWarning(CEILING - TOKEN_WARN_LEAD_TOKENS, WINDOW)).toEqual({ text: "13% until auto-compact", error: false });
    expect(tokenWarning(CEILING - 1, WINDOW)).toEqual({ text: "0% until auto-compact", error: false });
    expect(tokenWarning(CEILING, WINDOW)).toEqual({
      text: "Context low (0% remaining) · Run /compact to compact & continue", error: true,
    });
  });

  it("a window we do not know is not a window we may warn about", () => {
    expect(tokenWarning(150_000, 0)).toBeNull();
    expect(tokenWarning(150_000, undefined)).toBeNull();
    expect(tokenWarning(undefined, WINDOW)).toBeNull();
  });
});
