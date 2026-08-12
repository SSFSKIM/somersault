// tui/test/clear-repaint.test.tsx — Wave R task 7 (EP-R2). `/clear` used to leave a blank pane until the next
// keystroke and to wipe the terminal scrollback the committed transcript lives in. Both halves are pinned here.
//
// WHY THE INK IS A MODEL AND NOT `ink-testing-library`. The defect IS Ink's dedupe, and `ink-testing-library`
// renders with `debug: true` (its build/index.js), which takes every dedupe out of the path: `onRender` writes
// `fullStaticOutput + output` unconditionally (ink.js:104-109), `Instance.clear()` is a no-op (`if (!isInCi &&
// !this.options.debug)`, ink.js:213-217) and `this.lastOutput` is never even assigned. A frame-count assertion
// under that renderer is green on the broken build — the trap this task's brief warns about, wearing a second
// face. Driving the REAL renderer instead is not available either: ink reads `is-in-ci` at import time and CI
// sets `CI=true`, which routes `onRender` down the static-only branch (ink.js:110-116).
// So `InkModel` below reimplements the three mechanisms that matter, line-for-line against the installed
// `node_modules/ink@5.2.1`, and `test/tui/resumeOutput.test.ts` sets the precedent for that shape. Everything
// it models is quoted in its comments; the production code under test (`clearViewport`, `useChat.clear`) is
// the real thing.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { useChat } from "../../src/tui/useChat.js";
import { clearAltScreen, clearViewport, eraseViewport, screenClear } from "../../src/tui/clearViewport.js";
import { eraseRows } from "../../src/tui/resizeRepaint.js";

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const ROWS = 24;
// The live frame: everything `/clear` does NOT change. That is the premise of the whole defect — the transcript
// is <Static>, so the frame either side of a clear is the same bytes.
const FRAME = "❯ \n  model claude-opus-5 · mode default";

class RecordingTerminal {
  isTTY = true;
  rows = ROWS;
  readonly chunks: string[] = [];
  write(chunk: string): boolean { this.chunks.push(chunk); return true; }
  get output(): string { return this.chunks.join(""); }
}

/** The three Ink mechanisms `/clear` runs through, modelled from the installed source. */
class InkModel {
  lastOutput = "";                  // ink.js:23, assigned at :135
  previousOutput = "";              // log-update.js:5
  previousLineCount = 0;            // log-update.js:4
  constructor(readonly term: RecordingTerminal) {}
  /** log-update.js:7-19. The early return at :13 is the dedupe `writeToStdout` defeats. */
  private log(str: string): void {
    const output = str + "\n";
    if (output === this.previousOutput) return;
    this.previousOutput = output;
    this.term.write(eraseRows(this.previousLineCount) + output);
    this.previousLineCount = output.split("\n").length;
  }
  /** log-update.js:20-24 — resets the COUNTERS. */
  private logClear(): void {
    this.term.write(eraseRows(this.previousLineCount));
    this.previousOutput = ""; this.previousLineCount = 0;
  }
  /** ink.js:127-135 with an empty <Static> (`staticOutput === '\n'` → `hasStaticOutput` false at :103). */
  onRender(output: string): void {
    if (output !== this.lastOutput) this.log(output);
    this.lastOutput = output;
  }
  /** ink.js:213-217 — `this.log.clear()` and nothing else. `lastOutput` deliberately survives. */
  clear(): void { this.logClear(); }
  /** ink.js:140-155 — the useStdout() write. Bound, because that is how `autoBind(this)` (ink.js:33) hands
   *  it to the StdoutContext provider (components/App.js:58-64). */
  write = (data: string): void => { this.logClear(); this.term.write(data); this.log(this.lastOutput); };
  get stdout() { return this.term; }
}

describe("eraseViewport — upstream's INLINE clear arm (bundle L176988 `yJr`)", () => {
  it("is `ESC[H` + (`ESC[2K` `ESC[1B`) × rows + `ESC[H`, byte for byte", () => {
    expect(eraseViewport(3)).toBe("\x1b[H" + "\x1b[2K\x1b[1B\x1b[2K\x1b[1B\x1b[2K\x1b[1B" + "\x1b[H");
    expect(eraseViewport(0)).toBe("\x1b[H\x1b[H");
    expect(eraseViewport(-5)).toBe("\x1b[H\x1b[H");
  });
  // The retraction this task exists for: the old payload was `Rms()` (L176982, `ESC[2J ESC[3J ESC[H`), which
  // is upstream's ALT-SCREEN arm (L177121 picks between them on `a.altScreen`). `ESC[3J` erases scrollback.
  it("carries no ESC[3J and no ESC[2J — the scrollback the transcript lives in is not ours to erase", () => {
    const seq = eraseViewport(ROWS);
    expect(seq).not.toContain("\x1b[3J");
    expect(seq).not.toContain("\x1b[2J");
  });
  it("writes nothing off a tty, and the viewport wipe plus a forced frame on one", () => {
    const term = new RecordingTerminal(); const ink = new InkModel(term);
    ink.onRender(FRAME);
    const noTty = { stdout: { isTTY: false, rows: ROWS }, write: () => { throw new Error("wrote off a tty"); } };
    expect(clearViewport(noTty)).toBe(false);
    const start = term.chunks.length;
    expect(clearViewport(ink)).toBe(true);
    expect(term.chunks.slice(start).join("")).toContain(eraseViewport(ROWS));
  });
});

// ── FSW TASK 8 (D6) — THE OTHER ARM, restored on upstream's own axis ─────────────────────────────────────
// Task 7 retracted `Rms()` because it was being written INLINE, where `ESC[3J` destroys the scrollback the
// committed transcript lives in. It was never wrong in itself: L177121 is `s += a.altScreen ? Rms() :
// yJr(a.viewportRows)`, and on the alternate screen there is no scrollback to protect — the sequence is the
// correct one there and the viewport-erase is the wrong one (it would leave the frame's rows blanked one at a
// time rather than the screen reset). So the split is by SCREEN MODE, exactly as upstream splits it, and
// `eraseViewport` keeps meaning what it has always meant to its existing callers.
describe("screenClear — the D6 mode split (bundle L177121)", () => {
  it("is upstream `Rms()` byte for byte on the alt arm: ESC[2J ESC[3J ESC[H", () => {
    expect(clearAltScreen()).toBe("\x1b[2J\x1b[3J\x1b[H");
  });
  it("dispatches on screen mode and on nothing else", () => {
    expect(screenClear({ altScreen: true, rows: ROWS })).toBe(clearAltScreen());
    expect(screenClear({ altScreen: true, rows: 0 })).toBe(clearAltScreen());     // the alt arm ignores rows, as Rms() does
    expect(screenClear({ altScreen: false, rows: ROWS })).toBe(eraseViewport(ROWS));
  });
  it("leaves clearViewport's existing callers on the inline arm", () => {
    const term = new RecordingTerminal(); const ink = new InkModel(term);
    ink.onRender(FRAME);
    const start = term.chunks.length;
    expect(clearViewport(ink)).toBe(true);
    const payload = term.chunks.slice(start).join("");
    expect(payload).toContain(eraseViewport(ROWS));
    expect(payload).not.toContain("\x1b[3J");
  });
  it("…and takes the alt arm when the caller says the screen is the alternate one", () => {
    const term = new RecordingTerminal(); const ink = new InkModel(term);
    ink.onRender(FRAME);
    const start = term.chunks.length;
    expect(clearViewport(ink, { altScreen: true })).toBe(true);
    expect(term.chunks.slice(start).join("")).toContain(clearAltScreen());
  });
  it("still writes nothing off a tty on either arm", () => {
    const noTty = { stdout: { isTTY: false, rows: ROWS }, write: () => { throw new Error("wrote off a tty"); } };
    expect(clearViewport(noTty, { altScreen: true })).toBe(false);
  });
});

describe("/clear repaints", () => {
  // The defect, stated as the test that would have caught it: after the reset a frame must LAND. Asserting
  // that the screen "contains the composer" proves nothing — the stale frame contains it too, and leaving it
  // on screen under a blank pane is exactly what the bug did.
  it("puts a new frame on the terminal even though the frame is byte-identical to the pre-clear one", async () => {
    const term = new RecordingTerminal(); const ink = new InkModel(term);
    ink.onRender(FRAME);                                  // the pre-clear paint; ink.lastOutput === FRAME now
    const api: { clear?: () => void } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { clearStaticTranscript: () => ink.clear() },
        { clearViewport: () => { clearViewport(ink); } });
      api.clear = c.clear; return <Text>L:{c.state.staticItems.length}</Text>;
    }
    render(<H />);
    await waitFor(() => api.clear !== undefined);
    const start = term.chunks.length;
    api.clear!();
    ink.onRender(FRAME);                                  // React's post-clear render — the SAME bytes (the premise)
    const after = term.chunks.slice(start);
    expect(after.some((c) => c.includes(FRAME))).toBe(true);
  });

  it("emits the viewport wipe and no scrollback erase", async () => {
    const term = new RecordingTerminal(); const ink = new InkModel(term);
    ink.onRender(FRAME);
    const api: { clear?: () => void } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { clearStaticTranscript: () => ink.clear() },
        { clearViewport: () => { clearViewport(ink); } });
      api.clear = c.clear; return <Text>L:{c.state.staticItems.length}</Text>;
    }
    render(<H />);
    await waitFor(() => api.clear !== undefined);
    const start = term.chunks.length;
    api.clear!();
    const payload = term.chunks.slice(start).join("");
    expect(payload).toContain(eraseViewport(ROWS));
    expect(payload).not.toContain("\x1b[3J");
  });

  // The reason the repaint goes through Ink's writeToStdout rather than re-writing the recorded bytes
  // ourselves (`createForceRepaint`): `app.clear()` zeroed log-update's `previousLineCount`, so a hand-written
  // frame would leave N rows painted against a count of 0 and the NEXT frame would land below ours. Pinning
  // the erase depth of the next write is how that duplicate-composer regression stays caught.
  it("leaves log-update's counters describing the screen, so the next frame erases what is painted", async () => {
    const term = new RecordingTerminal(); const ink = new InkModel(term);
    ink.onRender(FRAME);
    const api: { clear?: () => void } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { clearStaticTranscript: () => ink.clear() },
        { clearViewport: () => { clearViewport(ink); } });
      api.clear = c.clear; return <Text>L:{c.state.staticItems.length}</Text>;
    }
    render(<H />);
    await waitFor(() => api.clear !== undefined);
    api.clear!();
    ink.onRender(FRAME);
    const start = term.chunks.length;
    ink.onRender(FRAME + " ⟳");                            // the next keystroke's frame
    expect(term.chunks.slice(start).join("")).toBe(eraseRows((FRAME + "\n").split("\n").length) + FRAME + " ⟳\n");
  });

  it("empties the transcript model as well as the screen", async () => {
    const term = new RecordingTerminal(); const ink = new InkModel(term);
    const api: { run?: (s: string) => void; clear?: () => void } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { clearStaticTranscript: () => ink.clear() },
        { clearViewport: () => { clearViewport(ink); } });
      // FSW T3: `finalizedItems`, not `staticItems` — the finalized projection is what this claim is about;
      // `staticItems` is now only the part of it already committed to <Static>.
      api.run = c.submit; api.clear = c.clear; return <Text>L:{c.state.finalizedItems.length}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("hi");  await waitFor(() => !(lastFrame() ?? "").includes("L:0"));
    api.clear!();    await waitFor(() => (lastFrame() ?? "").includes("L:0"));
  });
});
