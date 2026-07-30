// harness/test/unit/model-alias.test.ts
import { describe, it, expect } from "vitest";
import { MODEL_ALIASES, resolveModelAlias } from "../../src/config/models.js";
import { resolveOptions } from "../../src/config/resolveOptions.js";

describe("tier-alias → explicit model id (probe 72)", () => {
  it("pins the tiers whose SDK alias lags the Claude-5 generation", () => {
    expect(resolveModelAlias("opus")).toBe("claude-opus-5");       // SDK's own `opus` alias still means Opus 4.8
    expect(resolveModelAlias("sonnet")).toBe("claude-sonnet-5");
    expect(resolveModelAlias("fable")).toBe("claude-fable-5");
  });
  it("is case- and whitespace-insensitive (the picker's displayName is 'Opus')", () => {
    expect(resolveModelAlias("Opus")).toBe("claude-opus-5");
    expect(resolveModelAlias(" SONNET ")).toBe("claude-sonnet-5");
  });
  it("passes an explicit model id through untouched, and undefined stays undefined", () => {
    expect(resolveModelAlias("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(resolveModelAlias("claude-fable-5[1m]")).toBe("claude-fable-5[1m]");   // the catalog's 1M variant
    expect(resolveModelAlias(undefined)).toBeUndefined();
  });
  it("`default` is OUR default (opus 5), not the SDK's recommendation (which is sonnet 5)", () => {
    expect(resolveModelAlias("default")).toBe("claude-opus-5");
  });
  it("leaves `haiku` to the SDK — its target is already current and has no 5-gen successor", () => {
    expect(MODEL_ALIASES.haiku).toBeUndefined();
    expect(resolveModelAlias("haiku")).toBe("haiku");
  });
  it("resolveOptions translates a tier alias before the auto gate sees it", () => {
    // Order matters: unresolved, "opus" fails isAutoSupportedModel and would be DOWNGRADED to the auto default.
    expect((resolveOptions({ model: "opus" }) as any).model).toBe("claude-opus-5");
    expect((resolveOptions({ model: "opus", permissionMode: "auto" }) as any).model).toBe("claude-opus-5");
    expect((resolveOptions({ model: "fable", permissionMode: "auto" }) as any).model).toBe("claude-fable-5");
  });
});
