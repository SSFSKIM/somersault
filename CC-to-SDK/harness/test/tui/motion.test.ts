// test/tui/motion.test.ts — F8 Task 6: one resolver for "should anything be animating right now".
// `screenReaderEnabled` is the extracted rung `selectRenderer` already used inline (canon `envBool(env.
// CLAUDE_AX_SCREEN_READER) === true`); `reducedMotion` ORs the persisted setting against it — canon's own
// `hx(S.prefersReducedMotion) || hl()` at bundle L507998.
import { describe, expect, it } from "vitest";
import { reducedMotion } from "../../src/tui/motion.js";
import { screenReaderEnabled } from "../../src/tui/renderer.js";

describe("screenReaderEnabled", () => {
  it("reads CLAUDE_AX_SCREEN_READER and nothing else", () => {
    expect(screenReaderEnabled({ CLAUDE_AX_SCREEN_READER: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(screenReaderEnabled({ CLAUDE_AX_SCREEN_READER: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(screenReaderEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("reducedMotion", () => {
  it("is the setting OR the screen-reader signal — canon's hx(...) || hl()", () => {
    expect(reducedMotion({ prefersReducedMotion: true }, {} as NodeJS.ProcessEnv)).toBe(true);
    expect(reducedMotion({}, { CLAUDE_AX_SCREEN_READER: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(reducedMotion({}, {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("defaults env to process.env when omitted, and an explicit false setting does not short-circuit the OR", () => {
    // Not `prefers: true` here — a resolver that only ever checked the setting would still pass the test
    // above (both rungs true). This pins that a FALSE setting still lets the screen-reader rung win.
    expect(reducedMotion({ prefersReducedMotion: false }, { CLAUDE_AX_SCREEN_READER: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
