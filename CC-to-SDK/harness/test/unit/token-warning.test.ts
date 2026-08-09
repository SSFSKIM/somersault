// test/unit/token-warning.test.ts — Wave C Task 14: the token-warning LADDER, pure.
//
// The three fixtures the plan names (ceiling−21k · ceiling−19k · past ceiling) plus the two boundaries
// they straddle, because a ladder is exactly the kind of thing that ships off-by-one at its own edges.
// Window 200 000 throughout, so the ceiling is 200 000 − 33 000 = 167 000 (see the module header: the
// reserve is upstream's `min(maxOutputTokens, 20 000) + 13 000`). 167 000 is NOT a round number, so every
// expected percentage below carries its own arithmetic in a comment — worked by hand, not read off the
// implementation.
import { describe, it, expect } from "vitest";
import {
  TOKEN_WARNING_KEY, TOKEN_WARNING_TIMEOUT_MS, TOKEN_WARN_LEAD_TOKENS,
  MAX_OUTPUT_RESERVE_TOKENS, COMPACT_HEADROOM_TOKENS, AUTO_COMPACT_RESERVE_TOKENS,
  autoCompactCeiling, tokenWarning,
} from "../../src/tui/tokenWarning.js";

const WINDOW = 200_000;
const CEILING = 167_000;                                   // 200 000 − 20 000 − 13 000

describe("the pinned constants", () => {
  it("carries the spec's own key, priority timeout and buffers", () => {
    expect(TOKEN_WARNING_KEY).toBe("token-warning");
    expect(TOKEN_WARNING_TIMEOUT_MS).toBe(18_000_000);
    expect(TOKEN_WARN_LEAD_TOKENS).toBe(20_000);
    expect(MAX_OUTPUT_RESERVE_TOKENS).toBe(20_000);
    expect(COMPACT_HEADROOM_TOKENS).toBe(13_000);
    expect(AUTO_COMPACT_RESERVE_TOKENS).toBe(33_000);
  });
  it("the ceiling is upstream's own: window − min(maxOutputTokens, 20 000) − 13 000", () => {
    expect(autoCompactCeiling(WINDOW)).toBe(CEILING);      // 200 000 − 33 000
    expect(autoCompactCeiling(1_000_000)).toBe(967_000);   // 1 000 000 − 33 000 (the 1M-context models)
    expect(autoCompactCeiling(100_000)).toBe(67_000);      // 100 000 − 33 000
  });
});

describe("tokenWarning ladder", () => {
  it("ceiling − 21k: below the warn threshold, nothing to post", () => {
    expect(tokenWarning(CEILING - 21_000, WINDOW)).toBeNull();               // used = 146 000
  });

  it("ceiling − 19k: the warn text, N = percent of the CEILING remaining", () => {
    // used = 148 000 → (167 000 − 148 000) / 167 000 = 19 000 / 167 000 = 11.377% → 11
    expect(tokenWarning(CEILING - 19_000, WINDOW)).toEqual({ text: "11% until auto-compact", error: false });
  });

  it("past the ceiling: the error escalation, percentLeft clamped at 0", () => {
    expect(tokenWarning(CEILING + 5_000, WINDOW)).toEqual({                  // used = 172 000
      text: "Context low (0% remaining) · Run /compact to compact & continue", error: true,
    });
  });

  it("the two boundaries are inclusive on the way up", () => {
    expect(tokenWarning(CEILING - TOKEN_WARN_LEAD_TOKENS - 1, WINDOW)).toBeNull();   // used = 146 999
    // used = 147 000 → 20 000 / 167 000 = 11.976% → 12
    expect(tokenWarning(CEILING - TOKEN_WARN_LEAD_TOKENS, WINDOW)).toEqual({ text: "12% until auto-compact", error: false });
    // used = 166 999 → 1 / 167 000 = 0.0006% → 0
    expect(tokenWarning(CEILING - 1, WINDOW)).toEqual({ text: "0% until auto-compact", error: false });
    expect(tokenWarning(CEILING, WINDOW)).toEqual({                          // used = 167 000
      text: "Context low (0% remaining) · Run /compact to compact & continue", error: true,
    });
  });

  it("a window we do not know is not a window we may warn about", () => {
    expect(tokenWarning(150_000, 0)).toBeNull();
    expect(tokenWarning(150_000, undefined)).toBeNull();
    expect(tokenWarning(undefined, WINDOW)).toBeNull();
    // …and neither is a window SMALLER than the reserve it would have to subtract: the ceiling would go
    // negative and the clamp-free percentage would read back a confident `100% remaining` off a negative
    // denominator. Real Claude windows are 200k/1M; a 200-token `maxTokens` is a stub or a stand-in, and the
    // honest answer to a stub is silence.
    expect(tokenWarning(50, 200)).toBeNull();
    expect(tokenWarning(1_000, AUTO_COMPACT_RESERVE_TOKENS)).toBeNull();
  });
});
