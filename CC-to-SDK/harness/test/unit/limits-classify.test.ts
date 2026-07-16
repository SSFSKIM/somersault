import { describe, it, expect } from "vitest";
import { classifyLimitText, classifyLimitMessage } from "../../src/limits/classify.js";

describe("classifyLimitText", () => {
  it("classifies SDK usage-limit prefixes", () => {
    expect(classifyLimitText("You've hit your usage limit for today.")?.kind).toBe("usage-limit");
    expect(classifyLimitText("You're out of usage credits · resets at 3pm")?.kind).toBe("usage-limit");
    expect(classifyLimitText("Your org is out of usage · add funds to continue")?.kind).toBe("usage-limit");
  });
  it("classifies the declared org-policy prefix AND the 2026-07 observed family (embedded)", () => {
    expect(classifyLimitText("This service is disabled for your org.")?.kind).toBe("org-policy");
    // the incident text arrived as the RESULT of a subtype:"success" turn, mid-sentence matching required
    const incident = "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access";
    expect(classifyLimitText(incident)?.kind).toBe("org-policy");
    expect(classifyLimitText("Note: " + incident)?.kind).toBe("org-policy");
  });
  it("classifies API-credit exhaustion (observed, containment)", () => {
    expect(classifyLimitText("API Error: 400 Credit balance is too low")?.kind).toBe("credits-exhausted");
  });
  it("classifies transitions and warnings by their distinct prefixes", () => {
    expect(classifyLimitText("You're now using usage credits.")?.kind).toBe("usage-transition");
    expect(classifyLimitText("You've used 80% of your weekly limit")?.kind).toBe("usage-warning");
  });
  it("returns undefined for normal text and empty input", () => {
    expect(classifyLimitText("The refactor is complete; 12 tests pass.")).toBeUndefined();
    expect(classifyLimitText("")).toBeUndefined();
  });
});

describe("classifyLimitMessage", () => {
  it("classifies result frames by their text", () => {
    expect(classifyLimitMessage({ type: "result", subtype: "success", result: "You've hit your limit" })?.kind).toBe("usage-limit");
    expect(classifyLimitMessage({ type: "result", subtype: "success", result: "OK" })).toBeUndefined();
  });
  it("classifies rejected rate_limit_event frames, carrying resetsAt", () => {
    const s = classifyLimitMessage({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1234 } });
    expect(s).toEqual({ kind: "rate-limit", message: "rate limited (five_hour)", resetsAt: 1234 });
  });
  it("treats allowed/warning rate events and unrelated frames as healthy", () => {
    expect(classifyLimitMessage({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })).toBeUndefined();
    expect(classifyLimitMessage({ type: "assistant", message: { content: [] } })).toBeUndefined();
    expect(classifyLimitMessage(null)).toBeUndefined();
  });
});
