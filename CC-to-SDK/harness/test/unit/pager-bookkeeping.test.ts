// test/unit/pager-bookkeeping.test.ts — Wave R task 8 (EP-R4). INK'S TALL-FRAME BRANCH IS A HOLE IN EVERY
// BOOKKEEPER THIS WAVE DEPENDS ON. `ink.js:118-122`: when `outputHeight >= this.options.stdout.rows` Ink writes
// `ansiEscapes.clearTerminal + this.fullStaticOutput + output` STRAIGHT to stdout, assigns `this.lastOutput`, and
// returns — log-update is never called, so its `previousOutput`/`previousLineCount` still describe the frame
// before the tall one, and the proxy's `frame`/`widthAtPaint` still describe a frame that is no longer painted
// anywhere. The ctrl+o pager takes that branch every time it is taller than the pane.
//
// WHY THIS IS A UNIT TEST AND NOT AN INK ONE (the brief's test-design warning, and v1 of this task fell in it).
// `ink-testing-library` renders with `debug: true`, and the debug arm (`ink.js:100-107`) returns BEFORE the tall
// branch is ever reached; its stdout stub exposes no `rows` either, so `outputHeight >= undefined` is false in
// any case. A test written against that renderer is green on the broken build. So the three mechanisms are
// modelled here line-for-line against the installed `node_modules/ink@6.4.0` (`InkModel`, the shape
// `test/tui/clear-repaint.test.tsx` set for task 7), and everything under test — the proxy, `clearViewport`,
// `frameWriteCorrection` — is the real production code.
//
// MEASURED LIVE FIRST (tmux 3.7b, 60x15, session `wr-t8-probe2`), because the model has to reproduce something
// real: `/status` for content, ctrl+o to open the pager, Escape to close it.
//   · open  → one chunk, `1b5b324a 1b5b334a 1b5b48` + the whole session's static output + the pager frame.
//   · close → **ZERO bytes**, and the pager still fully painted. The post-close frame is byte-identical to the
//     pre-pager one, so log-update's `output === previousOutput` early return (`log-update.js:13`) swallows it
//     — the same dedupe task 7 removed from `/clear`, reached by a different door.
//   · resize 60→50 after that → pager border fragments above the composer; the screen never recovers.
import { describe, expect, it, vi } from "vitest";
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";
import { clearViewport, eraseViewport } from "../../src/tui/clearViewport.js";
import { eraseRows, parkColumn, parkSequence, type FrameWriteInfo } from "../../src/tui/resizeRepaint.js";

/** `ansiEscapes.clearTerminal` on every platform but pre-1607 Windows: erase screen, erase SCROLLBACK, home. */
const CLEAR_TERMINAL = "\x1b[2J\x1b[3J\x1b[H";
/** `ansiEscapes.eraseLines(n)` — identical bytes to `eraseRows`, spelled out once so the two cannot drift. */
const eraseLines = (n: number): string => eraseRows(n);

class Screen {
  isTTY = true;
  readonly chunks: string[] = [];
  constructor(public columns: number, public rows: number) {}
  write(chunk: string): boolean { this.chunks.push(chunk); return true; }
  /** Everything written since mark `n`, park padding included — the terminal's point of view. */
  since(n: number): string { return this.chunks.slice(n).join(""); }
}

const proxyOn = (columns: number, rows: number) => { const screen = new Screen(columns, rows); return { screen, out: createResumeSafeStdout(screen as any) }; };

/** The four `Instance` mechanisms a pager open/close runs through, modelled from the installed ink@6.4.0.
 *  `outputHeight` is Yoga's, so it is passed in rather than guessed — that number is the branch selector. */
class InkModel {
  lastOutput = "";                       // ink.js:23, assigned at :120 and :132
  fullStaticOutput = "";                 // ink.js:24 — appended to at :117 and NEVER reset by clear()
  previousOutput = "";                   // log-update.js:5
  previousLineCount = 0;                 // log-update.js:4
  constructor(readonly term: { rows?: number; isTTY?: boolean; write(s: string): boolean }) {}
  private log(str: string): void {
    const output = str + "\n";
    if (output === this.previousOutput) return;                       // log-update.js:13 — the dedupe
    this.previousOutput = output;
    this.term.write(eraseLines(this.previousLineCount) + output);
    this.previousLineCount = output.split("\n").length;
  }
  private logClear(): void {
    this.term.write(eraseLines(this.previousLineCount));
    this.previousOutput = ""; this.previousLineCount = 0;
  }
  /** ink.js:97-133, the non-debug non-CI path. */
  onRender(output: string, outputHeight: number, staticOutput = ""): void {
    const hasStatic = staticOutput !== "" && staticOutput !== "\n";   // ink.js:103
    if (hasStatic) this.fullStaticOutput += staticOutput;             // ink.js:117
    if (outputHeight >= (this.term.rows as number)) {                 // ink.js:118 — THE TALL BRANCH
      this.term.write(CLEAR_TERMINAL + this.fullStaticOutput + output);
      this.lastOutput = output;
      return;
    }
    if (hasStatic) { this.logClear(); this.term.write(staticOutput); this.log(output); }
    if (!hasStatic && output !== this.lastOutput) this.log(output);   // (the throttle is not modelled: it defers, it never drops)
    this.lastOutput = output;
  }
  /** ink.js:137-152 — `useStdout().write`, the forced repaint `clearViewport` rides on. */
  write = (data: string): void => { this.logClear(); this.term.write(data); this.log(this.lastOutput); };
  get stdout() { return this.term; }
}

const COMPOSER = "─".repeat(20) + "\n❯ \n" + "─".repeat(20) + "\nmodel claude-opus-5";
const HISTORY = Array.from({ length: 18 }, (_, i) => `committed transcript row ${i}`).join("\n") + "\n";
const PAGER = Array.from({ length: 14 }, (_, i) => `│ pager row ${i}`).join("\n");

describe("the tall-frame chunk resynchronizes the proxy's geometry", () => {
  // The recorded frame is not on screen any more — `clearTerminal` wiped it and the chunk repainted from home.
  // Retaining it (which is what this branch did before task 8) hands task 4b's corrector a frame that describes
  // nothing, and the injected erase walks upward into the replayed scrollback the correction never repaints.
  it("drops the recorded frame rather than retaining the pre-tall one", () => {
    const { out } = proxyOn(120, 40);
    out.stdout.write("live frame\n");
    expect(out.lastFrame()).toBe("live frame\n");
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    expect(out.lastFrame()).toBeUndefined();
    expect(out.parkedColumn()).toBe(0);
  });

  // …and `widthAtPaint` with it (carried from task 4b's review). Not directly readable, so it is pinned through
  // the only thing that consumes it: the write-time corrector, which must not be consulted at all once the
  // geometry is gone. The control case immediately below is what gives this assertion teeth.
  it("never consults the write-time corrector for the first frame after a tall chunk, even on a shrink", () => {
    const { screen, out } = proxyOn(120, 40);
    const corrector = vi.fn((_: FrameWriteInfo) => eraseRows(9));       // would inject 9 rows of erase if asked
    out.setFrameCorrector(corrector);
    out.stdout.write("live frame painted at 120\n");
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    screen.columns = 60;                                                // the terminal narrowed under us
    const mark = screen.chunks.length;
    out.stdout.write(eraseLines(2) + "post-pager frame\n");
    expect(corrector).not.toHaveBeenCalled();
    expect(screen.chunks[mark]).toBe(eraseLines(2) + "post-pager frame\n");   // Ink's own bytes, unaltered
  });

  it("still consults it on the same shrink when no tall chunk intervened", () => {
    const { screen, out } = proxyOn(120, 40);
    const corrector = vi.fn((_: FrameWriteInfo) => eraseRows(9));
    out.setFrameCorrector(corrector);
    out.stdout.write("live frame painted at 120\n");
    screen.columns = 60;
    const mark = screen.chunks.length;
    out.stdout.write(eraseLines(2) + "post-shrink frame\n");
    expect(corrector).toHaveBeenCalledTimes(1);
    expect(corrector.mock.calls[0]![0].prevFrame).toBe("live frame painted at 120\n");
    expect(corrector.mock.calls[0]![0].widthAtPaint).toBe(120);
    expect(screen.chunks[mark]).toBe(eraseLines(2) + eraseRows(9) + "post-shrink frame\n");
  });

  // The counter ChatApp reads. It is a COUNT and not a flag on purpose: the recovery must not fire on the commit
  // whose own frame took the branch (that would wipe the pager the user just opened), and "did this commit bump
  // it" is the only question that separates the two — every tall render writes, because ink.js:118 has no dedupe.
  it("counts tall writes and forgets them the moment a recorded frame write re-establishes the screen", () => {
    const { out } = proxyOn(120, 40);
    expect(out.tallWrites()).toBe(0);
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    expect(out.tallWrites()).toBe(1);
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    expect(out.tallWrites()).toBe(2);
    out.stdout.write(eraseLines(2) + "an ordinary frame\n");
    expect(out.tallWrites()).toBe(0);                                   // …and it went through log-update, so the count stands down
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    out.screenResynced();
    expect(out.tallWrites()).toBe(0);                                   // the caller's own acknowledgement still clears it
  });

  // …and ONLY a recorded frame write does. The three writes that reach the proxy without going through log-update
  // leave the dedupe hazard exactly where it was, so none of them may stand the count down: the erase-only write
  // (`log.clear()` / `Instance.clear()`), the <Static> scrollback chunk that follows it, and a foreign
  // escapes-only write (the keymap's DECSET pair, suspend's cursor show/hide) that is nobody's frame.
  it("is not cleared by an erase-only write, a <Static> chunk, or a foreign escape sequence", () => {
    const { out } = proxyOn(120, 40);
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    expect(out.tallWrites()).toBe(1);
    out.stdout.write(eraseLines(3));                                    // erase-only — log.clear()
    expect(out.tallWrites()).toBe(1);
    out.stdout.write(HISTORY);                                          // the <Static> chunk right behind it
    expect(out.tallWrites()).toBe(1);
    out.stdout.write("\x1b[?2004h");                                    // the keymap's bracketed-paste enable
    expect(out.tallWrites()).toBe(1);
    out.stdout.write("the frame that closes the triple\n");             // …and the frame does clear it
    expect(out.tallWrites()).toBe(0);
  });

  // W2 t7 FIX ROUND 1 (finding 1) — THE SAME FACT, LATCHED AHEAD OF THE WRITE THAT ERASES IT. On a grow that
  // lets a clipped frame fit again, Ink's synchronous SIGWINCH handler writes that frame through log-update
  // BEFORE React flushes passive effects: the count is 0 by the time the recovery looks, and that same write is
  // what stranded the tall surface's header. ccx's own resize listener runs ahead of Ink's, so it records the
  // fact there. The count itself is untouched — this only moves the READ earlier.
  it("latches the tall state at the signal and survives the frame write that stands the count down", () => {
    const { out } = proxyOn(120, 40);
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    out.noteResizeSignal();                                             // ccx's listener, ahead of Ink's
    out.stdout.write(eraseLines(2) + "the frame Ink writes for the resize\n");
    expect(out.tallWrites()).toBe(0);                                   // …the live count is already gone
    expect(out.takeTallAtSignal()).toBe(true);                          // …and the latch is not
    expect(out.takeTallAtSignal()).toBe(false);                         // ONE-SHOT: a fact about one signal
  });

  it("latches nothing for a signal that arrives on an ordinary screen", () => {
    const { out } = proxyOn(120, 40);
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    out.stdout.write(eraseLines(2) + "an ordinary frame\n");
    out.noteResizeSignal();                                             // the tall episode is already over
    expect(out.takeTallAtSignal()).toBe(false);
    // …and a stale latch cannot be inherited by a later signal: every signal re-states the fact.
    out.stdout.write(CLEAR_TERMINAL + HISTORY + PAGER);
    out.noteResizeSignal();
    expect(out.takeTallAtSignal()).toBe(true);
    out.stdout.write(eraseLines(2) + "an ordinary frame\n");
    out.noteResizeSignal();
    expect(out.takeTallAtSignal()).toBe(false);
  });
});

describe("the tall-frame chunk keeps the terminal's scrollback", () => {
  // Task 7's review, measured in session `wr-t7-rev-tall2`: scrollback marker rows went 60 → 0 the first time a
  // frame was tall enough. `ESC[3J` is what did it, and it is the ONE byte of `clearTerminal` that Ink does not
  // need — `ESC[2J` already blanks the screen it is about to paint on, and `ESC[3J` reaches only into history
  // that is not Ink's to erase. Same principle task 7 settled for `/clear` (clearViewport.ts, note 1): this
  // app's committed transcript lives in exactly that scrollback.
  it("strips ESC[3J and passes every other byte through untouched", () => {
    const { screen, out } = proxyOn(120, 40);
    const chunk = CLEAR_TERMINAL + HISTORY + PAGER;
    out.stdout.write(chunk);
    const written = screen.since(0);
    expect(written).not.toContain("\x1b[3J");
    expect(written).toBe("\x1b[2J\x1b[H" + HISTORY + PAGER);
  });

  // The old-Windows arm of `ansiEscapes.clearTerminal` is `ESC[2J ESC[0f` — no scrollback erase to strip, and
  // nothing may be invented for it.
  it("leaves a clearTerminal that carries no ESC[3J exactly as Ink wrote it", () => {
    const { screen, out } = proxyOn(120, 40);
    out.stdout.write("\x1b[2J\x1b[0f" + PAGER);
    expect(screen.since(0)).toBe("\x1b[2J\x1b[0f" + PAGER);
    expect(out.tallWrites()).toBe(1);
  });
});

describe("closing the pager, end to end through the real proxy", () => {
  const open = () => {
    const { screen, out } = proxyOn(60, 15);
    const ink = new InkModel(out.stdout as unknown as { rows: number; write(s: string): boolean });
    ink.onRender(COMPOSER, 5, HISTORY);              // the session so far: static transcript + the live composer
    ink.onRender(PAGER, 15);                         // ctrl+o — outputHeight 15 >= rows 15, the tall branch
    return { screen, out, ink };
  };

  // The defect exactly as the pty recorded it. This assertion is the whole reason the recovery cannot live in
  // the proxy: there is no write to correct, because Ink makes none.
  it("writes NOTHING on close — log-update dedupes the frame away", () => {
    const { screen, ink } = open();
    const mark = screen.chunks.length;
    ink.onRender(COMPOSER, 5);
    expect(screen.since(mark)).toBe("");
  });

  it("wipes the viewport and forces the frame back once the recovery runs", () => {
    const { screen, out, ink } = open();
    ink.onRender(COMPOSER, 5);
    expect(out.tallWrites()).toBe(1);
    const mark = screen.chunks.length;
    expect(clearViewport(ink)).toBe(true);
    out.screenResynced();
    const payload = screen.since(mark);
    expect(payload).toContain(eraseViewport(15));                // the viewport, and only the viewport
    expect(payload).not.toContain("\x1b[3J");
    expect(payload.endsWith(COMPOSER + "\n" + parkSequence(parkColumn(60)))).toBe(true);
    expect(out.lastFrame()).toBe(COMPOSER + "\n");               // the proxy knows what is painted again…
    expect(out.parkedColumn()).toBe(parkColumn(60));             // …and the cursor is parked on it for the oracle
    expect(out.tallWrites()).toBe(0);
  });

  // THE OTHER SIDE OF THE GATE (t8 review). The zero-byte close above is only possible while log-update's
  // `previousOutput` still holds the pre-pager frame. Let ONE ordinary frame through in between — anything that
  // repaints while the tall surface is up or after it comes down — and log-update has re-established itself, the
  // close cannot dedupe to nothing, and the count is already 0 when ChatApp looks. Under the first version of
  // this counter it would still have read 1 and fired a viewport wipe over live rows.
  it("stands the count down when an ordinary frame lands between the tall write and the close", () => {
    const { out, ink } = open();
    expect(out.tallWrites()).toBe(1);
    ink.onRender(COMPOSER + " ⟳", 5);                            // an ordinary render — log-update writes it
    expect(out.tallWrites()).toBe(0);
    ink.onRender(COMPOSER, 5);                                   // the close
    expect(out.tallWrites()).toBe(0);
  });

  // The invariant clearViewport exists to preserve (task 7): after the reset, log-update's counters describe the
  // screen, so the NEXT frame erases what is actually painted. Pinned byte for byte on the frame chunk itself —
  // a recovery that left `previousLineCount` wrong would paint the following frame below this one, which is the
  // duplicate-composer residue this whole wave is deleting.
  it("leaves log-update's counters describing the screen", () => {
    const { screen, ink } = open();
    ink.onRender(COMPOSER, 5);
    clearViewport(ink);
    const mark = screen.chunks.length;
    ink.onRender(COMPOSER + " ⟳", 5);
    expect(screen.chunks[mark]).toBe(eraseLines((COMPOSER + "\n").split("\n").length) + COMPOSER + " ⟳\n");
  });

  // A8's real content: the SECOND-order check. A resize immediately after the close must be corrected off the
  // frame that is on screen, at the width it was painted at — the stale pair would have measured a 120-column
  // pre-pager frame into a 40-column terminal.
  it("hands the corrector the post-recovery frame on a resize right after the close", () => {
    const { screen, out, ink } = open();
    ink.onRender(COMPOSER, 5);
    clearViewport(ink); out.screenResynced();
    const corrector = vi.fn((_: FrameWriteInfo) => "");
    out.setFrameCorrector(corrector);
    screen.columns = 40;
    ink.onRender(COMPOSER + " ⟳", 5);
    expect(corrector).toHaveBeenCalledTimes(1);
    const info = corrector.mock.calls[0]![0];
    expect(info.prevFrame).toBe(COMPOSER + "\n");
    expect(info.widthAtPaint).toBe(60);
    expect(info.width).toBe(40);
    expect(info.inkErases).toBe((COMPOSER + "\n").split("\n").length);
  });
});
