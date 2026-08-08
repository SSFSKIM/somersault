// The shared upstream formatter ports (`src/tui/format.ts`). These are verbatim ports of NAMED 2.1.220
// functions, so every case here is a byte pinned against the bundle rather than a taste call.
import { describe, expect, it } from "vitest";
import { formatCompactNumber, formatUsd } from "../../src/tui/format.js";

describe("formatCompactNumber (upstream `yd`, bundle 229070611)", () => {
  // `yd(e){let t=e>=1000;return fOg(t).format(e).toLowerCase()}` with
  // `fOg=(e)=>e ? Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1,minimumFractionDigits:1})
  //             : Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1,minimumFractionDigits:0})`
  // — so the fraction digit is MANDATORY at or above 1000 (`12000` reads `12.0k`, never `12k`) and absent below it.
  it("forces one fraction digit at or above 1000", () => {
    expect(formatCompactNumber(1000)).toBe("1.0k");
    expect(formatCompactNumber(12000)).toBe("12.0k");
    expect(formatCompactNumber(24100)).toBe("24.1k");
    expect(formatCompactNumber(1200000)).toBe("1.2m");
  });

  it("keeps a sub-1000 value whole, with no fabricated `.0`", () => {
    expect(formatCompactNumber(907)).toBe("907");
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(999)).toBe("999");
  });
});

describe("formatUsd (upstream `pZu`, L217680)", () => {
  // `pZu(e,t=4){return `$${e>0.5 ? A0y(e,100).toFixed(2) : e.toFixed(t)}`}` with `A0y(e,t)=Math.round(e*t)/t`
  // — the threshold is FIFTY CENTS, not a dollar, and it is strict (`>`), so `$0.50` itself takes four places.
  it("rounds to two places above fifty cents", () => {
    expect(formatUsd(1.2345)).toBe("$1.23");
    expect(formatUsd(0.505)).toBe("$0.51");
    expect(formatUsd(12.3456)).toBe("$12.35");
  });
  it("keeps four places at or below fifty cents, so a sub-cent session is not rounded to nothing", () => {
    expect(formatUsd(0.5)).toBe("$0.5000");
    expect(formatUsd(0.0123)).toBe("$0.0123");
    expect(formatUsd(0)).toBe("$0.0000");
  });
});
