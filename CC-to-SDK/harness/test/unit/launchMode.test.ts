import { describe, it, expect } from "vitest";
import { resolveLaunchPermissionMode } from "../../src/cli/launchMode.js";

describe("resolveLaunchPermissionMode", () => {
  it("explicit mode always wins, even auto on an unsupported model", () => {
    expect(resolveLaunchPermissionMode({ explicitMode: "default", effectiveModel: "claude-opus-5" }))
      .toEqual({ mode: "default", explicit: true });
    expect(resolveLaunchPermissionMode({ explicitMode: "auto", effectiveModel: "claude-haiku-4-5-20251001" }))
      .toEqual({ mode: "auto", explicit: true });
  });
  it("defaulted: auto-capable model (incl. via alias) → auto", () => {
    expect(resolveLaunchPermissionMode({ effectiveModel: "claude-opus-5" }).mode).toBe("auto");
    expect(resolveLaunchPermissionMode({ effectiveModel: "opus" }).mode).toBe("auto");     // alias resolves FIRST
    expect(resolveLaunchPermissionMode({ effectiveModel: undefined }).mode).toBe("auto");  // DEFAULTS.model is auto-capable
  });
  it("defaulted: non-auto model → default, and never explicit", () => {
    const r = resolveLaunchPermissionMode({ effectiveModel: "claude-haiku-4-5-20251001" });
    expect(r).toEqual({ mode: "default", explicit: false });
  });
});
