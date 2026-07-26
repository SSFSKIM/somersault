import { describe, it, expect } from "vitest";
import { formatBanner } from "../../src/cli/banner.js";

describe("formatBanner", () => {
  it("emits `backgrounded · <short>` with U+00B7", () => {
    expect(formatBanner("a1b2c3d4")).toBe("backgrounded · a1b2c3d4");
  });
  it("round-trips through the exact sed doperpowers uses", () => {
    // sed -n 's/.*backgrounded · \([0-9a-f][0-9a-f]*\).*/\1/p'
    const m = formatBanner("a1b2c3d4").match(/.*backgrounded · ([0-9a-f][0-9a-f]*).*/);
    expect(m?.[1]).toBe("a1b2c3d4");
  });
  it("refuses a short id that is not exactly 8 hex — that would silently disable the purge", () => {
    expect(() => formatBanner("a1b2c3d")).toThrow(/8/);       // 7 chars
    expect(() => formatBanner("a1b2c3d4e")).toThrow(/8/);     // 9 chars
    expect(() => formatBanner("A1B2C3D4")).toThrow(/8/);      // uppercase: the sed class is [0-9a-f]
  });
});
