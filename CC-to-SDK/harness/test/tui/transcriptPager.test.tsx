// tui/test/transcriptPager.test.tsx — the Ctrl-O transcript pager (Task 5): opens at the bottom,
// j/k/Ctrl-U/Ctrl-D/space/b/g/G navigate via the pure pager.ts reducer, q/Esc/Ctrl-C all close.
// Task 5 migrated the prop a second time (Task 4: `lines` → `items`; here: `items` → `makeItems`), because
// the pager now asks the retained source for a projection instead of being handed one frozen list.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TranscriptPager } from "../../src/tui/TranscriptPager.js";
import { pageItemSlices } from "../../src/tui/pager.js";
import { TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";

const tick = () => new Promise((r) => setTimeout(r, 20));
const mkLines = (n: number): RenderItem[] => Array.from({ length: n }, (_, i) => ({ kind: "line", id: `i${i}`, line: { text: `line ${i + 1}` } }));
const always = (items: RenderItem[]) => () => items;

describe("TranscriptPager", () => {
  it("paginates a long gutter result as physical slices with exactly one gutter", () => {
    // The gutter's fifth column is U+00A0 — import the constant, never retype it.
    const item: RenderItem = { kind: "gutter-block", id: "r", gutter: TOOL_RESULT_GUTTER, body: Array.from({ length: 40 }, (_, i) => ({ text: `line ${i + 1}` })) };
    const first = pageItemSlices([item], 0, 3), second = pageItemSlices([item], 3, 3);
    expect(first.slices[0]).toMatchObject({ start: 0, end: 3, showGutter: true }); expect(second.slices[0]).toMatchObject({ start: 3, end: 6, showGutter: false });
  });
  it("opens at the BOTTOM (most recent) and shows the window position", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    expect(r.lastFrame()).toContain("line 50");
    expect(r.lastFrame()).not.toContain("line 40 ");     // 41–50 visible
    expect(r.lastFrame()).toContain("41–50 of 50");
  });
  it("k scrolls up a line, g jumps to top, G back to bottom", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("k"); await tick();
    expect(r.lastFrame()).toContain("40–49 of 50");
    r.stdin.write("g"); await tick();
    expect(r.lastFrame()).toContain("1–10 of 50");
    r.stdin.write("G"); await tick();
    expect(r.lastFrame()).toContain("41–50 of 50");
  });
  it("Ctrl-U scrolls half a page up; space a full page down", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("\x15"); await tick();                  // Ctrl-U
    expect(r.lastFrame()).toContain("36–45 of 50");
    r.stdin.write(" "); await tick();
    expect(r.lastFrame()).toContain("41–50 of 50");       // clamped at bottom
  });
  it("q, Esc and Ctrl-C all close", async () => {
    for (const keyByte of ["q", "\x1b", "\x03"]) {
      let closed = 0;
      const r = render(<TranscriptPager makeItems={always(mkLines(5))} onClose={() => { closed++; }} height={10} />);
      await tick();
      r.stdin.write(keyByte); await tick();
      expect(closed).toBe(1);
    }
  });
  it("short transcript renders whole and never scrolls negative", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(3))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("k"); await tick();
    expect(r.lastFrame()).toContain("1–3 of 3");
  });
});
