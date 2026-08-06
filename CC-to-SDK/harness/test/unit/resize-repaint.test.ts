// test/unit/resize-repaint.test.ts — Wave R task 4: the correction itself. Every case here is about ONE
// asymmetry: an under-erase leaves today's cosmetic residue, an over-erase eats live transcript rows. So the
// emitting cases pin exact byte counts and the refusing cases (grow, "truncate", "unknown", no recorded frame)
// pin the empty string.
import { describe, expect, it, vi } from "vitest";
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";
import { correctionAfterRepaint, correctionBeforeRepaint, createForceRepaint, createResizeRepaint, eraseRows,
  inkErases, occupiedRows, parkColumn, parkSequence, physicalRows, type ResizeSample } from "../../src/tui/resizeRepaint.js";
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

describe("correctionBeforeRepaint — emitted from the resize listener, ahead of Ink's own repaint", () => {
  // Ink is about to erase `inkErases(frame)` rows itself and repaint from there. We erase the rows ABOVE that,
  // plus the one row eraseLines leaves the cursor sitting on, so the two runs meet exactly and cover the region.
  it("erases what Ink's logical-line count will miss on a reflowing shrink", () => {
    const seq = correctionBeforeRepaint(sample(), "reflow");
    expect(seq).toBe(inkEraseLines(5));                                  // 11 - 7 + 1
    expect(rowsCleared(seq) + inkErases(SP_R0) - 1).toBe(11);            // …and together they cover the region
  });

  it("counts the padded cursor row's re-wrap into the region", () => {
    expect(correctionBeforeRepaint(sample({ parkedCol: 117 }), "reflow")).toBe(inkEraseLines(13 - 7 + 1));
  });

  it("emits nothing on a grow, a height-only resize, or a frame that did not re-wrap", () => {
    expect(correctionBeforeRepaint(sample({ oldWidth: 40, newWidth: 120 }), "reflow")).toBe("");
    expect(correctionBeforeRepaint(sample({ oldWidth: 120, newWidth: 120 }), "reflow")).toBe("");
    expect(correctionBeforeRepaint(sample({ frame: "one\ntwo\n", newWidth: 80 }), "reflow")).toBe("");
  });

  // The asymmetry rule: only a MEASURED "reflow" corrects. "unknown" is a terminal we could not measure, and it
  // must behave exactly like "truncate" — a wrong "truncate" costs a cosmetic row, a wrong "reflow" costs data.
  it("emits nothing for truncate and unknown", () => {
    for (const verdict of ["truncate", "unknown"] as ReflowVerdict[])
      expect(correctionBeforeRepaint(sample(), verdict), verdict).toBe("");
  });

  it("caps the region at the rows on screen", () => {
    expect(correctionBeforeRepaint(sample({ rows: 9 }), "reflow")).toBe(inkEraseLines(9 - 7 + 1));
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

describe("createForceRepaint — a render Ink's own dedupe cannot swallow (shared with task 7)", () => {
  it("writes the recorded frame back, optionally behind a prefix", () => {
    const written: string[] = [];
    const force = createForceRepaint({ lastFrame: () => "frame\n", write: (s) => { written.push(s); } });
    expect(force()).toBe(true);
    expect(force("\x1b[2J\x1b[3J\x1b[H")).toBe(true);
    expect(written).toEqual(["frame\n", "\x1b[2J\x1b[3J\x1b[H" + "frame\n"]);
  });

  it("still emits the prefix, and reports failure, when nothing is recorded", () => {
    const written: string[] = [];
    const force = createForceRepaint({ lastFrame: () => undefined, write: (s) => { written.push(s); } });
    expect(force("\x1b[2J")).toBe(false);
    expect(written).toEqual(["\x1b[2J"]);
  });
});

describe("createResizeRepaint — the driver", () => {
  const rig = (opts: { frame?: string | undefined; verdicts?: ReflowVerdict[] } = {}) => {
    let columns = 120, parked = 117;
    const emitted: string[] = [], repainted: string[] = [], probes: Array<{ colBefore: number; oldWidth: number; newWidth: number }> = [];
    const verdicts = [...(opts.verdicts ?? ["reflow"])];
    let resolve: ((v: ReflowVerdict) => void) | undefined;
    const driver = createResizeRepaint({
      lastFrame: () => ("frame" in opts ? opts.frame : SP_R0),
      parkedColumn: () => parked,
      size: () => ({ columns, rows: 40 }),
      emit: (s) => { emitted.push(s); },
      repaint: (s) => { repainted.push(s); },
      probe: (a) => { probes.push(a); const next = verdicts.shift(); return next ? Promise.resolve(next) : new Promise((r) => { resolve = r; }); },
    });
    return { driver, emitted, repainted, probes, resize: (to: number) => { columns = to; driver.onResize(); parked = parkColumn(to); }, settle: (v: ReflowVerdict) => resolve?.(v) };
  };

  it("probes on the first shrink and corrects asynchronously when the answer is reflow", async () => {
    const r = rig();
    r.resize(80);
    expect(r.probes).toEqual([{ colBefore: 117, oldWidth: 120, newWidth: 80 }]);
    expect(r.emitted).toEqual([]);                                        // nothing synchronous: the verdict is not in yet
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    expect(r.repainted[0]?.endsWith(SP_R0)).toBe(true);                   // erase, then the frame straight back
  });

  it("reuses the cached verdict on the next shrink and corrects synchronously", async () => {
    const r = rig();
    r.resize(80);
    await vi.waitFor(() => expect(r.repainted.length).toBe(1));
    r.resize(60);
    expect(r.probes.length).toBe(1);                                      // the verdict is a property of the TERMINAL
    expect(r.emitted.length).toBe(1);                                     // …and this one lands ahead of Ink's repaint
    expect(r.emitted[0]).toBe(correctionBeforeRepaint({ frame: SP_R0, parkedCol: 77, oldWidth: 80, newWidth: 60, rows: 40 }, "reflow"));
  });

  it("caches truncate too, and never corrects again", async () => {
    const r = rig({ verdicts: ["truncate"] });
    r.resize(80);
    await vi.waitFor(() => expect(r.probes.length).toBe(1));
    r.resize(60);
    expect(r.probes.length).toBe(1);
    expect(r.emitted).toEqual([]);
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

  it("never probes or corrects on a grow, a height-only resize, or with no recorded frame", () => {
    const grow = rig(); grow.resize(160);
    const flat = rig(); flat.resize(120);
    const bare = rig({ frame: undefined }); bare.resize(80);
    for (const r of [grow, flat, bare]) { expect(r.probes).toEqual([]); expect(r.emitted).toEqual([]); expect(r.repainted).toEqual([]); }
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
