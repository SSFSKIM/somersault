import { describe, it, expect } from "vitest";
import { validateHarnessConfig, validateDaemonOptions, HarnessConfigError, harnessConfigSchema } from "../../src/config/validate.js";

describe("validateHarnessConfig", () => {
  it("accepts a valid config and passes escape-hatch fields untouched", () => {
    expect(() => validateHarnessConfig({ model: "claude-haiku-4-5", maxTurns: 3, effort: "high",
      thinking: { type: "enabled", budgetTokens: 1024 }, permissionMode: "acceptEdits",
      extraOptions: { anything: 123 }, settings: { whatever: true } })).not.toThrow();
    expect(() => validateHarnessConfig({})).not.toThrow();
    expect(harnessConfigSchema.parse({ extraOptions: { x: 1 }, settings: { y: true } })).toMatchObject({ extraOptions: { x: 1 }, settings: { y: true } });
  });
  it("rejects bad enums / numerics / shapes with HarnessConfigError naming the path", () => {
    expect(() => validateHarnessConfig({ permissionMode: "bogus" })).toThrow(HarnessConfigError);
    expect(() => validateHarnessConfig({ maxTurns: 0 })).toThrow(/maxTurns/);
    expect(() => validateHarnessConfig({ maxBudgetUsd: -1 })).toThrow(/maxBudgetUsd/);
    expect(() => validateHarnessConfig({ effort: "ultra" })).toThrow(/effort/);
    expect(() => validateHarnessConfig({ thinking: { type: "enabled" } })).not.toThrow(); // budgetTokens is optional (SDK-valid)
    expect(() => validateHarnessConfig({ thinking: { type: "enabled", budgetTokens: -1 } })).toThrow(/thinking|budgetTokens/); // negative budget invalid
    expect(() => validateHarnessConfig({ maxTurns: "five" as any })).toThrow(/maxTurns/);
  });
  it("rejects an mcpToolTimeoutMs the SDK would silently ignore (< 1000ms)", () => {
    expect(() => validateHarnessConfig({ mcpToolTimeoutMs: 500 })).toThrow(HarnessConfigError);
    expect(() => validateHarnessConfig({ mcpToolTimeoutMs: 500 })).toThrow(/1000/);
    expect(() => validateHarnessConfig({ mcpToolTimeoutMs: 1000 })).not.toThrow();
  });
  it("checks modelSwitchPolicy's data fields and leaves its callbacks alone", () => {
    expect(() => validateHarnessConfig({ modelSwitchPolicy: { allowModels: ["sonnet"], maxCacheWriteUsd: 0.5, decide: () => ({}) } })).not.toThrow();
    expect(() => validateHarnessConfig({ modelSwitchPolicy: { allowModels: "sonnet" } })).toThrow(/modelSwitchPolicy.allowModels/);
    expect(() => validateHarnessConfig({ modelSwitchPolicy: { maxCacheWriteUsd: -1 } })).toThrow(/maxCacheWriteUsd/);
  });
});
describe("validateDaemonOptions", () => {
  it("accepts valid daemon options and rejects a bad restart / negative bound", () => {
    expect(() => validateDaemonOptions({ model: "m", restart: "on-failure", maxSessions: 8 })).not.toThrow();
    expect(() => validateDaemonOptions({ restart: "sometimes" })).toThrow(HarnessConfigError);
    expect(() => validateDaemonOptions({ maxSessions: -1 })).toThrow(/maxSessions/);
  });
});
