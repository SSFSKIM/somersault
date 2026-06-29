import { describe, it, expect } from "vitest";
import { SPINNER_VERBS, SPINNER_FRAMES, glyphFrame, pickVerb, formatElapsed, spinnerStatus } from "../src/spinner.js";

describe("spinner verbs", () => {
  it("carries the full 187-verb CC vocabulary including signature verbs", () => {
    expect(SPINNER_VERBS.length).toBe(187);
    for (const v of ["Cogitating", "Noodling", "Clauding", "Schlepping", "Herding"]) expect(SPINNER_VERBS).toContain(v);
  });
  it("pickVerb maps [0,1) deterministically and never goes out of bounds", () => {
    expect(pickVerb(0)).toBe(SPINNER_VERBS[0]);
    expect(pickVerb(0.999999)).toBe(SPINNER_VERBS[SPINNER_VERBS.length - 1]);
    expect(SPINNER_VERBS).toContain(pickVerb(1));   // clamped, not undefined
  });
});

describe("spinner glyph", () => {
  it("pulses out then back through the asterisk frames", () => {
    expect(SPINNER_FRAMES).toEqual(["·", "✢", "✳", "✶", "✻", "✽", "✽", "✻", "✶", "✳", "✢", "·"]);
    expect(glyphFrame(0)).toBe("·");
    expect(glyphFrame(4)).toBe("✻");
    expect(glyphFrame(SPINNER_FRAMES.length)).toBe("·");  // wraps
    expect(glyphFrame(-1)).toBe("·");                     // negative-safe (last frame)
  });
});

describe("elapsed + status", () => {
  it("formats seconds under a minute, m+ss above", () => {
    expect(formatElapsed(3000)).toBe("3s");
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(65000)).toBe("1m 05s");
    expect(formatElapsed(-100)).toBe("0s");
  });
  it("status tail carries the esc-to-interrupt affordance", () => {
    expect(spinnerStatus(3000)).toBe("(3s · esc to interrupt)");
  });
});
