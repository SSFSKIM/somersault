// tui/test/transcriptPager.test.tsx — the Ctrl-O transcript pager (Task 5): opens at the bottom,
// j/k/Ctrl-U/Ctrl-D/space/b/g/G navigate via the pure pager.ts reducer, q/Esc/Ctrl-C all close.
// Task 5 migrated the prop a second time (Task 4: `lines` → `items`; here: `items` → `makeItems`), because
// the pager now asks the retained source for a projection instead of being handed one frozen list.
//
// F2 task 7: the pager stopped calling `useInput` — it pushes the `Transcript` context and registers the
// bundle's scroll/exit/toggle ACTIONS, so a key only reaches it through <KeymapProvider>. Rendered bare it
// has no input path at all, hence `renderWithKeymap`. home/end are new here (P86: Ink's `useInput` cannot
// tell them apart from insert or F1–F12, so they were unreachable before the parser).
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render } from "./keysTestUtil.js";
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
  it("home jumps to the top and end back to the bottom (NEW — the keys Ink's useInput could not name)", async () => {
    const r = render(<TranscriptPager makeItems={always(mkLines(50))} onClose={() => {}} height={10} />);
    await tick();
    r.stdin.write("\x1b[H"); await tick();                // home
    expect(r.lastFrame()).toContain("1–10 of 50");
    r.stdin.write("\x1b[F"); await tick();                // end
    expect(r.lastFrame()).toContain("41–50 of 50");
    r.stdin.write("\x1b[1~"); await tick();               // the tilde spelling of home is the same key
    expect(r.lastFrame()).toContain("1–10 of 50");
    r.stdin.write("\x1b[4~"); await tick();               // …and of end
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
  // Ctrl-O is new to the pager itself: ChatApp used to special-case it as "the pager's close arm" behind the
  // owner gate; the Transcript context binds it to transcript:exit now, so the pager owns all four.
  it("q, Esc, Ctrl-C and Ctrl-O all close", async () => {
    for (const keyByte of ["q", "\x1b", "\x03", "\x0f"]) {
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
