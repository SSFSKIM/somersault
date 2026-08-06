// test/unit/resize-repaint.test.ts — Wave R task 4: the correction itself. Every case here is about ONE
// asymmetry: an under-erase leaves today's cosmetic residue, an over-erase eats live transcript rows. So the
// emitting cases pin exact byte counts and the refusing cases (grow, "truncate", "unknown", no recorded frame)
// pin the empty string.
import { describe, expect, it, vi } from "vitest";
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";
import { correctionAfterRepaint, createResizeRepaint, eraseRows, frameWriteCorrection,
  inkErases, occupiedRows, parkColumn, parkSequence, physicalRows, type FrameWriteInfo,
  type ResizeSample } from "../../src/tui/resizeRepaint.js";
import type { ReflowVerdict } from "../../src/tui/reflowOracle.js";

// ansi-escapes' eraseLines(n), byte-for-byte — the same shape test/unit/resume-safe-stdout.test.ts pins, because
// the correction has to be indistinguishable from Ink's own erase to the terminal.
const inkEraseLines = (n: number): string => (n === 0 ? "" : "\x1b[2K" + "\x1b[1A\x1b[2K".repeat(n - 1) + "\x1b[G");
/** How many DISTINCT rows a run of eraseLines(n) clears, counting from the cursor's row upward. */
const rowsCleared = (seq: string): number => (seq === "" ? 0 : seq.split("\x1b[2K").length - 1);

// SP-R0's worked example, verbatim: 6 logical lines emitted at 120, re-wrapped to 10 physical rows at 40. Ink
// erased 7 (its previousLineCount); the region that must end up clear is 11.
const SP_R0 = ["a".repeat(40), "b".repeat(200), "c", "d", "e", "f"].join("\n") + "\n";
const sample = (over: Partial<ResizeSample> = {}): ResizeSample =>
  ({ frame: SP_R0, parkedCol: 0, oldWidth: 120, newWidth: 40, rows: 40, ...over });

describe("eraseRows", () => {
  it("is ansi-escapes' eraseLines, byte for byte", () => {
    for (const n of [0, 1, 2, 7, 11]) expect(eraseRows(n), String(n)).toBe(inkEraseLines(n));
  });

  it("clears n rows and treats a non-positive count as nothing to do", () => {
    expect(rowsCleared(eraseRows(11))).toBe(11);
    expect(eraseRows(0)).toBe("");
    expect(eraseRows(-3)).toBe("");
  });
});

describe("occupiedRows — the region a painted frame owns", () => {
  // The pin the brief asks for: 6 logical, Ink erased 7, occupied 10, correct 11.
  it("reproduces the SP-R0 worked example", () => {
    expect(SP_R0.split("\n").length - 1).toBe(6);           // 6 logical lines…
    expect(inkErases(SP_R0)).toBe(7);                       // …so Ink erases 7
    expect(physicalRows(SP_R0, 40)).toBe(10);               // …while the frame occupies 10 rows at the new width
    expect(occupiedRows(SP_R0, 0, 40)).toBe(11);            // …and the region to clear is 11
  });

  // WHY THE CURSOR ROW IS NOT ALWAYS ONE ROW. The oracle can only answer when the cursor sits PAST the new right
  // edge, so the park pads that row with spaces out to `oldWidth - 3` — and a padded row re-wraps on a shrink
  // exactly like any other content. Ignoring that would under-erase by ceil(parkedCol / newWidth) - 1 rows.
  it("counts the parked cursor row's own re-wrap", () => {
    expect(occupiedRows(SP_R0, 117, 40)).toBe(10 + 3);      // 117 padded cells wrap to 3 rows at 40
    expect(occupiedRows(SP_R0, 117, 120)).toBe(7 + 1);      // …and to one row at the width it was padded for
  });
});

// TASK 4B: THE CORRECTION MOVED TO THE WRITE. A SIGWINCH does not imply an Ink write — `resized()` hands the
// repaint to a throttle (leading + trailing) and `log-update` drops a write whose output is unchanged — so a
// correction emitted from the resize listener runs against a cursor Ink may not move for another tick, or ever.
// Residue is created only by a frame write that under-erases, so the correction belongs to that write, where the
// live width, the frame on screen, the park and Ink's own erase depth are all known exactly and none of them is
// a prediction. Task 4's `correctionBeforeRepaint` and the listener's synchronous emission are gone with it.
describe("frameWriteCorrection — injected between Ink's erase prefix and the body, at the write itself", () => {
  const info = (over: Partial<FrameWriteInfo> = {}): FrameWriteInfo =>
    ({ inkErases: 7, prevFrame: SP_R0, parkedCol: 117, widthAtPaint: 120, width: 40, rows: 40, ...over });

  // The brief's worked example, verbatim: the frame Ink is erasing occupies 10 rows at the LIVE width plus the
  // padded park's 3 = 13, while Ink's own prefix covers 7. The injected run re-clears Ink's topmost row plus the
  // 6 above it, so the two runs together cover exactly 13 distinct rows and the body paints from the true top.
  it("reproduces the SP-R0 worked example", () => {
    const seq = frameWriteCorrection(info(), "reflow");
    expect(occupiedRows(SP_R0, 117, 40)).toBe(13);
    expect(seq).toBe(inkEraseLines(7));                                  // 13 - 7 + 1
    expect(rowsCleared(seq) + 7 - 1).toBe(13);                           // …and the two runs meet on one shared row
  });

  // The asymmetry rule: only a MEASURED "reflow" corrects. `undefined` is the session's first shrink, before the
  // probe has answered — that write goes out uncorrected and `correctionAfterRepaint` repairs it. "unknown" is a
  // terminal we could not measure and behaves exactly like "truncate": a wrong "truncate" costs a cosmetic row,
  // a wrong "reflow" costs live transcript.
  it("emits nothing without a measured reflow", () => {
    for (const verdict of [undefined, "truncate", "unknown"] as (ReflowVerdict | undefined)[])
      expect(frameWriteCorrection(info(), verdict), String(verdict)).toBe("");
  });

  // The width compared is the one the RECORDED frame was painted at, not the one the resize listener saw: a
  // frame painted at 120 and re-written while the terminal is 40 wide is the whole of the defect.
  it("emits nothing when the width has not narrowed since that frame was painted", () => {
    expect(frameWriteCorrection(info({ width: 160 }), "reflow")).toBe("");
    expect(frameWriteCorrection(info({ width: 120 }), "reflow")).toBe("");
    expect(frameWriteCorrection(info({ width: 0 }), "reflow")).toBe("");   // and never off a bogus width
  });

  it("emits nothing when Ink's own prefix already covers the region", () => {
    expect(frameWriteCorrection(info({ inkErases: 13 }), "reflow")).toBe("");
    expect(frameWriteCorrection(info({ inkErases: 20 }), "reflow")).toBe("");
  });

  it("caps the region at the rows on screen", () => {
    expect(frameWriteCorrection(info({ rows: 9 }), "reflow")).toBe(inkEraseLines(9 - 7 + 1));
  });
});

describe("correctionAfterRepaint — the first shrink, corrected once the async verdict lands", () => {
  // By now Ink has already repainted (and the proxy has re-parked on the new frame's cursor row). The residue is
  // above the new frame, so the erase has to cover the new frame too — and the frame is then written back, which
  // is what makes erase-then-repaint safe rather than a way to destroy the frame Ink just painted.
  const now = ["x".repeat(30), "y", "z"].join("\n") + "\n";              // 3 logical lines, 3 rows at 40

  it("erases the residue plus the frame below it and writes the frame back", () => {
    const seq = correctionAfterRepaint(sample(), "reflow", now, 37);
    expect(rowsCleared(seq)).toBe(11 - 7 + 3 + 1);                       // residue 4 + frame 3 + cursor row 1
    expect(seq).toBe(inkEraseLines(8) + now);                            // …and the frame comes straight back
  });

  it("emits nothing when there is no frame to put back", () => {
    expect(correctionAfterRepaint(sample(), "reflow", undefined, 37)).toBe("");
  });

  it("emits nothing without a measured reflow, and nothing when there is no residue", () => {
    expect(correctionAfterRepaint(sample(), "truncate", now, 37)).toBe("");
    expect(correctionAfterRepaint(sample(), "unknown", now, 37)).toBe("");
    expect(correctionAfterRepaint(sample({ frame: "one\ntwo\n", newWidth: 80 }), "reflow", now, 37)).toBe("");
  });
});

describe("createResizeRepaint — the driver", () => {
  const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
  const rig = (opts: { frame?: string | undefined; verdicts?: ReflowVerdict[] } = {}) => {
    let columns = 120, parked = 117, frame: string | undefined = "frame" in opts ? opts.frame : SP_R0;
    const repainted: string[] = [], verdictAtRepaint: (ReflowVerdict | undefined)[] = [];
    const probes: Array<{ colBefore: number; oldWidth: number; newWidth: number }> = [];
    const verdicts = [...(opts.verdicts ?? ["reflow"])];
    let resolve: ((v: ReflowVerdict) => void) | undefined;
    let verdictNow: () => ReflowVerdict | undefined = () => undefined;
    const driver = createResizeRepaint({
      lastFrame: () => frame,
      parkedColumn: () => parked,
      size: () => ({ columns, rows: 40 }),
      repaint: (s) => { repainted.push(s); verdictAtRepaint.push(verdictNow()); },
      probe: (a) => { probes.push(a); const next = verdicts.shift(); return next ? Promise.resolve(next) : new Promise((r) => { resolve = r; }); },
    });
    verdictNow = driver.verdict;
    return { driver, repainted, verdictAtRepaint, probes,
      resize: (to: number) => { columns = to; driver.onResize(); parked = parkColumn(to); },
      /** Ink repaints and the proxy re-parks on the new frame — the live state the async continuation has to read
       *  instead of the sample it took when SIGWINCH fired. */
      repaintedAs: (next: string) => { frame = next; parked = parkColumn(columns); },
      settle: (v: ReflowVerdict) => resolve?.(v) };
  };

  it("probes on the first shrink and corrects asynchronously when the answer is reflow", async () => {
    const r = rig();
    r.resize(80);
    expect(r.probes).toEqual([{ colBefore: 117, oldWidth: 120, newWidth: 80 }]);
    expect(r.driver.verdict()).toBeUndefined();                           // nothing to correct that write with, yet
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    expect(r.repainted[0]?.endsWith(SP_R0)).toBe(true);                   // erase, then the frame straight back
  });

  // Task 4b: the cached verdict is no longer a licence to emit from the listener. Ink may not write for another
  // tick (throttle) or at all (dedupe), so the listener publishes the verdict and the WRITE does the correcting.
  it("reuses the cached verdict on the next shrink and leaves the correcting to the write", async () => {
    const r = rig();
    r.resize(80);
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    r.resize(60);
    expect(r.probes.length).toBe(1);                                      // the verdict is a property of the TERMINAL
    expect(r.driver.verdict()).toBe("reflow");                            // …published for the write-time corrector…
    expect(r.repainted.length).toBe(1);                                   // …and nothing at all emitted from here
  });

  // OUR OWN ERASE-PLUS-FRAME WRITE ALREADY CARRIES A FULL-REGION ERASE. It goes back through Ink's stdout (so the
  // proxy re-records the frame and re-parks on it), which also puts it under the write-time corrector — and a
  // second erase run stacked on the first walks straight into live transcript. So for exactly the duration of
  // that write the corrector is told there is no verdict.
  it("hides the verdict from the write-time corrector while it writes its own repaint", async () => {
    const r = rig();
    r.resize(80);
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    expect(r.verdictAtRepaint).toEqual([undefined]);
    expect(r.driver.verdict()).toBe("reflow");                            // …and it is back the moment the write ends
  });

  it("caches truncate too, and never corrects again", async () => {
    const r = rig({ verdicts: ["truncate"] });
    r.resize(80);
    await vi.waitFor(() => expect(r.probes.length).toBe(1));
    r.resize(60);
    expect(r.probes.length).toBe(1);
    expect(r.driver.verdict()).toBe("truncate");
    expect(r.repainted).toEqual([]);
  });

  // A refusal is a fact about THIS probe (an ambiguous column, a width that divides it), not about the terminal —
  // so it is never cached, and the next shrink asks again.
  it("does not cache unknown and re-probes on the next shrink", async () => {
    const r = rig({ verdicts: ["unknown", "reflow"] });
    r.resize(80);
    await vi.waitFor(() => expect(r.probes.length).toBe(1));
    r.resize(60);
    expect(r.probes.length).toBe(2);
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
  });

  // One reply, one consumer, oldest first (reflowOracle): a second in-flight probe would be answered by the
  // first one's reply.
  it("keeps exactly one probe in flight", () => {
    const r = rig({ verdicts: [] });
    r.resize(80);
    r.resize(60);
    expect(r.probes.length).toBe(1);
    r.settle("reflow");
  });

  // THE STALE-SAMPLE AXIS (t4 review). `probeReflow` waits up to 750 ms and everything in the sample was measured
  // at the width the drag landed on. Three separate things can move underneath it before the answer arrives.

  // 1. THE WIDTH. Driven against the real driver, a shrink to 80 + a widen to 200 mid-probe + a "reflow" answer
  // erased 13 rows over 7 occupied — six live transcript rows, the exact over-erase this wave exists to prevent.
  // The verdict is still a fact about the terminal, so it is kept; only the emission is abandoned.
  it("abandons the correction when the terminal is no longer the width the sample was measured at", async () => {
    const r = rig({ verdicts: [] });
    r.resize(80);                                                         // probe goes out, answer not back yet
    r.resize(200);                                                        // …and the user keeps dragging
    r.settle("reflow");
    await flush();
    expect(r.repainted).toEqual([]);                                      // nothing emitted against a width that is gone
    r.resize(120);                                                        // but the verdict was cached all the same:
    expect(r.probes.length).toBe(1);                                      // …no second probe…
    expect(r.driver.verdict()).toBe("reflow");                            // …and every write from here is corrected
  });

  // 2. THE FRAME AND THE PARK. By the time the answer lands Ink has repainted (possibly more than once) and the
  // proxy has re-parked on whatever it painted. The erase has to cover THAT frame and write THAT frame back;
  // reusing the sample's would erase the wrong height and then paint a frame the screen has moved on from.
  it("erases and repaints the frame that is on screen now, not the one the sample captured", async () => {
    const r = rig({ verdicts: [] });
    r.resize(80);
    const now = ["x".repeat(30), "y"].join("\n") + "\n";                  // shorter than SP_R0, and parked at 77
    r.repaintedAs(now);
    r.settle("reflow");
    await flush();
    expect(r.repainted).toEqual([correctionAfterRepaint({ frame: SP_R0, parkedCol: 117, oldWidth: 120, newWidth: 80, rows: 40 }, "reflow", now, 77)]);
    expect(r.repainted[0]?.endsWith(now)).toBe(true);                     // the live frame goes back, not the stale one
    expect(r.repainted[0]?.includes(SP_R0)).toBe(false);
  });

  // 3. THE TRACKED WIDTH ITSELF. `onResize` compares against the width it last saw, not the width at startup — a
  // 120 → 80 → 100 sequence ends on a GROW. A driver that never advanced its own `width` would read the last step
  // as 120 → 100, a shrink, and correct a resize that has nothing to correct.
  it("advances the width it compares against, so a later grow is still a grow", async () => {
    const r = rig();
    r.resize(80);
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    r.resize(100);
    expect(r.repainted.length).toBe(1);
  });

  it("never probes or corrects on a grow, a height-only resize, or with no recorded frame", () => {
    const grow = rig(); grow.resize(160);
    const flat = rig(); flat.resize(120);
    const bare = rig({ frame: undefined }); bare.resize(80);
    for (const r of [grow, flat, bare]) { expect(r.probes).toEqual([]); expect(r.repainted).toEqual([]); }
  });
});

// The other half of the wiring: the cursor has to already be past the new right edge when SIGWINCH arrives, and
// the new width is not known until then — so the proxy parks after every frame it records.
describe("the parked cursor", () => {
  it("pads out to oldWidth - 3 and sits inside the padding", () => {
    expect(parkColumn(120)).toBe(117);
    expect(parkSequence(117)).toBe("\x1b[G" + " ".repeat(117) + "\x1b[117G");
  });

  // Below this there is no interior column left to park in, and a terminal that narrow has no residue worth
  // chasing either.
  it("declines to park a terminal too narrow to hold a probe", () => {
    for (const columns of [0, 1, 7, undefined as unknown as number]) expect(parkColumn(columns), String(columns)).toBe(0);
  });

  it("parks after each recorded frame and reports the column it parked at", () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    expect(out.parkedColumn()).toBe(0);
    out.stdout.write(inkEraseLines(3) + "one\ntwo\n");
    expect(out.lastFrame()).toBe("one\ntwo\n");                           // the park must not be mistaken for a frame
    expect(out.parkedColumn()).toBe(117);
    expect(chunks.at(-1)).toBe(parkSequence(117));
  });

  it("does not park an erase-only write, a <Static> write, or a terminal that is not a tty", () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    out.stdout.write(inkEraseLines(2));                                    // log.clear()
    out.stdout.write("scrollback\n");                                      // the <Static> chunk right after it
    expect(chunks).toEqual([inkEraseLines(2), "scrollback\n"]);
    expect(out.parkedColumn()).toBe(0);
    const dumb = { isTTY: false, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out2 = createResumeSafeStdout(dumb as never);
    out2.stdout.write("frame\n");
    expect(out2.parkedColumn()).toBe(0);
  });

  // The park leaves the cursor mid-row. Ink never notices (every write it makes opens with a full-line erase or
  // homes the column itself), but anything else would paint from column 117 — the ctrl+z hand-off to the shell
  // and the keymap's DECSET writes both go through here.
  it("homes the cursor ahead of a write that is not Ink's own bookkeeping", () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    out.stdout.write(inkEraseLines(3) + "one\n");
    chunks.length = 0;
    out.stdout.write("\x1b[?25h");
    expect(chunks).toEqual(["\x1b[G", "\x1b[?25h", parkSequence(117)]);   // …and put straight back: it painted nothing
    expect(out.parkedColumn()).toBe(117);
  });

  // A PARK THE CURSOR HAS LEFT IS A LIE, AND EVERY READER OF IT IS HARMED (t4 review). Ink's tall-frame branch
  // opens with `clearTerminal`, which homes the cursor; measured on the real proxy, `parkedColumn()` went on
  // reporting 117 while the cursor sat at column 20. `probeReflow` would then be handed a `colBefore` the cursor is
  // not in, could not match the reply, and would cache `"truncate"` for the whole session — permanently disabling
  // the correction (or, on a coincidental match, caching a false `"reflow"` on a terminal nobody measured).
  it("forgets the park across Ink's tall-frame clearTerminal write", () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    out.stdout.write(inkEraseLines(3) + "one\ntwo\n");
    expect(out.parkedColumn()).toBe(117);
    chunks.length = 0;
    out.stdout.write("\x1b[2J\x1b[3J\x1b[H" + "scrollback\n" + "one\ntwo\n");   // ink.js:121-124, one chunk
    expect(out.parkedColumn()).toBe(0);
    expect(chunks).toEqual(["\x1b[2J\x1b[3J\x1b[H" + "scrollback\n" + "one\ntwo\n"]);   // no park written after it
    expect(out.lastFrame()).toBe("one\ntwo\n");                            // and the chunk itself is still not a frame
  });

  // The same rule for the other write that moves the cursor without painting: `eraseLines` leaves it at column 1 of
  // the topmost row it cleared. A `parkedCol` that stayed at 117 would have the exit unpark clear a row the cursor
  // is genuinely on, and would re-park a following escapes-only write onto a row Ink is about to repaint from.
  it("forgets the park across an erase-only write", () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    out.stdout.write(inkEraseLines(3) + "one\n");
    expect(out.parkedColumn()).toBe(117);
    out.stdout.write(inkEraseLines(2));                                    // log.clear()
    expect(out.parkedColumn()).toBe(0);
    expect(out.lastFrame()).toBeUndefined();
  });

  // The park at launch has to survive the writes that land BETWEEN the first frame and the first resize — at the
  // real binary those are the keymap's DECSET 2004 enable and Ink's cursor hide, and dropping the park for them
  // made the first shrink's probe report `colBefore = 0`, i.e. "unknown", i.e. no correction ever (measured).
  it("does not put the park back after a write that painted something", () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    out.stdout.write(inkEraseLines(3) + "one\n");
    chunks.length = 0;
    out.stdout.write("a bare line of text");
    expect(chunks).toEqual(["\x1b[G", "a bare line of text"]);
    expect(out.parkedColumn()).toBe(0);
  });
});

// TASK 4B AT THE PROXY. The only thing that can create residue is a frame write whose erase prefix is shorter than
// the region that frame now occupies — so this is where the correction is applied, and every input it needs is
// read at the instant the bytes arrive: the live `stdout.columns`, the frame recorded from the PREVIOUS write and
// the width THAT write went out at, and the park as it currently stands on screen.
describe("the write-time frame corrector", () => {
  const rig = (columns = 120) => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    let verdict: ReflowVerdict | undefined = "reflow";
    const seen: FrameWriteInfo[] = [];
    out.setFrameCorrector((i) => { seen.push(i); return frameWriteCorrection(i, verdict); });
    return { chunks, terminal, out, seen, setVerdict: (v: ReflowVerdict | undefined) => { verdict = v; } };
  };

  // The SP-R0 fixture end to end: a frame painted at 120 with the park at 117, then re-written while the terminal
  // is 40 columns wide and Ink's prefix erases only its 7 logical lines. Prefix, correction and body leave as ONE
  // chunk — a separate write would let the terminal (or another writer) interleave between the two erase runs.
  it("injects the correction between Ink's erase prefix and the body, in a single write", () => {
    const r = rig();
    r.out.stdout.write(SP_R0);                                             // first frame of the session: no prefix
    expect(r.out.parkedColumn()).toBe(117);
    r.terminal.columns = 40;                                               // …the drag…
    r.chunks.length = 0;
    r.out.stdout.write(inkEraseLines(7) + "next\n");                       // …and Ink's repaint, under-erasing
    expect(r.seen.at(-1)).toEqual({ inkErases: 7, prevFrame: SP_R0, parkedCol: 117, widthAtPaint: 120, width: 40, rows: 40 });
    expect(r.chunks).toEqual([inkEraseLines(7) + inkEraseLines(7) + "next\n", parkSequence(37)]);
    expect(r.out.lastFrame()).toBe("next\n");                              // …and the new frame is what is recorded
  });

  // THE THROTTLE CASE, WHICH IS WHY THIS LIVES AT THE WRITE (sabotage gap #22). Ink's `resized()` renders through
  // `throttle(this.log, undefined, {leading:true, trailing:true})`, so a drag emits one write immediately and one
  // on a trailing timer — by which time the terminal is a different width again. Each write is corrected against
  // the width that is true when IT arrives; a corrector that captured state when SIGWINCH fired cannot do this.
  it("corrects two frame writes in one burst against their own live widths", () => {
    const r = rig();
    r.out.stdout.write(SP_R0);                                             // painted at 120, parked at 117
    r.terminal.columns = 80;
    r.chunks.length = 0;
    r.out.stdout.write(inkEraseLines(7) + SP_R0);                          // the throttle's leading write
    r.terminal.columns = 40;
    r.out.stdout.write(inkEraseLines(7) + SP_R0);                          // …and its trailing one, a drag later
    expect(r.chunks[0]).toBe(inkEraseLines(7) + inkEraseLines(4) + SP_R0);   // 8 rows + park 117 → 2 = 10; 10-7+1
    expect(r.chunks[1]).toBe(parkSequence(77));
    expect(r.chunks[2]).toBe(inkEraseLines(7) + inkEraseLines(6) + SP_R0);   // 10 rows + park 77 → 2 = 12; 12-7+1
    expect(r.seen.map((i) => [i.widthAtPaint, i.width, i.parkedCol])).toEqual([[120, 80, 117], [80, 40, 77]]);
  });

  // `eraseLines(0)` is the empty string, so the first frame of a session — and any frame right after a clear —
  // arrives with no prefix at all. There is nothing above it that Ink failed to erase, so there is nothing to
  // correct; the corrector is not even consulted.
  it("leaves a frame that carries no erase prefix exactly as Ink wrote it", () => {
    const r = rig();
    r.out.stdout.write(inkEraseLines(3) + SP_R0);
    r.terminal.columns = 40;
    r.chunks.length = 0;
    r.out.stdout.write("next\n");
    expect(r.chunks).toEqual(["\x1b[G", "next\n", parkSequence(37)]);       // homed off the park, then untouched
    expect(r.seen).toEqual([]);                                            // …and with nothing recorded before it either
  });

  // Every one of these is a genuine narrowing with residue on screen — only the verdict refuses. "unknown" is a
  // terminal nobody measured and it must behave exactly like "truncate": a wrong "truncate" leaves a cosmetic
  // row, a wrong "reflow" erases the user's transcript.
  it("leaves every write alone while the verdict is not a measured reflow", () => {
    const r = rig();
    r.out.stdout.write(inkEraseLines(3) + SP_R0);
    r.chunks.length = 0;
    for (const [width, verdict] of [[40, undefined], [30, "truncate"], [20, "unknown"]] as const) {
      r.terminal.columns = width;
      r.setVerdict(verdict);
      r.out.stdout.write(inkEraseLines(7) + SP_R0);
    }
    expect(r.chunks.filter((c) => c.startsWith("\x1b[2K"))).toEqual(Array(3).fill(inkEraseLines(7) + SP_R0));
    expect(r.seen.map((i) => [i.widthAtPaint, i.width])).toEqual([[120, 40], [40, 30], [30, 20]]);
  });

  // A proxy nobody wired a corrector into (every test above task 4b, and any tree that renders without the resize
  // machinery) writes exactly what Ink handed it.
  it("is inert until a corrector is set", () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    out.stdout.write(SP_R0);
    terminal.columns = 40;
    chunks.length = 0;
    out.stdout.write(inkEraseLines(7) + "next\n");
    expect(chunks).toEqual([inkEraseLines(7) + "next\n", parkSequence(37)]);
  });
});
