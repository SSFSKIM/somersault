// test/unit/resize-repaint.test.ts — Wave R task 4: the correction itself. Every case here is about ONE
// asymmetry: an under-erase leaves today's cosmetic residue, an over-erase eats live transcript rows. So the
// emitting cases pin exact byte counts and the refusing cases (grow, "truncate", "unknown", no recorded frame)
// pin the empty string.
import { describe, expect, it, vi } from "vitest";
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";
import { correctionAfterRepaint, correctionAtSettle, createResizeRepaint, eraseRows, frameWriteCorrection,
  inkErases, occupiedRows, parkColumn, parkSequence, physicalRows, type FrameWriteInfo,
  type ResizeSample, type SettleSample } from "../../src/tui/resizeRepaint.js";
import type { ReflowVerdict } from "../../src/tui/reflowOracle.js";

// ansi-escapes' eraseLines(n), byte-for-byte — the same shape test/unit/resume-safe-stdout.test.ts pins, because
// the correction has to be indistinguishable from Ink's own erase to the terminal.
const inkEraseLines = (n: number): string => (n === 0 ? "" : "\x1b[2K" + "\x1b[1A\x1b[2K".repeat(n - 1) + "\x1b[G");
/** How many DISTINCT rows a run of eraseLines(n) clears, counting from the cursor's row upward. */
const rowsCleared = (seq: string): number => (seq === "" ? 0 : seq.split("\x1b[2K").length - 1);

// SP-R0's worked example, verbatim: 6 logical lines emitted at 120, re-wrapped to 10 physical rows at 40. Ink
// erased 7 (its previousLineCount); the region that must end up clear is 11.
const SP_R0 = ["a".repeat(40), "b".repeat(200), "c", "d", "e", "f"].join("\n") + "\n";
const sample = (over: Partial<ResizeSample> = {}): ResizeSample => ({ oldWidth: 120, newWidth: 40, rows: 40, ...over });

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

  // THE REFUSAL IS A GROW, AND ONLY A GROW (qa2-09). It used to be any width the frame had not NARROWED into,
  // on the premise that a frame re-written at the width it was painted at cannot have re-wrapped — false for
  // exactly the frame that matters, Ink's SIGWINCH repaint, whose content is still laid out for the old width
  // and over-runs the new one by plain autowrap. SP_R0 is that shape at 120: its 200-cell line is two rows, so
  // it owns 7 rows plus its park against the 7 Ink erases, and the row that leaves is the qa2-09 corpse.
  it("refuses a grow, and corrects a frame that over-runs the width it was painted at", () => {
    expect(frameWriteCorrection(info({ width: 160 }), "reflow")).toBe("");
    expect(occupiedRows(SP_R0, 117, 120)).toBe(8);
    expect(frameWriteCorrection(info({ width: 120 }), "reflow")).toBe(inkEraseLines(2));   // 8 - 7 + 1
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
  // By now Ink has already repainted (and the proxy has re-parked on the new frame's cursor row). The stranded
  // rows are above the new frame, so the erase has to cover the new frame too — and the frame is then written
  // back, which is what makes erase-then-repaint safe rather than a way to destroy the frame Ink just painted.
  // The count of stranded rows is NOT derived here: it is summed at the writes that made them (`writeShortfall`),
  // and 4 is what SP_R0's own re-wrap leaves — occupiedRows(SP_R0, 117, 40) = 11 against Ink's erase of 7.
  const now = ["x".repeat(30), "y", "z"].join("\n") + "\n";              // 3 logical lines, 3 rows at 40

  it("erases the stranded rows plus the frame below them and writes the frame back", () => {
    const seq = correctionAfterRepaint(sample(), "reflow", now, 37, 4);
    expect(rowsCleared(seq)).toBe(4 + 3 + 1);                            // stranded 4 + frame 3 + cursor row 1
    expect(seq).toBe(inkEraseLines(8) + now);                            // …and the frame comes straight back
  });

  it("emits nothing when there is no frame to put back", () => {
    expect(correctionAfterRepaint(sample(), "reflow", undefined, 37, 4)).toBe("");
  });

  // NO WRITE, NO CLAIM (qa2-09). A resize Ink dedupes away (`log-update.js:13` returns early on unchanged
  // output) strands nothing at all — the old frame is simply on screen, re-wrapped whole — and the version that
  // predicted the residue from the drag erased four rows of it anyway.
  it("emits nothing without a measured reflow, and nothing when no write stranded anything", () => {
    expect(correctionAfterRepaint(sample(), "truncate", now, 37, 4)).toBe("");
    expect(correctionAfterRepaint(sample(), "unknown", now, 37, 4)).toBe("");
    expect(correctionAfterRepaint(sample(), "reflow", now, 37, 0)).toBe("");
  });
});

// WAVE 2 TASK 7 (s2qa2-07) — THE BURST REPAIR. Every path above is gated on a NARROWING, and a burst that ends
// where it started (120 → 90 → 150 → 120) contains no net one: `onResize` refuses on `newWidth < oldWidth`,
// `frameWriteCorrection` refuses on `width < widthAtPaint`, and `correctionAfterRepaint`'s sample is abandoned
// because the terminal moved under the probe. The intermediate shrink's residue is nonetheless on screen and
// nothing revisits it. So the repair that runs once the drag stops is DIRECTION-INDEPENDENT and measured off the
// live frame — with one fact the settled screen cannot report about itself: the narrowest width a narrowing
// inside the burst landed on, which is where the frame was at its tallest and therefore how far the residue
// reaches above it.
describe("correctionAtSettle — the burst repair, measured off the live frame once the drag stops", () => {
  const at = (over: Partial<SettleSample> = {}): SettleSample =>
    ({ frame: SP_R0, frameAtNarrowest: SP_R0, parkedCol: 117, width: 120, narrowest: 90, rows: 40, ...over });

  // SP_R0 is 7 physical rows at 120 (only the 200-cell line wraps, and not until 100) and 8 at 90, so one row of
  // it was left above Ink's erase by the 120 → 90 leg. The erase covers that row plus the frame and its park row
  // as they stand NOW, and the frame comes straight back — the same shape, and the same reason, as the first
  // shrink's `correctionAfterRepaint`.
  it("erases the rows the frame occupied at the narrowest width in the burst, and writes it back", () => {
    expect(physicalRows(SP_R0, 120)).toBe(7);
    expect(physicalRows(SP_R0, 90)).toBe(8);
    expect(correctionAtSettle(at(), "reflow")).toBe(inkEraseLines(1 + 8) + SP_R0);   // residue 1 + region 8
  });

  // The whole safety argument of this module, unchanged (`resizeRepaint.ts:6-9`): only a MEASURED reflow corrects.
  // A truncating emulator strands nothing, and an unmeasured one is treated as one.
  it("emits nothing without a measured reflow", () => {
    for (const verdict of [undefined, "truncate", "unknown"] as (ReflowVerdict | undefined)[])
      expect(correctionAtSettle(at(), verdict), String(verdict)).toBe("");
  });

  // The burst never went below where it settled (or never narrowed at all — `narrowest` stays Infinity then), so
  // every row the frame ever painted is inside the region it occupies now. Nothing is stranded and the write-time
  // corrector already owns the leg that got here.
  it("emits nothing when the burst never dipped below the width it settled at", () => {
    for (const narrowest of [120, 160, Infinity])
      expect(correctionAtSettle(at({ narrowest }), "reflow"), String(narrowest)).toBe("");
    expect(correctionAtSettle(at({ narrowest: 0 }), "reflow")).toBe("");
    expect(correctionAtSettle(at({ width: 0 }), "reflow")).toBe("");        // …and never off a width off a tty
  });

  // A frame short enough to wrap the same way at both widths left nothing behind, whatever the drag did.
  it("emits nothing when the frame is no taller at the narrowest width than it is now", () => {
    expect(correctionAtSettle(at({ frame: "one\ntwo\n", frameAtNarrowest: "one\ntwo\n" }), "reflow")).toBe("");
  });

  it("caps the erase at the rows on screen", () => {
    expect(correctionAtSettle(at({ rows: 5 }), "reflow")).toBe(inkEraseLines(5) + SP_R0);
  });

  // FIX ROUND 1, FINDING 2 — THE TWO TERMS COME OFF TWO DIFFERENT FRAMES, AND PAIRING THE LIVE ONE WITH THE
  // REMEMBERED WIDTH IS AN OVER-ERASE. `narrowest` is a width the burst crossed up to 80 ms (or, on the
  // awaiting-verdict path, up to 750 ms) earlier; the frame that was on screen then is the only frame whose
  // re-wrap at that width stranded anything. A streaming turn grows the live frame during the drag, and the
  // shipped version scaled the residue with it: reproduced through the driver at 31 rows erased over 21
  // occupied and 0 owed. So the residue is measured off `frameAtNarrowest` and the region off the live frame,
  // which is exactly `correctionAfterRepaint`'s split.
  it("takes the residue from the frame that was on screen at the narrowing, not the frame that replaced it", () => {
    const short = "composer\n";                                            // 1 row at 90 and at 120: strands nothing
    const tall = ["z".repeat(200), "y", "x"].join("\n") + "\n";            // …and the turn streamed 3 → 5 rows since
    expect(correctionAtSettle(at({ frame: tall, frameAtNarrowest: short }), "reflow")).toBe("");
    // …and symmetrically, a live frame that SHRANK does not shrink the claim: the rows are the narrowing's.
    expect(rowsCleared(correctionAtSettle(at({ frame: short, frameAtNarrowest: SP_R0 }), "reflow")))
      .toBe(1 + occupiedRows(short, 117, 120));
  });
});

describe("createResizeRepaint — the driver", () => {
  const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
  const rig = (opts: { frame?: string | undefined; verdicts?: ReflowVerdict[] } = {}) => {
    let columns = 120, parked = 117, frame: string | undefined = "frame" in opts ? opts.frame : SP_R0;
    let paintedAt = 120, detached = 0;
    const repainted: string[] = [], verdictAtRepaint: (ReflowVerdict | undefined)[] = [];
    const probes: Array<{ colBefore: number; oldWidth: number; newWidth: number }> = [];
    const verdicts = [...(opts.verdicts ?? ["reflow"])];
    let resolve: ((v: ReflowVerdict) => void) | undefined;
    let verdictNow: () => ReflowVerdict | undefined = () => undefined;
    // The settle window, injected the way every other timer in this codebase is (statusLine.ts:263-264): the
    // trailing debounce is the whole subject of the burst cases, and a test that waited out a real 80 ms would be
    // timing-dependent in exactly the place the fix is being asserted.
    let handle = 0;
    const timers = new Map<number, { fn: () => void; ms: number }>();
    const driver = createResizeRepaint({
      lastFrame: () => frame,
      parkedColumn: () => parked,
      size: () => ({ columns, rows: 40 }),
      repaint: (s) => { repainted.push(s); verdictAtRepaint.push(verdictNow()); },
      probe: (a) => { probes.push(a); const next = verdicts.shift(); return next ? Promise.resolve(next) : new Promise((r) => { resolve = r; }); },
      setTimeout: (fn, ms) => { const h = ++handle; timers.set(h, { fn, ms }); return h; },
      clearTimeout: (h) => { timers.delete(h as number); },
      detached: () => detached,
    });
    verdictNow = driver.verdict;
    /** ONE FRAME WRITE, as the proxy hands it to the module: Ink's prefix erases the recorded frame's LOGICAL
     *  line count, and `painted` goes out below whatever that missed. This is the ONLY thing that can strand a
     *  row, and now the only thing the repairs count — so a case that omits it is modelling a screen with no
     *  residue on it at all (the module's own dedupe reasoning: with no write, the old frame is simply on
     *  screen, re-wrapped whole). */
    const inkWrites = (painted: string): void => {
      if (frame !== undefined) driver.frameWrite({ inkErases: inkErases(frame), prevFrame: frame, parkedCol: parked, widthAtPaint: paintedAt, width: columns, rows: 40 });
      frame = painted; paintedAt = columns; parked = parkColumn(columns);
    };
    return { driver, repainted, verdictAtRepaint, probes, timers, inkWrites,
      /** A SIGWINCH ALONE. Ink may write on this signal, on a later tick, or never (`throttledLog` defers, the
       *  dedupe drops), so the two halves are separate here for the cases that are about exactly that — and the
       *  park does not move, because the proxy re-parks only after a frame it RECORDED. */
      resize: (to: number) => { columns = to; driver.onResize(); },
      /** ONE LEG OF A REAL DRAG: the SIGWINCH, and then Ink's own synchronous repaint (`ink.js:83` `resized()`
       *  → `onRender`, which runs inside the same signal). */
      drag: (to: number, painted: string) => { columns = to; driver.onResize(); inkWrites(painted); },
      /** Ink repaints again, without a signal — the live state the async continuation has to read instead of the
       *  sample it took when SIGWINCH fired. */
      repaintedAs: (next: string) => { inkWrites(next); },
      /** An erase-only write or Ink's tall-frame clear: the screen above the frame is re-laid, so no count of
       *  rows taken before it says where those rows are any more. */
      detach: () => { detached += 1; },
      /** The drag stops: run whatever the trailing window has armed (exactly one entry, always — that IS the
       *  debounce) and report how many there were. */
      settleWindow: () => { const armed = [...timers.values()]; timers.clear(); for (const t of armed) t.fn(); return armed.length; },
      settle: (v: ReflowVerdict) => resolve?.(v) };
  };

  it("probes on the first shrink and corrects asynchronously when the answer is reflow", async () => {
    const r = rig();
    r.drag(80, SP_R0);
    expect(r.probes).toEqual([{ colBefore: 117, oldWidth: 120, newWidth: 80 }]);
    expect(r.driver.verdict()).toBeUndefined();                           // nothing to correct that write with, yet
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    expect(r.repainted[0]?.endsWith(SP_R0)).toBe(true);                   // erase, then the frame straight back
  });

  // Task 4b: the cached verdict is no longer a licence to emit from the listener. Ink may not write for another
  // tick (throttle) or at all (dedupe), so the listener publishes the verdict and the WRITE does the correcting.
  it("reuses the cached verdict on the next shrink and leaves the correcting to the write", async () => {
    const r = rig();
    r.drag(80, SP_R0);
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
    r.drag(80, SP_R0);
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
    r.drag(80, SP_R0);
    await vi.waitFor(() => expect(r.probes.length).toBe(1));
    r.drag(60, SP_R0);
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
    // 3 rows: SP_R0 occupies 8 at 80 and its padded park two more, against the 7 Ink's prefix erased.
    expect(r.repainted).toEqual([correctionAfterRepaint({ oldWidth: 120, newWidth: 80, rows: 40 }, "reflow", now, 77, 3)]);
    expect(r.repainted[0]?.endsWith(now)).toBe(true);                     // the live frame goes back, not the stale one
    expect(r.repainted[0]?.includes(SP_R0)).toBe(false);
  });

  // 3. THE TRACKED WIDTH ITSELF. `onResize` compares against the width it last saw, not the width at startup — a
  // 120 → 80 → 100 sequence ends on a GROW. A driver that never advanced its own `width` would read the last step
  // as 120 → 100, a shrink, and correct a resize that has nothing to correct.
  it("advances the width it compares against, so a later grow is still a grow", async () => {
    const r = rig();
    r.drag(80, SP_R0);
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

  // WAVE 2 TASK 7 (s2qa2-07) — THE BURST, end to end and at the driver. This is the sequence the finding
  // measured: the drag crosses a shrink, keeps going, and lands back where it started. Every narrowing-gated
  // path declines — the last leg is a GROW, and the probe's own sample was measured at 90 and is abandoned by
  // the `:191` size guard the moment the terminal moves off it — while the residue the 90 leg left is still on
  // screen and, before this task, stayed there for the life of the session.
  // The frames Ink paints DURING the drag. Only two of them matter to the arithmetic: the one on screen when the
  // burst narrowed (that is `SP_R0`, the rig's starting frame — the 90 leg's SIGWINCH arrives before Ink has
  // repainted) and the one on screen when it settles.
  const F90 = ["m".repeat(100), "n"].join("\n") + "\n";
  const F150 = ["m".repeat(140), "n"].join("\n") + "\n";
  const F120 = ["m".repeat(110), "n"].join("\n") + "\n";
  const F100 = ["m".repeat(90), "n"].join("\n") + "\n";

  it("repairs a round-trip burst once, after the settle window, off the size it settled at", async () => {
    const r = rig();
    r.drag(90, F90); r.drag(150, F150); r.drag(120, F120);
    await flush();
    expect(r.probes).toEqual([{ colBefore: 117, oldWidth: 120, newWidth: 90 }]);   // one probe for the one shrink
    expect(r.repainted).toEqual([]);                                    // …and its emission abandoned: 120 ≠ 90
    expect(r.settleWindow()).toBe(1);                                   // THE DEBOUNCE: three signals, one window
    expect(r.repainted.length).toBe(1);
    expect(r.repainted[0]).toBe(correctionAtSettle({ frame: F120, frameAtNarrowest: SP_R0, parkedCol: 117, width: 120, narrowest: 90, rows: 40 }, "reflow"));
    expect(r.repainted[0]?.endsWith(F120)).toBe(true);                  // the live frame goes straight back
    expect(r.verdictAtRepaint).toEqual([undefined]);                    // …and carries its own erase past the corrector
  });

  // The repair needs the verdict this module never guesses, and in a burst the probe is still in flight when the
  // drag stops (750 ms against an 80 ms window). So the settle pass waits for the answer rather than declining on
  // it — and it re-measures when it runs, because that is the whole difference from the sample it replaces.
  it("waits for the in-flight verdict and repairs when it lands", async () => {
    const r = rig({ verdicts: [] });
    r.drag(90, F90); r.drag(150, F150); r.drag(120, F120);
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted).toEqual([]);                                    // nothing to correct WITH, yet
    r.settle("reflow");
    await flush();
    expect(r.repainted.length).toBe(1);
    expect(r.repainted[0]?.endsWith(F120)).toBe(true);
  });

  // …and it is one repair or the other, never both. Two erase-plus-frame writes in a row each move the frame up
  // by their own residue, so the second one's erase lands on rows the first one just declared live.
  //   ON A DRAG THAT WALKED BACK, THAT ONE IS `correctionAtSettle`'S DIFFERENCE AND NEVER THE SUMMED COUNT
  // (qa2-09). Rows are counted at the width they were painted at, and a burst that returns to a wider width
  // MERGES them — 70's rows are fewer rows at 90 — so a sum taken across the excursion over-claims. Here the
  // difference is zero (F90 wraps the same at 70 and at 90), so the honest answer is to leave the rows: an
  // under-erase, which is the side this file is wrong on. The direct path stands down on the same test.
  it("claims nothing but the re-wrap difference when the burst walks back off its narrowing", async () => {
    const r = rig({ verdicts: [] });
    r.drag(90, F90); r.drag(70, SP_R0); r.drag(90, F90);
    expect(r.settleWindow()).toBe(1);
    r.settle("reflow");
    await flush();
    expect(r.repainted).toEqual([]);
  });

  // FIX ROUND 1, FINDING 2, AT THE DRIVER — the reviewer's reproduction. The 90 leg happened while a one-row
  // composer was on screen and stranded NOTHING; by the time the drag settled a streaming turn had grown the
  // live frame to twenty rows. Measuring the remembered WIDTH against the LIVE frame claimed 31 rows over 21
  // occupied and 0 owed — ten live viewport rows blanked, which is the direction `resizeRepaint.ts:6-9` forbids.
  it("claims nothing when the frame that was on screen at the narrowing stranded nothing", async () => {
    const short = "composer\n";
    // 200 cells per line DELIBERATELY: it wraps 3× at 90 and 2× at 120, so the live frame is 31 rows against the
    // 21 it occupies now — the reviewer's own numbers. A 150-cell line wraps twice at BOTH widths, which zeroes
    // the residue term under the buggy formula too and leaves this case unable to fail (fix round 2, finding 1).
    const streamed = [...Array(10).fill("z".repeat(200)), "tail"].join("\n") + "\n";
    const r = rig({ frame: short });
    r.drag(90, short); r.drag(150, short); r.drag(120, streamed);
    await flush();
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted).toEqual([]);
  });

  // …AND THE SETTLE PASS DIES WITH THE SCREEN IT MEASURED, ON BOTH OF ITS BRANCHES (qa2-09 review, blocker 1).
  // The ORDERING is the whole case: a <Static> commit BEFORE the verdict is already refused (`strandedNow()`
  // reads 0 and the burst ends there), but a commit AFTER it and before the window fires used to reach
  // `correctionAtSettle`, which never consulted the detach count at all. That branch's erase is
  // `residue + occupiedRows(liveFrame)`, i.e. `residue` rows ABOVE the live frame unconditionally — and the
  // commit has just pushed committed transcript into exactly those rows. Measured on the unguarded build:
  // `eraseRows(4) + F120` where the live frame and its park own 3. The ordering is the normal one, not the rare
  // one: the probe answers in about 12 ms against an 80 ms window.
  it("claims nothing at settle when a <Static> commit lands after the verdict", async () => {
    const r = rig({ verdicts: [] });
    r.drag(90, F90); r.drag(150, F150); r.drag(120, F120);
    r.settle("reflow");
    await flush();
    expect(r.repainted).toEqual([]);                                    // the direct path stands down: 120 ≠ 90
    r.detach();                                                         // …and the commit lands inside the window
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted).toEqual([]);
    // …and the SAME sequence without the commit still repairs, so what declines above is the guard and not a
    // burst that had already died of something else.
    const c = rig({ verdicts: [] });
    c.drag(90, F90); c.drag(150, F150); c.drag(120, F120);
    c.settle("reflow");
    await flush();
    expect(c.settleWindow()).toBe(1);
    expect(c.repainted.length).toBe(1);
    expect(c.repainted[0]?.endsWith(F120)).toBe(true);
  });

  // A plain shrink is not a burst: it settles at its own narrowest, so there is nothing above the frame that the
  // frame does not already cover, and the async first-shrink repair (or the write-time corrector after it) owns
  // the leg. The settle pass must add nothing — a second erase here is the over-erase the wave exists to prevent.
  it("adds nothing to a plain shrink the existing repair already handled", async () => {
    const r = rig();
    r.drag(80, SP_R0);
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted.length).toBe(1);
  });

  // A burst that only ever grew has no residue to chase: Ink erases the previous frame's LOGICAL line count,
  // which at a wider terminal is at least the rows it occupies, so a grow over-erases upward if anything. The
  // settle pass keys on a narrowing having HAPPENED, not on the widths comparing a particular way — otherwise
  // 120 → 160 → 200 reads as "narrower earlier than it is now" and erases live transcript.
  it("never repairs a burst that only grew", () => {
    const r = rig();
    r.resize(160); r.resize(200);
    expect(r.settleWindow()).toBe(1);
    expect(r.probes).toEqual([]);
    expect(r.repainted).toEqual([]);
  });

  // The window is TRAILING: a signal inside it restarts it rather than stacking a second one, so however many
  // SIGWINCHes a drag emits there is exactly one pass, against the size the drag actually stopped at.
  it("restarts the window on every signal, so a continuing drag never settles mid-flight", () => {
    const r = rig({ verdicts: [] });
    for (const to of [90, 150, 120, 130]) { r.resize(to); expect(r.timers.size, String(to)).toBe(1); }
    expect(r.settleWindow()).toBe(1);
    expect(r.settleWindow()).toBe(0);                                   // …and the burst is over, not standing
  });

  // The window is the one thing in this module that outlives the signal that armed it, and firing it WRITES.
  // `runChatClient`'s `finally` drops it beside the resize listener, before it unparks the cursor and hands the
  // terminal back to the shell.
  it("drops a pending window on stop, so a drag at exit never repaints into the shell", () => {
    const r = rig({ verdicts: [] });
    r.resize(90); r.resize(120);
    expect(r.timers.size).toBe(1);
    r.driver.stop();
    expect(r.timers.size).toBe(0);
    expect(r.repainted).toEqual([]);
  });

  // THE OTHER HALF OF THE SAFETY ARGUMENT, and the reason the pass claims only what went out UNMEASURED. Once a
  // verdict is cached every frame write Ink makes is corrected synchronously against its own live width, so a
  // burst on a measured terminal leaves nothing above the frame — and a settle pass that claimed it anyway would
  // be a second erase over rows the write-time corrector already declared live.
  it("claims nothing from a burst on a terminal that has already been measured", async () => {
    const r = rig();
    r.drag(80, SP_R0);                                                  // the session's first shrink: measured here
    await vi.waitFor(() => expect(r.driver.verdict()).toBe("reflow"));
    r.settleWindow();
    const before = r.repainted.length;
    r.resize(60); r.resize(100); r.resize(80);                          // …and now a burst, all of it corrected at the writes
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted.length).toBe(before);
  });

  // The same rule seen from the race it exists for: the probe answers WHILE the drag is still running, so the
  // first shrink's own repair fires and cleans the screen. The burst must forget the leg that repair just
  // claimed, or the settle pass erases those rows a second time 80 ms later.
  it("forgets a leg the first-shrink repair already cleaned", async () => {
    const r = rig();
    r.drag(90, F90);
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));         // repaired at 90, mid-drag
    r.resize(150); r.resize(120);                                       // …and the drag carries on and lands back
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted.length).toBe(1);
  });

  // FIX ROUND 1, FINDING 3 — THE THIRD BRANCH OF THE SAME HAZARD, and the one the shipped guard missed: the
  // verdict lands mid-burst and the first-shrink repair DECLINES (its sample was measured at a width the drag
  // has already left). A SIGWINCH does not imply an Ink write — `throttledLog` can defer one to its trailing
  // timer — so a leg whose write has not landed yet has stranded NOTHING yet, and the write when it does land
  // carries `frameWriteCorrection` against the frame this leg remembers. Claiming the leg here as well is that
  // erase run twice, over rows the write-time corrector has already declared live.
  //   The test for "has a write landed" is the recorded frame's own identity: the proxy records one per frame
  // write, so a `lastFrame()` still equal to the frame remembered at the narrowing means nothing has under-
  // erased since. That is also why the burst cases above `drag` instead of `resize`.
  it("forgets a leg no write has under-erased yet, because the corrector now owns that write", async () => {
    const r = rig();
    r.resize(90);                                                       // SIGWINCH; Ink's write is deferred
    r.resize(120);                                                      // …and the drag walks back off it
    await flush();
    expect(r.driver.verdict()).toBe("reflow");                          // the probe answered mid-burst…
    expect(r.repainted).toEqual([]);                                    // …and its own emission was abandoned
    r.repaintedAs(F120);                                                // Ink's deferred write lands, corrected AT the write
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted).toEqual([]);                                    // so the pass must not claim it a second time
  });

  // FIX ROUND 2 — THE SUB-CASE THAT SURVIVED THAT GUARD: TWO NARROWINGS STRADDLING THE VERDICT. The first leg's
  // write DID land uncorrected, so the burst is rightly retained and real residue sits above the frame. Then the
  // drag narrows again on a terminal that is now measured — and that leg's write is corrected at the write, where
  // `frameWriteCorrection` erases `occupiedRows(prevFrame, newWidth) - inkErases` rows, reaching above the frame
  // it replaces by exactly the amount that lands inside the retained residue. The settle pass would then claim
  // those rows a second time, which is the over-erase direction. So a narrowing with a verdict in hand ends the
  // burst outright: from here every leg is corrected at its own write.
  it("forgets the burst when the drag narrows again after the verdict cached", async () => {
    const r = rig();
    r.drag(90, F90);                                                    // narrowed while unmeasured: remembered…
    r.drag(120, F120);                                                  // …and the write landed, so the leg is retained
    await flush();
    expect(r.driver.verdict()).toBe("reflow");                          // measured mid-burst; its own emission abandoned
    expect(r.repainted).toEqual([]);
    r.drag(100, F100);                                                  // …and now a SECOND narrowing, corrected at its write
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted).toEqual([]);
  });

  // EXTERNAL REVIEW (codex, finding B) — THE BURST THAT STOPS AT ITS OWN DEEPEST SHRINK. 120 → 100 → 80 is a
  // monotonic drag, so the width it settles at IS `narrowest`, and every path declined: the settle pass read
  // `narrowest < width` as "nothing above the frame" and ended the burst, and the probe's own sample was
  // measured at 100 and abandoned by the `:191` size guard. Both legs went out unmeasured (the verdict is still
  // in flight for the whole drag) and their residue was permanent.
  //   The screen at settle is the FIRST SHRINK'S SCREEN, arriving late: nothing has re-wrapped since the leg
  // that stranded the rows, so the measurement is `correctionAfterRepaint`'s exactly — the remembered frame's
  // region at the width it is still on, less Ink's erase — and not the re-wrap difference `correctionAtSettle`
  // takes when the drag walked back to a wider width.
  const F80 = ["m".repeat(70), "n"].join("\n") + "\n";
  it("repairs a monotonic burst that settles at its own narrowest, once the verdict lands", async () => {
    const r = rig({ verdicts: [] });
    r.drag(100, F100); r.drag(80, F80);                                 // two legs, one probe, no verdict yet
    expect(r.probes).toEqual([{ colBefore: 117, oldWidth: 120, newWidth: 100 }]);
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted).toEqual([]);                                    // nothing to correct WITH, yet — the pass waits
    r.settle("reflow");
    await flush();
    expect(r.repainted.length).toBe(1);
    // BOTH legs' writes, each counted where it happened: the 120 → 100 leg left SP_R0's 9 rows at 100 plus its
    // padded park's 2 against Ink's 7, and the 100 → 80 leg left F100's 3 rows plus its park's 2 against Ink's
    // 3 — 2 + 2 — written back with the frame that is there now. The old form claimed the deepest leg only.
    expect(r.repainted[0]).toBe(correctionAfterRepaint({ oldWidth: 100, newWidth: 80, rows: 40 }, "reflow", F80, parkColumn(80), 4));
    expect(r.repainted[0]?.endsWith(F80)).toBe(true);
    expect(r.verdictAtRepaint).toEqual([undefined]);                    // …and it carries its own erase past the corrector
  });

  // …and ONCE. The probe's own continuation would emit for the 100 leg too if the settle pass had not already
  // claimed the region: two erase-plus-frame writes in a row each move the frame up by their own residue.
  it("emits exactly once for a monotonic burst whose probe answers before the window", async () => {
    const r = rig();                                                    // the verdict resolves on the first flush
    r.drag(100, F100); r.drag(80, F80);
    await flush();
    expect(r.repainted).toEqual([]);                                    // the sample was measured at 100; the screen is 80
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted.length).toBe(1);
    expect(r.repainted[0]?.endsWith(F80)).toBe(true);
  });

  // THE REFUSAL THAT SURVIVES THE FIX. A monotonic burst on a terminal that has ALREADY been measured is
  // corrected at each of its writes, so the pass must still claim nothing — `onResize` ends the burst on any
  // narrowing once a verdict is cached, and reaching the settle-at-narrowest branch with a live burst is what
  // that rule prevents.
  it("still claims nothing from a monotonic burst on a measured terminal", async () => {
    const r = rig();
    r.drag(90, F90);
    await vi.waitFor(() => expect(r.driver.verdict()).toBe("reflow"));
    r.settleWindow();
    const before = r.repainted.length;
    r.drag(80, F80); r.drag(70, F80);
    expect(r.settleWindow()).toBe(1);
    expect(r.repainted.length).toBe(before);
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
    out.stdout.write("\x1b[2J\x1b[3J\x1b[H" + "scrollback\n" + "one\ntwo\n");   // ink.js:118-122, one chunk
    expect(out.parkedColumn()).toBe(0);
    // …and NOTHING is written after it. W-R t8 rewrites the chunk itself — the `\x1b[3J` in `clearTerminal` comes
    // out, because it erases the scrollback this app's committed transcript lives in and nothing Ink does needs it
    // (`\x1b[2J` already blanks the screen it is about to paint on). Every other byte passes through as written.
    expect(chunks).toEqual(["\x1b[2J\x1b[H" + "scrollback\n" + "one\ntwo\n"]);
    // The chunk is still not adopted as a frame — and from t8 the frame it displaced is not retained either: it is
    // no longer on screen, so `lastFrame()` claiming it feeds task 4b's corrector a region measured off nothing.
    expect(out.lastFrame()).toBeUndefined();
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

// QA2-09 — THE STRANDED SPINNER ROW, AT THE ONE SEAM IT LIVES IN: the proxy and the driver wired together
// exactly as `runChatClient` wires them, driven with the byte sequence a live 120 → 80 shrink produces. Every
// frame and count below is transcribed from a traced run of the shipped binary under tmux (an early mid-turn
// shrink, spinner live), because the whole defect is a write nobody modelled: Ink's SIGWINCH repaint paints the
// OLD React tree into the new width, so its content still carries the old layout, and the write after it — the
// caught-up layout, 6 ms later — under-erases that frame by its over-run and strands its top row. On a live
// turn that row is the spinner, frozen at the second it was painted, and the a3 matrix cell counts two of them.
describe("the writes between a first shrink and its verdict", () => {
  const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
  const RULE = (n: number): string => "─".repeat(n);
  const HINT = "◉ xhigh · /effort";
  // Six logical lines at 120: the spinner row, a right-aligned hint, the composer between two full-width rules,
  // and the footer. At 80 the hint and both rules re-wrap, so it owns 9 rows there plus the padded park's 2 —
  // 11 against the 7 Ink erases, which is the 4 the traced run reported.
  const AT120 = ["✶ Frosting…", " ".repeat(103) + HINT, RULE(120), "❯", RULE(120), "  ⏸ manual mode on"].join("\n") + "\n";
  // Ink's own resize repaint: laid out into 80, but the hint is still the 120-column one, so ONE line over-runs
  // and the frame owns 7 rows plus its park where Ink's `previousLineCount` says 7. One row, every time.
  const STALE80 = ["✶ Frosting…", " ".repeat(103) + HINT, RULE(80), "❯", RULE(80), "  ⏸ manual mode on"].join("\n") + "\n";
  // …and the caught-up layout, which owns exactly what Ink erases.
  const AT80 = ["✻ Frosting…", " ".repeat(63) + HINT, RULE(80), "❯", RULE(80), "  ⏸ manual mode on"].join("\n") + "\n";

  const rig = () => {
    const chunks: string[] = [];
    const terminal = { isTTY: true, columns: 120, rows: 40, write: (c: string) => { chunks.push(c); return true; } };
    const out = createResumeSafeStdout(terminal as never);
    let answer: ((v: ReflowVerdict) => void) | undefined;
    const driver = createResizeRepaint({
      lastFrame: out.lastFrame, parkedColumn: out.parkedColumn,
      size: () => ({ columns: terminal.columns, rows: terminal.rows }),
      repaint: (s) => { out.stdout.write(s); },
      probe: () => new Promise((r) => { answer = r; }),
      setTimeout: () => 0, clearTimeout: () => {},          // the settle window is not what these cases are about
      detached: out.detachedWrites,
    });
    out.setFrameCorrector(driver.frameWrite);
    return { chunks, terminal, out, driver, answers: (v: ReflowVerdict) => answer?.(v) };
  };
  /** The repair, which is the only write that carries an erase run longer than Ink's own. */
  const repair = (chunks: string[]): string | undefined => chunks.find((c) => c.startsWith("\x1b[2K") && c.endsWith("\n"));

  it("counts the rows EVERY uncorrected write left, not the rows the drag predicted one write would leave", async () => {
    const r = rig();
    r.out.stdout.write(AT120);                                  // first frame of the session: no prefix, parks at 117
    expect(physicalRows(AT120, 80)).toBe(9);
    r.terminal.columns = 80;
    r.driver.onResize();                                        // SIGWINCH, ahead of Ink's own listener
    r.out.stdout.write(inkEraseLines(7) + STALE80);             // ink.js:83 `resized()`, synchronous, old layout
    expect(occupiedRows(STALE80, 77, 80) - 7).toBe(1);          // …and it owns one row more than it will erase
    r.out.stdout.write(inkEraseLines(7) + AT80);                // React catches up; STALE80's top row is stranded
    r.chunks.length = 0;
    r.answers("reflow");
    await flush();
    const seq = repair(r.chunks);
    // 4 rows from the re-wrap of AT120 + 1 from STALE80's over-run + the live frame's 6 + its park row.
    expect(seq && rowsCleared(seq)).toBe(4 + 1 + 6 + 1);
    expect(seq?.endsWith(AT80)).toBe(true);                     // …and the live frame goes straight back
  });

  // THE SAME OVER-RUN ON AN ALREADY-MEASURED TERMINAL, which is the half no after-the-fact repair can reach: a
  // second mid-turn shrink runs entirely through the write-time corrector. Traced on the shipped binary at
  // 120 → 100 → 80, the second shrink added a third spinner row to the two the first one left.
  it("corrects the same over-run at the write once the terminal has been measured", async () => {
    const r = rig();
    r.out.stdout.write(AT120);
    r.terminal.columns = 80;
    r.driver.onResize();
    r.out.stdout.write(inkEraseLines(7) + STALE80);
    r.answers("reflow");
    await flush();
    expect(r.driver.verdict()).toBe("reflow");
    r.chunks.length = 0;
    r.out.stdout.write(inkEraseLines(7) + AT80);                // the write that used to strand STALE80's top row
    expect(r.chunks[0]).toBe(inkEraseLines(7) + inkEraseLines(2) + AT80);   // 8 owed - 7 erased + the shared row
  });

  // AND THE CLAIM DIES WHEN THE SCREEN MOVES UNDER IT. An erase-only write is `log.clear()`, the head of every
  // <Static> commit: committed transcript goes in between the stranded rows and the frame, so a count of rows
  // ABOVE the frame no longer says where they are, and erasing that many would eat the transcript instead.
  it("claims nothing when a <Static> commit has re-laid the screen since the rows were counted", async () => {
    const r = rig();
    r.out.stdout.write(AT120);
    r.terminal.columns = 80;
    r.driver.onResize();
    r.out.stdout.write(inkEraseLines(7) + STALE80);
    r.out.stdout.write(inkEraseLines(7));                       // log.clear()…
    r.out.stdout.write("⏺ committed prose\n");                  // …the <Static> chunk…
    r.out.stdout.write(AT80);                                   // …and the frame under it, with no prefix at all
    expect(r.out.lastFrame()).toBe(AT80);                       // a frame IS recorded, so this is not lastFrame's refusal
    r.chunks.length = 0;
    r.answers("reflow");
    await flush();
    expect(repair(r.chunks)).toBeUndefined();
  });

  // …AND THE OTHER HALF OF THE SAME COUNT: Ink's TALL-FRAME branch, which `\x1b[2J`-blanks the screen and
  // replays `fullStaticOutput` over it (`ink.js`'s `clearTerminal` + static replay + the frame). Nothing above
  // the live frame is where it was counted — the rows were not pushed down, they were wiped and re-laid — so
  // the count is just as dead as it is after a <Static> commit, and this is the branch nothing pinned (review
  // of 37da19c052, blocker 2: dropping `detached += 1` from the `\x1b[2J` arm of `record` left the whole seam
  // green). Unguarded, the repair emits an 11-row erase over a screen the replay had already repainted.
  it("claims nothing when Ink's tall-frame clear has blanked and replayed the screen", async () => {
    const r = rig();
    r.out.stdout.write(AT120);
    r.terminal.columns = 80;
    r.driver.onResize();
    r.out.stdout.write(inkEraseLines(7) + STALE80);             // the uncorrected resize repaint, stranding 4 + 1
    r.out.stdout.write("\x1b[2J\x1b[3J\x1b[H");                 // Ink's tall branch: clearTerminal…
    r.out.stdout.write("⏺ the whole transcript, replayed\n");   // …fullStaticOutput…
    r.out.stdout.write(AT80);                                   // …and the frame, which re-records lastFrame()
    expect(r.out.lastFrame()).toBe(AT80);                       // …so again this is not lastFrame's refusal
    r.chunks.length = 0;
    r.answers("reflow");
    await flush();
    expect(repair(r.chunks)).toBeUndefined();
  });
});
