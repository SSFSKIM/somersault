// test/unit/usageFormat.test.ts — pure /usage + status-bar formatters (probe 55 payload shape).
import { describe, it, expect } from "vitest";
import { formatUsage, usageWarning, usageSummaryLine, UNAVAILABLE } from "../../src/tui/usageFormat.js";

describe("formatUsage", () => {
  it("renders one bar row per present window with a % and a reset time", () => {
    const u = { rate_limits_available: true, rate_limits: {
      five_hour: { utilization: 0.43, resets_at: "2026-07-28T15:00:00Z" },
      seven_day: { utilization: 12 },
    } };
    const lines = formatUsage(u);
    expect(lines.length).toBe(3);   // header + 2 window rows
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toMatch(/%/);
    expect(text).toContain("resets");
  });

  it("normalizes utilization arriving as a fraction (0-1) or a percent (0-100) to the same %", () => {
    const fraction = formatUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 0.43 } } });
    const percent = formatUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 43 } } });
    expect(fraction.map((l) => l.text).join("\n")).toContain("43%");
    expect(percent.map((l) => l.text).join("\n")).toContain("43%");
  });

  it("infers the unit once across the whole payload: a mixed percent/1 payload reads 43% and 1%, not 43% and 100%", () => {
    const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 43 }, seven_day: { utilization: 1 } } };
    const text = formatUsage(u).map((l) => l.text).join("\n");
    expect(text).toContain("43%");
    expect(text).toContain("1%");
    expect(text).not.toContain("100%");
    expect(usageWarning(u)).toBeUndefined();
  });

  it("an all-fraction payload (including a bare 1.0) reads 43% and 100%, and fires the warning", () => {
    const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 0.43 }, seven_day: { utilization: 1 } } };
    const text = formatUsage(u).map((l) => l.text).join("\n");
    expect(text).toContain("43%");
    expect(text).toContain("100%");
    expect(usageWarning(u)).toBe("⚠ 7d 100%");
  });

  it("degrades to the exact honest-unavailable line when rate_limits_available is false", () => {
    expect(formatUsage({ rate_limits_available: false })).toEqual([
      { text: "plan usage not available under this credential (claude setup-token has no profile scope)", dim: true },
    ]);
    expect(formatUsage({ rate_limits_available: false })).toEqual([{ text: UNAVAILABLE, dim: true }]);
  });

  it("degrades to the honest-unavailable line when rate_limits is missing/null", () => {
    expect(formatUsage({ rate_limits_available: true, rate_limits: null })).toEqual([{ text: UNAVAILABLE, dim: true }]);
    expect(formatUsage(undefined)).toEqual([{ text: UNAVAILABLE, dim: true }]);
  });

  it("bar geometry: 10 cells, 43% -> 4 filled", () => {
    const text = formatUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 43 } } }).map((l) => l.text).join("\n");
    expect(text).toContain("▓▓▓▓░░░░░░");
  });
});

describe("usageWarning", () => {
  it("undefined below 80% (79%)", () => {
    expect(usageWarning({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 79 } } })).toBeUndefined();
  });
  it("warns at exactly 80% (boundary is inclusive)", () => {
    expect(usageWarning({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 80 } } })).toBe("⚠ 5h 80%");
  });
  it("warns at 85% on seven_day and picks the max window across windows", () => {
    const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 40 }, seven_day: { utilization: 85 } } };
    expect(usageWarning(u)).toBe("⚠ 7d 85%");
  });
  it("undefined when unavailable", () => {
    expect(usageWarning({ rate_limits_available: false })).toBeUndefined();
  });
});

describe("usageSummaryLine", () => {
  it("formats multiple present windows compactly", () => {
    const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 43 }, seven_day: { utilization: 12 } } };
    expect(usageSummaryLine(u)).toBe("5h 43% · 7d 12%");
  });
  it("undefined when unavailable", () => {
    expect(usageSummaryLine({ rate_limits_available: false })).toBeUndefined();
  });
});
