// harness/test/unit/auto-model.test.ts
import { describe, it, expect } from "vitest";
import { DEFAULT_AUTO_MODEL, isAutoSupportedModel, resolveAutoModel } from "../../src/config/autoModel.js";

describe("auto-mode model gating", () => {
  it("recognizes the Claude-5 generation (probe 72) and the 4.x models, rejects others", () => {
    expect(isAutoSupportedModel("claude-fable-5")).toBe(true);
    expect(isAutoSupportedModel("claude-opus-5")).toBe(true);
    expect(isAutoSupportedModel("claude-sonnet-5")).toBe(true);
    expect(isAutoSupportedModel("claude-sonnet-4-6")).toBe(true);
    expect(isAutoSupportedModel("claude-opus-4-8")).toBe(true);
    expect(isAutoSupportedModel("claude-haiku-4-5-20251001")).toBe(false);
    expect(isAutoSupportedModel("claude-sonnet-4-5")).toBe(false);
    expect(isAutoSupportedModel(undefined)).toBe(false);
  });
  it("a tier ALIAS is not an id — it must be resolved before this gate, or it reads as unsupported", () => {
    expect(isAutoSupportedModel("opus")).toBe(false);
    expect(isAutoSupportedModel("fable")).toBe(false);
  });
  it("resolveAutoModel forces DEFAULT for unsupported/absent, preserves supported", () => {
    expect(DEFAULT_AUTO_MODEL).toBe("claude-sonnet-5");
    expect(resolveAutoModel("claude-haiku-4-5-20251001")).toBe("claude-sonnet-5");
    expect(resolveAutoModel(undefined)).toBe("claude-sonnet-5");
    expect(resolveAutoModel("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(resolveAutoModel("claude-fable-5")).toBe("claude-fable-5");
  });
});
