// test/unit/resume-safe-stdout.test.ts — Wave R task 2: the stdout proxy is the ONE place every byte Ink emits
// passes through code we own, so it is where we learn what is currently painted and how tall it really is.
// Task 4 erases on resize from exactly these two answers, so both are pinned here rather than inferred later.
import { describe, expect, it } from "vitest";
import { createResumeSafeStdout, physicalRows } from "../../src/tui/chatMain.js";

// Ink's erase prefix, byte-for-byte: ansiEscapes.eraseLines(n) === "\x1b[2K" + ("\x1b[1A\x1b[2K" * (n-1)) + "\x1b[G".
// eraseLines(0) is the EMPTY string, which is why a first frame (and any frame right after log.clear()) arrives bare.
const eraseLines = (n: number): string => (n === 0 ? "" : "\x1b[2K" + "\x1b[1A\x1b[2K".repeat(n - 1) + "\x1b[G");

class RecordingTerminal {
  isTTY = true;
  readonly chunks: string[] = [];
  write(chunk: string): boolean { this.chunks.push(chunk); return true; }
}

const proxy = () => { const terminal = new RecordingTerminal(); return { terminal, out: createResumeSafeStdout(terminal as any) }; };

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

  // Kind 4 — repaint() suppresses Ink's stale post-resume clear. A suppressed write never reaches the terminal, so
  // it never painted anything and must not be mistaken for the live frame.
  it("ignores a suppressed write entirely", () => {
    const { terminal, out } = proxy();
    out.stdout.write(eraseLines(2) + "live frame\n");
    out.repaint(() => { out.stdout.write(eraseLines(9) + "stale resume frame\n"); });
    expect(out.lastFrame()).toBe("live frame\n");
    expect(terminal.chunks.join("")).toBe(eraseLines(2) + "live frame\n");
  });

  // Kind 5 — Ink's TALL-FRAME path (ink.js:121-124): when outputHeight >= stdout.rows it writes ONE chunk of
  // clearTerminal + fullStaticOutput + output, i.e. the whole accumulated scrollback of the session followed by
  // the frame. Nothing in the bytes marks where the scrollback ends and the frame begins, so adopting the chunk
  // would make lastFrame() the entire session and physicalRows() a count over it — task 4 would then erase the
  // live transcript. The ctrl+o pager opens taller than the pane every time, so this is a routine path.
  it("never records Ink's tall-frame clearTerminal chunk as a frame", () => {
    const { terminal, out } = proxy();
    out.stdout.write(eraseLines(2) + "live frame\n");
    const history = Array.from({ length: 40 }, (_, i) => `committed transcript row ${i}`).join("\n") + "\n";
    const tall = "\x1b[2J\x1b[3J\x1b[H" + history + "pager frame line a\npager frame line b\n";
    out.stdout.write(tall);
    expect(out.lastFrame()).toBe("live frame\n");                  // the previous frame is RETAINED, not replaced
    expect(physicalRows(out.lastFrame()!, 80)).toBe(1);            // …so the height stays small, not 40-odd rows
    expect(terminal.chunks.join("")).toBe(eraseLines(2) + "live frame\n" + tall);   // bytes still reach the terminal
  });

  // The same chunk on a virgin proxy leaves us with NO frame rather than a bogus one: undefined is the honest
  // answer, and task 4's caller already handles it (there is nothing to erase until a real frame lands).
  it("leaves lastFrame undefined when a tall-frame chunk is the first write", () => {
    const { out } = proxy();
    out.stdout.write("\x1b[2J\x1b[3J\x1b[H" + "scrollback\n".repeat(30) + "frame\n");
    expect(out.lastFrame()).toBeUndefined();
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
