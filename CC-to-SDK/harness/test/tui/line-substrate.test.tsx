// F4 Task 1 — the line-model substrate every later F4 task builds on: `strikethrough`/`underline`/`bg` on
// both RenderLine and Segment, forwarded by the ONE <Line> view on BOTH paths (segment map + single-styled
// fallback). `bg` goes through the same TH2 theme grammar as `color` (Line.tsx's `ink()`).
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Line } from "../../src/tui/Line.js";

describe("F4 Task 1 — line-model substrate", () => {
  it("forwards strikethrough and underline segment flags as SGR", () => {
    const { lastFrame } = render(<Line l={{ text: "ab", segments: [
      { text: "a", strikethrough: true }, { text: "b", underline: true }] }} />);
    expect(lastFrame()).toContain("\x1b[9m");   // strikethrough on
    expect(lastFrame()).toContain("\x1b[4m");   // underline on
  });
  it("resolves bg through the theme grammar to a background color", () => {
    const { lastFrame } = render(<Line l={{ text: "x", bg: "rgb(240,240,240)" }} />);
    expect(lastFrame()).toMatch(/\x1b\[48;2;240;240;240m/);
  });
  it("bg in the ansi:<name> grammar reaches Ink RESOLVED — the one form Ink cannot parse itself", () => {
    // Ink's colorize parses rgb()/ansi256() natively, so only ansi:<name> proves the resolveThemeColor
    // route is actually wired (reviewer Minor 1); chalk maps bgRed to \x1b[41m.
    const { lastFrame } = render(<Line l={{ text: "x", bg: "ansi:red" }} />);
    expect(lastFrame()).toContain("\x1b[41m");
  });
  it("single-styled line path forwards the same three fields", () => {
    const { lastFrame } = render(<Line l={{ text: "s", strikethrough: true, underline: true }} />);
    expect(lastFrame()).toContain("\x1b[9m");
    expect(lastFrame()).toContain("\x1b[4m");
  });
  // The two remaining substrate fields the interface adds, pinned so the tasks that consume them (Task 6's
  // diff bands take the SEGMENT bg; Task 9's `∴` gutter is dim+italic) inherit a guarded Line.tsx.
  it("resolves a segment bg through the theme grammar too", () => {
    const { lastFrame } = render(<Line l={{ text: "y", segments: [{ text: "y", bg: "rgb(1,2,3)" }] }} />);
    expect(lastFrame()).toMatch(/\x1b\[48;2;1;2;3m/);
  });
  it("forwards gutter italic independently of the line", () => {
    const { lastFrame } = render(<Line l={{ text: "t", gutter: { text: "∴ ", dim: true, italic: true } }} />);
    expect(lastFrame()).toContain("\x1b[3m");
  });
});
