// tui/test/thinkLevels.test.ts — pure level↔budget vocabulary.
import { describe, it, expect } from "vitest";
import { THINK_LEVELS, thinkBudget, thinkLabel, parseThinkArg, thinkingConfigFrom } from "../../src/tui/thinkLevels.js";

describe("thinkLevels", () => {
  it("THINK_LEVELS is the effort-enum vocabulary plus off", () => {
    expect(THINK_LEVELS).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
  });
  it("thinkBudget maps each level to its token budget", () => {
    expect(thinkBudget("off")).toBe(0);
    expect(thinkBudget("low")).toBe(4000);
    expect(thinkBudget("high")).toBe(16000);
    expect(thinkBudget("max")).toBe(32000);
    expect(thinkBudget("nonsense")).toBe(0);
  });
  it("thinkLabel reverses an exact budget to its name, else Nk", () => {
    expect(thinkLabel(0)).toBe("off");
    expect(thinkLabel(16000)).toBe("high");
    expect(thinkLabel(15000)).toBe("15k");
  });
  it("parseThinkArg accepts a level name or a raw integer, else null", () => {
    expect(parseThinkArg("high")).toEqual({ level: "high", budget: 16000 });
    expect(parseThinkArg("off")).toEqual({ level: "off", budget: 0 });
    expect(parseThinkArg("16000")).toEqual({ level: "high", budget: 16000 });
    expect(parseThinkArg("15000")).toEqual({ level: "15k", budget: 15000 });
    expect(parseThinkArg("bogus")).toBeNull();
    expect(parseThinkArg("-5")).toBeNull();
  });
  // F4: shared by every --think-consuming launch path (runForegroundImpl, hostMain's --__host child,
  // the -p runOnce path) so the flag behaves identically no matter which one reads it.
  it("thinkingConfigFrom maps a level to the SDK config's thinking field", () => {
    expect(thinkingConfigFrom("high")).toEqual({ type: "enabled", budgetTokens: 16000 });
    expect(thinkingConfigFrom("off")).toEqual({ type: "disabled" });
    expect(thinkingConfigFrom("16000")).toEqual({ type: "enabled", budgetTokens: 16000 });
  });
  it("thinkingConfigFrom is undefined when --think was not given or failed to parse", () => {
    expect(thinkingConfigFrom(undefined)).toBeUndefined();
    expect(thinkingConfigFrom("bogus")).toBeUndefined();
  });
});
