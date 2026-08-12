// test/unit/resume-safe-stdout.test.ts — Wave R task 2: the stdout proxy is the ONE place every byte Ink emits
// passes through code we own, so it is where we learn what is currently painted and how tall it really is.
// Task 4 erases on resize from exactly these two answers, so both are pinned here rather than inferred later.
import { describe, expect, it } from "vitest";
import { createResizeChain, createResumeSafeStdout, physicalRows } from "../../src/tui/chatMain.js";
import { eraseViewport } from "../../src/tui/clearViewport.js";
import { parkColumn } from "../../src/tui/resizeRepaint.js";

// Ink's erase prefix, byte-for-byte: ansiEscapes.eraseLines(n) === "\x1b[2K" + ("\x1b[1A\x1b[2K" * (n-1)) + "\x1b[G".
// eraseLines(0) is the EMPTY string, which is why a first frame (and any frame right after log.clear()) arrives bare.
const eraseLines = (n: number): string => (n === 0 ? "" : "\x1b[2K" + "\x1b[1A\x1b[2K".repeat(n - 1) + "\x1b[G");

// `columns` stays undefined unless a case needs the park: `parkColumn(undefined)` is 0, so the proxy emits no
// padding write and the byte-for-byte `terminal.chunks` assertions below stay about Ink's own bytes.
class RecordingTerminal {
  isTTY = true;
  readonly chunks: string[] = [];
  constructor(readonly columns?: number, readonly rows?: number) {}
  write(chunk: string): boolean { this.chunks.push(chunk); return true; }
}

const proxy = (columns?: number, rows?: number) => { const terminal = new RecordingTerminal(columns, rows); return { terminal, out: createResumeSafeStdout(terminal as any) }; };

describe("ResumeSafeStdout.lastFrame", () => {
  it("has no frame before Ink has written one", () => {
    expect(proxy().out.lastFrame()).toBeUndefined();
  });

  // Kind 1 — a frame write. Ink's log() writes eraseLines(previousLineCount) + str + "\n"; the erase prefix is
  // terminal bookkeeping, not frame content, so it is stripped before recording. The trailing "\n" IS kept:
  // physicalRows drops it, and task 4 wants the recorded bytes to be what Ink actually emitted.
  it("records a frame write with Ink's erase prefix stripped", () => {
    const { terminal, out } = proxy();
    out.stdout.write(eraseLines(3) + "one\ntwo\n");
    expect(out.lastFrame()).toBe("one\ntwo\n");
    expect(terminal.chunks.join("")).toBe(eraseLines(3) + "one\ntwo\n");   // and the bytes still reach the terminal
  });

  // The very first frame of a session carries eraseLines(0) === "", i.e. no prefix at all.
  it("records an unprefixed first frame", () => {
    const { out } = proxy();
    out.stdout.write("first frame\n");
    expect(out.lastFrame()).toBe("first frame\n");
  });

  it("keeps only the most recent frame", () => {
    const { out } = proxy();
    out.stdout.write(eraseLines(2) + "older\n");
    out.stdout.write(eraseLines(2) + "newer\n");
    expect(out.lastFrame()).toBe("newer\n");
  });

  // Kind 2 — Instance.clear() → log.clear() writes the erase run and NOTHING else. Those rows are GONE from the
  // screen, so the frame we recorded is no longer painted anywhere and must stop being reported as painted. In the
  // clear→static→frame burst the very next frame write re-records it a moment later; on the app.clear() path no
  // frame follows, and lastFrame() staying undefined is what makes task 4 erase NOTHING instead of erasing a stale
  // (and possibly much taller) frame's worth of live transcript.
  it("drops the recorded frame on an erase-only write", () => {
    const { out } = proxy();
    out.stdout.write(eraseLines(2) + "live frame\n");
    out.stdout.write(eraseLines(3));
    expect(out.lastFrame()).toBeUndefined();
  });

  // Kind 3 — the <Static> path. ink.js onRender does log.clear() → write(staticOutput) → log(output): the static
  // write is committed scrollback, and because log.clear() reset previousLineCount it arrives bare, exactly like a
  // frame. It is identified by the erase-only write it follows. The real frame lands right after it and IS recorded.
  it("skips the static write in Ink's clear→static→frame burst and records the frame that follows", () => {
    const { out } = proxy();
    out.stdout.write(eraseLines(2) + "old frame\n");
    out.stdout.write(eraseLines(2));                     // log.clear()
    out.stdout.write("committed transcript row\n");      // staticOutput — scrollback, not the live frame
    expect(out.lastFrame()).toBeUndefined();             // mid-burst the old frame is off-screen, so it is not reported
    out.stdout.write("new frame\n");                     // log(output), bare because clear() zeroed the count
    expect(out.lastFrame()).toBe("new frame\n");         // …and the burst still ENDS with the frame recorded
  });

  // …and the SAME burst with an EMPTY clear, which is the shape ccx actually launches in. When previousLineCount
  // is 0 — first paint, or right after app.clear() — log.clear() writes eraseLines(0) === "", so the "erase" is a
  // zero-length write. That empty write setting the flag is the ONLY thing that tells the bootstrapped <Static>
  // transcript apart from the frame; miss it and the whole session's scrollback is adopted as the frame and task
  // 4's erase eats the live transcript. Pinned with a static write far taller than the frame so the failure would
  // show up in physicalRows, not just in identity.
  it("skips the static write when log.clear() is a ZERO-LENGTH erase", () => {
    const { out } = proxy();
    const bootstrapped = Array.from({ length: 40 }, (_, i) => `bootstrapped transcript row ${i}`).join("\n") + "\n";
    out.stdout.write(eraseLines(0));                     // log.clear() with previousLineCount === 0 → ""
    out.stdout.write(bootstrapped);                      // staticOutput — the entire replayed transcript
    expect(out.lastFrame()).toBeUndefined();
    out.stdout.write("frame\n");                         // log(output)
    expect(out.lastFrame()).toBe("frame\n");
    expect(physicalRows(out.lastFrame()!, 80)).toBe(1);  // …one row, NOT 40-odd
  });

  // …and the burst that BREAKS the triple, which is the whole of task 7 (W-R t7). The erase→static→frame triple
  // is emitted inside one synchronous onRender and nothing can interleave with it — but `/clear` deliberately
  // writes BETWEEN a log.clear() and the frame: `app.clear()` (replaceDocument's Static seam) erases the live
  // frame, then Ink's own writeToStdout (ink.js:140-155) runs log.clear() → write(data) → log(this.lastOutput),
  // and `data` is the viewport wipe, which is NOT a frame (no trailing newline, and it opens on ESC[H rather than
  // an erase run). If that foreign write left the erase latch UP, the forced frame right behind it would be read
  // as <Static> scrollback: not recorded, and the cursor left unparked until the next keystroke — exactly when
  // the reflow oracle needs the park most. So the latch falls with the foreign write, and the frame is recorded.
  it("records the frame in Ink's clear→foreign→frame burst (writeToStdout) and parks the cursor on it", () => {
    const { out } = proxy(80, 24);
    out.stdout.write("live frame\n");                    // the frame /clear is about to wipe
    out.stdout.write(eraseLines(2));                     // app.clear() → log.clear()
    out.stdout.write(eraseLines(0));                     // writeToStdout's log.clear(), previousLineCount now 0
    out.stdout.write(eraseViewport(24));                 // write(data) — ESC[H-prefixed, no trailing newline
    expect(out.lastFrame()).toBeUndefined();             // mid-burst nothing is painted, and we do not claim it is
    out.stdout.write("composer frame\n");                // log(this.lastOutput) — bare, the dedupe cannot skip it
    expect(out.lastFrame()).toBe("composer frame\n");
    expect(out.parkedColumn()).toBe(parkColumn(80));     // …and > 0: the park is back on the new frame's cursor row
  });

  // Kind 4 — repaint() suppresses Ink's stale post-resume clear. A suppressed write never reaches the terminal, so
  // it never painted anything and must not be mistaken for the live frame.
  it("ignores a suppressed write entirely", () => {
    const { terminal, out } = proxy();
    out.stdout.write(eraseLines(2) + "live frame\n");
    out.repaint(() => { out.stdout.write(eraseLines(9) + "stale resume frame\n"); });
    expect(out.lastFrame()).toBe("live frame\n");
    expect(terminal.chunks.join("")).toBe(eraseLines(2) + "live frame\n");
  });

  // Kind 5 — Ink's TALL-FRAME path (ink.js:118-122): when outputHeight >= stdout.rows it writes ONE chunk of
  // clearTerminal + fullStaticOutput + output, i.e. the whole accumulated scrollback of the session followed by
  // the frame. Nothing in the bytes marks where the scrollback ends and the frame begins, so adopting the chunk
  // would make lastFrame() the entire session and physicalRows() a count over it — task 4 would then erase the
  // live transcript. The ctrl+o pager opens taller than the pane every time, so this is a routine path.
  //   W-R t8 CHANGED WHAT HAPPENS TO THE FRAME IT DISPLACED. Retaining it (which is what this case used to pin)
  // leaves `lastFrame()` naming a frame `clearTerminal` has just wiped off the screen, and task 4b's corrector
  // then measures its erase off a frame that describes nothing. Dropping it is the only honest record — the whole
  // of that branch and its evidence lives in test/unit/pager-bookkeeping.test.ts.
  it("never records Ink's tall-frame clearTerminal chunk as a frame, and drops the one it displaced", () => {
    const { terminal, out } = proxy();
    out.stdout.write(eraseLines(2) + "live frame\n");
    const history = Array.from({ length: 40 }, (_, i) => `committed transcript row ${i}`).join("\n") + "\n";
    const tall = "\x1b[2J\x1b[3J\x1b[H" + history + "pager frame line a\npager frame line b\n";
    out.stdout.write(tall);
    expect(out.lastFrame()).toBeUndefined();                       // neither the chunk NOR the frame it replaced
    // …and the bytes still reach the terminal, less the `\x1b[3J` t8 strips out of `clearTerminal` (that one
    // escape erases the terminal's scrollback; `pager-bookkeeping.test.ts` carries the reasoning and the evidence).
    expect(terminal.chunks.join("")).toBe(eraseLines(2) + "live frame\n" + tall.replace("\x1b[3J", ""));
  });

  // The same chunk on a virgin proxy leaves us with NO frame rather than a bogus one: undefined is the honest
  // answer, and task 4's caller already handles it (there is nothing to erase until a real frame lands).
  it("leaves lastFrame undefined when a tall-frame chunk is the first write", () => {
    const { out } = proxy();
    out.stdout.write("\x1b[2J\x1b[3J\x1b[H" + "scrollback\n".repeat(30) + "frame\n");
    expect(out.lastFrame()).toBeUndefined();
  });

  // Kind 6 — INK'S RESTORE, which is byte-shaped exactly like kind 3 and is its opposite (external whole-branch
  // review). `writeToStderr` (ink.js:157-171) is log.clear() → stderr.write(data) → log(this.lastOutput), and
  // `patchConsole` (render.js's default, not disabled by this app) sends every console.error through it. The
  // middle write goes to the SEPARATE stderr stream, so unlike the writeToStdout burst pinned above NOTHING
  // visible breaks the latch, and the third write — bare (log.clear() zeroed previousLineCount) and
  // newline-terminated (log-update.js:12) — reads as <Static> scrollback. It is not: it is the frame the clear
  // just dropped, painted again. Skipping it leaves lastFrame() undefined and the cursor unparked, and the next
  // shrink then declines its correction.
  it("records Ink's writeToStderr restore instead of mistaking it for <Static>, and re-parks on it", () => {
    const { out } = proxy(80, 24);
    out.stdout.write(eraseLines(2) + "composer frame\n");            // log(output) — the frame Ink will restore
    expect(out.lastFrame()).toBe("composer frame\n");
    out.stdout.write(eraseLines(2));                                 // log.clear() — frame off the screen, latch armed
    expect(out.lastFrame()).toBeUndefined();
    expect(out.parkedColumn()).toBe(0);
    // stderr.write(data) happens HERE and the proxy never sees it — that is the whole trap.
    out.stdout.write("composer frame\n");                            // log(this.lastOutput) — bare, and IDENTICAL
    expect(out.lastFrame()).toBe("composer frame\n");
    expect(out.parkedColumn()).toBe(parkColumn(80));
  });

  // The sabotage in the other direction, on the same seam: a genuine <Static> flush is still skipped. The
  // discriminator is the BYTES — committed transcript is not the frame that was just dropped — so a restore
  // check that fired on "bare write after an erase" would adopt the whole scrollback chunk here.
  it("still skips a <Static> write that differs from the frame the erase dropped", () => {
    const { out } = proxy(80, 24);
    out.stdout.write(eraseLines(2) + "composer frame\n");
    out.stdout.write(eraseLines(2));                                 // log.clear()
    out.stdout.write("committed transcript row\n");                  // staticOutput — NOT the dropped frame
    expect(out.lastFrame()).toBeUndefined();
    expect(out.parkedColumn()).toBe(0);
    out.stdout.write("composer frame\n");                            // log(output) — the real frame, recorded
    expect(out.lastFrame()).toBe("composer frame\n");
  });

  // …and the same restore reached through repaint(), where TWO erase-only writes arrive back to back: the
  // suppressed log.clear() never reaches record(), then writeToStdout("") writes the erase, an EMPTY data chunk
  // and the restore. The second erase-only write must not clear the memory of the frame the first dropped —
  // it dropped nothing itself, and the frame is still owed back.
  it("records the restore across a run of erase-only writes (the repaint seam)", () => {
    const { out } = proxy(80, 24);
    out.stdout.write(eraseLines(2) + "composer frame\n");
    out.stdout.write(eraseLines(2));                                 // log.clear()
    out.stdout.write("");                                            // write("") — a zero-length data chunk
    out.stdout.write("composer frame\n");                            // log(this.lastOutput)
    expect(out.lastFrame()).toBe("composer frame\n");
  });

  // THE MEMORY IS THE TALL BRANCH'S TOO, AND IT HAS TO STAY EMPTY THERE. `\x1b[2J…` drops the recorded frame
  // without any erase-only write, so a clear→bare pair behind it has no dropped frame to match: the bare write
  // stays <Static>, `lastFrame()` stays undefined and the count stays armed for the pager close it describes.
  // (An actual restore cannot coexist with a standing count — a dropped frame implies a recorded frame write,
  // which zeroes it — so this is the only reachable interaction between the two, and it is "no interaction".)
  it("keeps no restore memory across the tall-frame branch", () => {
    const { out } = proxy(80, 24);
    out.stdout.write(eraseLines(2) + "composer frame\n");
    out.stdout.write("\x1b[2J\x1b[3J\x1b[H" + "scrollback\n".repeat(30) + "composer frame\n");
    expect(out.tallWrites()).toBe(1);
    out.stdout.write(eraseLines(0));                                 // a clear AFTER the tall write drops nothing
    out.stdout.write("composer frame\n");                            // …so even these exact bytes stay <Static>
    expect(out.lastFrame()).toBeUndefined();
    expect(out.tallWrites()).toBe(1);
  });
});

describe("physicalRows", () => {
  it("counts a line that is EXACTLY the width as one row", () => {
    expect(physicalRows("x".repeat(40) + "\n", 40)).toBe(1);
    expect(physicalRows("x".repeat(41) + "\n", 40)).toBe(2);
  });

  it("counts an empty line as one row", () => {
    expect(physicalRows("\n", 40)).toBe(1);
    expect(physicalRows("a\n\nb\n", 40)).toBe(3);
  });

  it("measures display width, not code units: wide/CJK cells", () => {
    expect(physicalRows("日".repeat(20) + "\n", 40)).toBe(1);       // 20 CJK chars = 40 cells
    expect(physicalRows("日".repeat(21) + "\n", 40)).toBe(2);
  });

  it("ignores SGR escapes, which every real Ink frame is full of", () => {
    expect(physicalRows("\x1b[1m" + "x".repeat(40) + "\x1b[22m\n", 40)).toBe(1);
  });

  // SP-R0's worked example, verbatim: a 6-logical-line frame emitted at width 120 occupies 10 PHYSICAL rows once the
  // terminal narrows to 40. Ink had erased 7 (its previousLineCount = 6 + 1); the correct erase is 11 = 10 + 1.
  // physicalRows counts the frame's own lines ONLY — task 4 adds the +1 at the point of use, on purpose.
  it("reflows the SP-R0 fixture from 6 rows at 120 to 10 rows at 40", () => {
    const frame = ["a".repeat(85), "b".repeat(40), "c".repeat(12), "", "d".repeat(120), "e".repeat(39)].join("\n") + "\n";
    expect(frame.replace(/\n$/, "").split("\n")).toHaveLength(6);
    expect(physicalRows(frame, 120)).toBe(6);
    expect(physicalRows(frame, 40)).toBe(10);
  });

  it("drops exactly one trailing newline, not a trailing blank line", () => {
    expect(physicalRows("a\n", 40)).toBe(1);
    expect(physicalRows("a\n\n", 40)).toBe(2);
    expect(physicalRows("a", 40)).toBe(1);
  });
});

// ── FSW T3 FIX ROUND (review C1) — the SIGWINCH chain's ORDER ────────────────────────────────────────────
// One listener, three jobs, and the order between them is the whole reason this is a function rather than
// three lines in `runChatClient`. The measurement that forced it: at 40 → 24 rows with a full live window,
// ChatApp learning the new size AFTER Ink's own resize handler meant Ink measured the old, twenty-four-row
// window against a twenty-four-row terminal and wrote `clearTerminal + the entire session` — one tall write,
// a 44-row frame. Learning it BEFORE (this chain, driven from a listener registered before `render()`) means
// React has already re-rendered and re-committed by the time Node reaches Ink's handler: zero tall writes.
// The other direction is a constraint too, which is why the subscribers cannot simply prepend their own
// listener: both readers below must see the screen as it stands before anything repaints it.
describe("createResizeChain", () => {
  it("runs the readers before every subscriber, in subscription order", () => {
    const log: string[] = [];
    const chain = createResizeChain(() => log.push("readers"));
    chain.subscribe(() => log.push("a"));
    chain.subscribe(() => log.push("b"));
    chain.fire();
    expect(log).toEqual(["readers", "a", "b"]);
  });

  it("fires the readers even with nothing subscribed, and stops a subscriber that unsubscribed", () => {
    const log: string[] = [];
    const chain = createResizeChain(() => log.push("readers"));
    chain.fire();
    const off = chain.subscribe(() => log.push("a"));
    chain.fire();
    off();
    chain.fire();
    expect(log).toEqual(["readers", "readers", "a", "readers"]);
  });

  it("survives a subscriber that unsubscribes from inside its own callback", () => {
    // ChatApp's effect cleanup can run in response to the very re-render its sampler triggers.
    const log: string[] = [];
    const chain = createResizeChain(() => log.push("readers"));
    const off = chain.subscribe(() => { log.push("a"); off(); });
    chain.subscribe(() => log.push("b"));
    chain.fire(); chain.fire();
    expect(log).toEqual(["readers", "a", "b", "readers", "b"]);
  });
});
