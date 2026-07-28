// test/unit/usageFormat.test.ts — pure /usage + status-bar formatters (probe 55 payload shape).
import { describe, it, expect } from "vitest";
import { formatUsage, usageWarning, usageSummaryLine, UNAVAILABLE } from "../../src/tui/usageFormat.js";

describe("formatUsage", () => {
  it("renders one bar row per present window with a % and a reset time", () => {
    const u = { rate_limits_available: true, rate_limits: {
      five_hour: { utilization: 43, resets_at: "2026-07-28T15:00:00Z" },
      seven_day: { utilization: 12 },
    } };
    const lines = formatUsage(u);
    expect(lines.length).toBe(3);   // header + 2 window rows
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toMatch(/%/);
    expect(text).toContain("resets");
  });

  it("reads utilization as the percentage the SDK declares it to be (0-100), with no unit inference", () => {
    // sdk.d.ts SDKControlGetUsageResponse documents every window's utilization as "Percentage of the
    // window used, 0-100". An earlier revision inferred the unit from the values (<=1 treated as a
    // fraction and scaled ×100), which turned a genuine 1% into 100% and fired the ≥80% warning on a
    // nearly-unused plan. These pin the contract so that inference cannot come back.
    const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 43 }, seven_day: { utilization: 1 } } };
    const text = formatUsage(u).map((l) => l.text).join("\n");
    expect(text).toContain("43%");
    expect(text).toContain("1%");
    expect(text).not.toContain("100%");
    expect(usageWarning(u)).toBeUndefined();
  });

  it("a genuinely low payload stays low — every window at or below 1% must not read as 100%", () => {
    const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 1 }, seven_day: { utilization: 0.4 } } };
    const text = formatUsage(u).map((l) => l.text).join("\n");
    expect(text).toContain("1%");
    expect(text).not.toContain("100%");
    expect(text).not.toContain("40%");
    expect(usageWarning(u)).toBeUndefined();
  });

  it("includes the oauth-apps window, the server's dynamic model_scoped buckets, and enabled extra_usage", () => {
    const u = { rate_limits_available: true, rate_limits: {
      five_hour: { utilization: 5 },
      seven_day_oauth_apps: { utilization: 22 },
      model_scoped: [{ display_name: "Fable", utilization: 91, resets_at: "2026-07-30T09:00:00Z" }],
      extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 30, utilization: 30 },
    } };
    const text = formatUsage(u).map((l) => l.text).join("\n");
    expect(text).toContain("7d apps");
    expect(text).toContain("22%");
    expect(text).toContain("Fable");
    expect(text).toContain("91%");
    expect(text).toContain("extra");
    expect(text).toContain("30%");
    // the warning must SEE the model-scoped window — it is the most-utilized one here
    expect(usageWarning(u)).toBe("⚠ Fable 91%");
  });

  it("skips extra_usage when it is not enabled", () => {
    const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 5 }, extra_usage: { is_enabled: false, utilization: 80 } } };
    expect(formatUsage(u).map((l) => l.text).join("\n")).not.toContain("extra");
    expect(usageWarning(u)).toBeUndefined();
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
